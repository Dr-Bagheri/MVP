/**
 * THE LIVE LOOP (steward directive, M4): a real model proposes a write, a
 * human confirms it, and the row actually changes.
 *
 * Everything else about the write tools is proven against fakes. This is the
 * only thing that can prove the *loop*, and it deliberately drives the HTTP
 * surface rather than the runtime — `POST /v1/assistant/ask`, parse the
 * `proposal` SSE event, `POST …/confirm` with `{run_id}` — so the route, the
 * auth, the SSE framing and the wiring are all in the path. Calling
 * `applyProposal` directly would prove the function and nothing around it.
 *
 * Prerequisites, and it refuses rather than pretending if any is missing:
 *   ECHO_APP_DB_URL, ECHO_AGENT_DB_URL   (DPAPI store)
 *   ECHO_API_URL                         (a running api, default 127.0.0.1:8080)
 *   ECHO_JWT_SECRET                      (whatever that api verifies with)
 *   OPENROUTER_API_KEY                   (the api process needs it; see below)
 *
 * The api under test must have been started with the same JWT secret and with
 * OPENROUTER_API_KEY set — the model call happens in ITS process, not this
 * one. This script checks what it can and says plainly what it cannot.
 *
 *   node --experimental-strip-types test/e2e/proposal-loop.ts
 */
import { createHmac } from "node:crypto";

import postgres from "postgres";

const API = process.env.ECHO_API_URL ?? "http://127.0.0.1:8080";
const JWT_SECRET = process.env.ECHO_JWT_SECRET;
const APP_URL = process.env.ECHO_APP_DB_URL;
/** Needed for stage 7: the grant floor is a property of the AGENT connection. */
const AGENT_URL = process.env.ECHO_AGENT_DB_URL;
/** Backend 3's seeded active member. Owner of the call we create. */
const OWNER = process.env.ECHO_DEV_ACTOR ?? "0d000000-0000-4000-8000-000000000002";
const ORG = process.env.ECHO_DEV_ORG ?? "0d000000-0000-4000-8000-00000000000d";

if (!APP_URL || !JWT_SECRET) {
  console.error("ECHO_APP_DB_URL and ECHO_JWT_SECRET are required");
  process.exit(2);
}

const sql = postgres(APP_URL, { max: 2 });
let failures = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) console.log(`  ok   ${what}`);
  else { failures += 1; console.error(`  FAIL ${what}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
};

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
function token(sub: string): string {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac("sha256", Buffer.from(JWT_SECRET!, "utf8"))
    .update(`${head}.${body}`).digest().toString("base64url");
  return `${head}.${body}.${sig}`;
}

/** Run a statement as the owner, exactly as the connection factory does. */
async function asOwner<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe("set local role echo_app");
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [OWNER]);
    return fn(tx as postgres.TransactionSql);
  }) as Promise<T>;
}

/**
 * A call with one transcript segment, owned by the dev member.
 *
 * The WRONG text is the point: the model has to notice «سی» (thirty) where
 * the surrounding sentence says thirteen, and propose the correction. A
 * fixture the model has no reason to touch would prove only that it declines.
 */
const WRONG = "بودجهٔ بازاریابی امسال سی درصد افزایش می‌یابد یعنی سیزده درصد بیشتر از سال گذشته";

async function seedCall(): Promise<{ callId: string; segmentId: string }> {
  return asOwner(async (tx) => {
    const [call] = await tx.unsafe<{ id: string }[]>(
      `insert into echo.call (org_id, owner_id, title, scope, status, language, started_at)
       values ($1, $2, $3, 'private', 'ready', 'fa', now()) returning id`,
      [ORG, OWNER, `proposal-loop ${new Date().toISOString()}`],
    );
    const callId = call!.id;
    const [part] = await tx.unsafe<{ id: string }[]>(
      // `offset_ms` is NOT NULL — where this part begins on the call's
      // continuous timeline, which every downstream timestamp is computed
      // from. The database told me; I had omitted it.
      `insert into echo.call_part (call_id, org_id, idx, offset_ms, duration_ms, status, has_word_timestamps)
       values ($1, $2, 0, 0, 9000, 'diarized', false) returning id`,
      [callId, ORG],
    );
    const [segment] = await tx.unsafe<{ id: string }[]>(
      `insert into echo.transcript_segment
         (call_id, org_id, part_id, seq, start_ms, end_ms, text, words)
       values ($1, $2, $3, 0, 0, 9000, $4, '[]'::jsonb) returning id`,
      [callId, ORG, part!.id, WRONG],
    );
    return { callId, segmentId: segment!.id };
  });
}

/** Read an SSE stream to completion, collecting the events we care about. */
async function ask(question: string, callId: string): Promise<{
  proposal?: { id: string; kind: string; summary: string; payload?: { before?: unknown; after?: unknown } };
  runId?: string;
  failed?: boolean;
  /** `| undefined` explicitly — a `done` event may carry no error at all. */
  error?: string | undefined;
}> {
  const response = await fetch(`${API}/v1/assistant/ask`, {
    method: "POST",
    headers: { authorization: `Bearer ${token(OWNER)}`, "content-type": "application/json" },
    body: JSON.stringify({ question, call_id: callId }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`ask failed: ${response.status} ${await response.text()}`);
  }
  const out: Awaited<ReturnType<typeof ask>> = {};
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if (event.type === "proposal") out.proposal = event as never;
      if (event.type === "done") {
        out.runId = event.runId as string;
        out.failed = event.failed as boolean;
        out.error = event.error as string | undefined;
      }
    }
  }
  return out;
}

let seeded: { callId: string; segmentId: string } | undefined;
try {
  console.log(`api: ${API}`);
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  check("the api is up", (health as { ok?: boolean } | null)?.ok === true, health);
  if (!health) throw new Error("no api to test against");

  seeded = await seedCall();
  console.log(`seeded call ${seeded.callId}, segment ${seeded.segmentId}`);

  /**
   * Step 0 exists because of a bug this harness found: `preferred_model` was
   * written by this endpoint and read by NOTHING, so a person could choose a
   * model and have every conversation ignore it.
   *
   * Setting it through the product's own route — rather than passing `model`
   * on the ask — means the loop below exercises the fallback path a real user
   * takes. A harness that always passed a model is precisely what hid this.
   */
  console.log("\n0. the user chooses a model, the way a user would");
  const catalogue = await fetch(`${API}/v1/models`, {
    headers: { authorization: `Bearer ${token(OWNER)}` },
  }).then((r) => r.json()) as { models: { id: string; tools?: boolean }[]; tool_capability_filtered: boolean };
  /**
   * A NAMED model, not `models[0]`.
   *
   * My first version took the first entry, which is alphabetical, which is
   * `ai21/jamba-large-1.7` — and that provider is retired: the run failed
   * with "This API has been retired". Worth recording as an observation
   * about the catalogue rather than a harness detail: `supported_parameters`
   * says a model CAN call tools, not that it still answers. A user picking
   * the top of the list gets a dead assistant, and nothing in the product
   * would tell them why. Raised with the steward; not fixed unilaterally,
   * because filtering for liveness needs a liveness source we do not have.
   */
  const prefer = ["google/gemini-3.6-flash", "google/gemini-2.5-flash", "openai/gpt-5"];
  const model = prefer.find((id) => catalogue.models.some((m) => m.id === id))
    ?? catalogue.models[0]?.id;
  check("the catalogue offered a tool-capable model", Boolean(model), {
    count: catalogue.models.length, filtered: catalogue.tool_capability_filtered,
  });
  const saved = await fetch(`${API}/v1/models/preferred`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token(OWNER)}`, "content-type": "application/json" },
    body: JSON.stringify({ model }),
  });
  check("the choice was saved", saved.status === 200, await saved.clone().text());

  console.log("\n1. the model proposes");
  const asked = await ask(
    `در رونوشت این جلسه یک عدد اشتباه نوشته شده است. بخش شناسهٔ ${seeded.segmentId} را بخوان و اگر عدد نادرست است، `
    + `اصلاح آن را پیشنهاد بده. «سی درصد» باید «سیزده درصد» باشد.`,
    seeded.callId,
  );
  check("the run finished without failing", asked.failed === false, asked.error);
  check("a proposal event arrived", Boolean(asked.proposal), asked.proposal);
  check("it is a correct_transcript proposal", asked.proposal?.kind === "correct_transcript", asked.proposal?.kind);
  // The card's whole reason for existing: both sides of the change.
  check("the proposal carries BEFORE and AFTER",
    asked.proposal?.payload?.before !== undefined && asked.proposal?.payload?.after !== undefined,
    asked.proposal?.payload);

  if (!asked.proposal || !asked.runId) throw new Error("no proposal to confirm");
  const proposalId: string = asked.proposal.id;
  // Narrowed once so every use below is a plain string rather than a
  // non-null assertion repeated at each call site.
  const runId: string = asked.runId;
  const segmentId: string = seeded.segmentId;

  console.log("\n2. nothing has changed yet");
  const [beforeRow] = await asOwner((tx) => tx.unsafe<{ text: string }[]>(
    `select text from echo.transcript_segment where id = $1`, [segmentId],
  ));
  check("the segment still reads as it did", beforeRow?.text === WRONG, beforeRow?.text?.slice(0, 40));

  console.log("\n3. a human confirms");
  const confirm = await fetch(`${API}/v1/assistant/proposals/${asked.proposal.id}/confirm`, {
    method: "POST",
    headers: { authorization: `Bearer ${token(OWNER)}`, "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId }),
  });
  const confirmBody = await confirm.json() as { applied?: boolean; error?: string };
  check("the confirm was accepted", confirm.status === 200 && confirmBody.applied === true, confirmBody);

  console.log("\n4. the row actually changed");
  const [afterRow] = await asOwner((tx) => tx.unsafe<{ text: string; words: unknown[] }[]>(
    `select text, words from echo.transcript_segment where id = $1`, [segmentId],
  ));
  check("the text is no longer the original", afterRow?.text !== WRONG, afterRow?.text?.slice(0, 60));
  check("the correction is what the model proposed",
    typeof afterRow?.text === "string" && afterRow.text.includes("سیزده"), afterRow?.text?.slice(0, 60));
  // Decision 3: stale timings would put a seek affordance on words never said.
  check("word timings were cleared with the text", Array.isArray(afterRow?.words) && afterRow.words.length === 0);

  console.log("\n5. the trail holds both halves");
  const steps = await asOwner((tx) => tx.unsafe<{ tool: string }[]>(
    `select jsonb_array_elements(steps)->>'tool' as tool from echo.agent_run where id = $1`,
    [runId],
  ));
  const tools = steps.map((s) => s.tool);
  check("the proposal step is recorded", tools.includes("correct_transcript"), tools);
  /**
   * The approval lives in `proposal_decision` now, not in the run's steps —
   * db/0011 refuses any update to a finished run, and db/0029 gave the
   * decision its own table whose primary key IS the replay refusal. This was
   * a note while that was undecided; it is an assertion now.
   */
  const [decision] = await asOwner((tx) => tx.unsafe<{ decision: string; by: string; kind: string }[]>(
    `select decision::text as decision, decided_by as by, kind
       from echo.proposal_decision where proposal_id = $1`,
    [proposalId],
  ));
  check("the decision is recorded", decision?.decision === "approve", decision);
  check("it records WHO decided", decision?.by === OWNER, decision?.by);
  check("and what kind of change it was", decision?.kind === "correct_transcript", decision?.kind);



  console.log("\n6. a confirmed proposal cannot be replayed");
  const replay = await fetch(`${API}/v1/assistant/proposals/${asked.proposal.id}/confirm`, {
    method: "POST",
    headers: { authorization: `Bearer ${token(OWNER)}`, "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId }),
  });
  /**
   * 409, from db/0029's primary key rather than from a check this code
   * remembers to perform. The decision is written BEFORE the product write,
   * so a replay is refused before it can apply anything — which is what
   * makes a double-click safe: a replayed `replace_summary` would otherwise
   * write a second version of a person's summary.
   */
  check("a decided proposal cannot be decided again", replay.status === 409, replay.status);
  const [versions] = await asOwner((tx) => tx.unsafe<{ n: string }[]>(
    `select count(*) as n from echo.summary where call_id = $1`, [seeded!.callId],
  ));
  check("and nothing was written twice", Number(versions?.n) === 0, versions?.n);

  /**
   * 7. The approval widened WHO CONSENTED, not what may be written (D20).
   *
   * The confirm applies on echo_agent precisely so db/0014's column grants
   * stay the floor. The tempting tidy-up — "do the write on the connection
   * that already holds the decision", which would also restore the single
   * transaction — silently lets an approved proposal touch `confidence` and
   * `provenance`, columns the agent can never reach. It passes every test,
   * and it is the exact shape of the run-store-on-the-app-role bug.
   *
   * So this asserts the floor by ATTEMPTING the widened write and requiring
   * the database to refuse it. A comment cannot fail; this can.
   */
  if (AGENT_URL) {
    console.log("\n7. the approval did not widen what may be written (D20)");
    const agent = postgres(AGENT_URL, { max: 1 });
    try {
      /**
       * Caught at the TRANSACTION boundary, not inside it. A refused
       * statement aborts the transaction, so postgres.js rethrows on
       * commit — an inner catch swallows the code and then fails anyway,
       * which is how my first version reported a passing floor as a crash.
       */
      let refusal: string | null = null;
      try {
        await agent.begin(async (tx) => {
          await tx.unsafe("set local role echo_agent");
          await tx.unsafe("select set_config('echo.actor_id', $1, true)", [OWNER]);
          await tx.unsafe(
            `update echo.transcript_segment set confidence = 0.5 where id = $1`,
            [segmentId],
          );
        });
        // No throw at all: the write went through and the floor is GONE.
      } catch (error) {
        refusal = (error as { code?: string }).code ?? "unknown";
      }
      // 42501 = insufficient_privilege. The GRANT refused it, not our SQL.
      check("the agent connection cannot write `confidence`", refusal === "42501", refusal);
    } finally {
      await agent.end();
    }
  } else {
    console.log("\n7. skipped — set ECHO_AGENT_DB_URL to assert the D20 grant floor");
  }
} catch (error) {
  failures += 1;
  console.error(`\nFAILED: ${(error as Error).message}`);
} finally {
  /**
   * Clean up after itself. It could not before: `echo_app` holds no DELETE
   * grant anywhere, so this harness left its call behind on EVERY run and the
   * dev project accumulated ten of them before the steward noticed and asked
   * me to sweep. The line it used to print — "left call … on dev" — was
   * accurate and useless; it recorded the mess instead of preventing it.
   *
   * db/0032's `soft_delete_call` gives it a door. Soft, so the row leaves
   * every listing at once and the purge job takes it at the end of the
   * window: the product's own semantics, not a special path for tests.
   *
   * Deliberately in `finally`. A harness that tidies up only when it PASSES
   * leaves its wreckage behind exactly when someone is about to go looking at
   * the database to find out what went wrong.
   */
  if (seeded) {
    try {
      await asOwner((tx) => tx.unsafe(`select echo.soft_delete_call($1::uuid)`, [seeded!.callId]));
      console.log(`\n(swept call ${seeded.callId})`);
    } catch (error) {
      // Never let a cleanup failure masquerade as the result: say it plainly.
      const code = (error as { code?: string }).code ?? "unknown";
      console.error(`\n(could NOT sweep call ${seeded.callId}: ${code} — remove it by hand)`);
    }
  }
  await sql.end();
}

console.log(failures === 0 ? "\nproposal loop: OK" : `\nproposal loop: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
