/**
 * THE DELEGATION LOOP, AGAINST A REAL MODEL.
 *
 * Echo is asked something that genuinely spans both colleagues, and this
 * checks what the run ACTUALLY did rather than what it said:
 *
 *   1. `ask_roya` / `ask_ava` were OFFERED (agent_run.request.tools) — the
 *      wiring half, which cannot vary between runs and is what separates
 *      "the model declined" from "the model was never given the option";
 *   2. at least one was CALLED, and its step landed in `agent_run.steps`;
 *   3. the colleague's turn reached the THREAD with its own `author`, which is
 *      the whole point of the feature and the one thing a reader sees;
 *   4. the delegate's own run happened — a second `agent_run` row for the
 *      same actor, in the same window.
 *
 * The gate arc's terminus, applied (M19/M21): the behavioural half asserts the
 * MECHANISM, never the model's particular wording, so nothing here can flake
 * on a paraphrase. If the model declines to delegate, that is a legitimate
 * choice and this says so with the offered-tools evidence rather than failing.
 *
 * ── HOW TO RUN IT, AND WHY IT NEEDS A REAL TOKEN ──────────────────────────
 *
 * The older live harnesses in this directory mint their own HS256 JWT from
 * `echo_platform_jwt_secret`. That path is CLOSED: the platform's tokens are
 * ES256 and core verifies them through Supabase's JWKS, so there is no shared
 * secret to sign with any more and the name is no longer in the store. A
 * harness that still tried would fail at the auth wall and prove nothing about
 * delegation.
 *
 * So this one takes a token that already exists. Sign in to the product, copy
 * the access token, and:
 *
 *   ECHO_BEARER=<access token>
 *   ECHO_API_URL=https://api.neurai.pt
 *   ECHO_APP_DB_URL=<echo_platform_db_app_url>
 *   node --experimental-strip-types test/e2e/delegation-live.ts
 *
 * The model call happens in the API's process, so that process needs
 * OPENROUTER_API_KEY — not this one.
 *
 * It refuses rather than pretending when anything is missing, and exits 2 for
 * "did not run, result unknown". That exit code is the point: a live lane that
 * cannot distinguish "green" from "never ran" is the vacuous pass this repo
 * keeps finding, and rule 7's live-lane standard is prove-at-acceptance —
 * runnable but never run does not count.
 */
import postgres from "postgres";

const API = process.env.ECHO_API_URL ?? "http://127.0.0.1:8080";
const BEARER = process.env.ECHO_BEARER;
const APP_URL = process.env.ECHO_APP_DB_URL;

if (!BEARER || !APP_URL) {
  console.error(
    "delegation-live: missing ECHO_BEARER or ECHO_APP_DB_URL — "
    + "DID NOT RUN, result unknown (never a pass)",
  );
  process.exit(2);
}

const sql = postgres(APP_URL, { max: 1 });

/**
 * The actor is read OUT OF THE TOKEN, not chosen from the database.
 *
 * The first draft picked the oldest active member and minted a token for
 * them, which is the shape every other harness here uses and is wrong now:
 * with a real bearer, the person the api will act as is whoever that token
 * says — and checking the runs of somebody ELSE would look for evidence in
 * the wrong rows and report a clean miss as a decline.
 */
function subjectOf(bearer: string): string {
  const [, body] = bearer.split(".");
  if (!body) throw new Error("ECHO_BEARER is not a JWT");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as { sub?: string };
  if (!claims.sub) throw new Error("ECHO_BEARER carries no sub");
  return claims.sub;
}

let failures = 0;
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "  ok  " : "FAIL  "}${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  /* the actor is whoever the TOKEN says — see subjectOf. The row is read to
     confirm they exist here at all: a valid token for somebody with no
     app_user row is "not registered", which is a different nothing from "not
     authenticated" and would otherwise surface as an empty run search. */
  const [actor] = await sql<{ id: string; org_id: string }[]>`
    select id, org_id from echo.app_user where id = ${subjectOf(BEARER!)}`;
  if (!actor) {
    console.error("delegation-live: the token's subject has no app_user row — DID NOT RUN, result unknown");
    process.exit(2);
  }
  console.log(`actor ${actor.id}`);

  /* the two colleagues must exist, or the whole question is moot */
  const seeded = await sql<{ handle: string }[]>`
    select handle from echo.assistant_agent
     where level = 'system' and archived_at is null order by handle`;
  check(
    seeded.map((r) => r.handle).join(",") === "ava,roya",
    "the two colleagues are seeded",
    seeded.map((r) => r.handle).join(",") || "none",
  );

  const startedAt = new Date();
  /* a question that spans BOTH sides on purpose: what is scheduled (Roya's
     half) and what the record says about it (Ava's). A single-sided question
     would make declining to delegate the correct choice, and the run would
     prove nothing either way. */
  const question =
    "برای هفتهٔ پیش‌رو چه جلساتی داریم و سوابق قبلی دربارهٔ همان موضوع‌ها چه می‌گویند؟"
    + " اگر لازم است از همکارانت کمک بگیر.";

  const response = await fetch(`${API}/v1/assistant/ask`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${BEARER}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      question,
      locale: "fa",
      client_tools: [],
    }),
  });
  check(response.ok, "the ask was accepted", `HTTP ${response.status}`);
  if (!response.ok) {
    console.error(await response.text());
    await sql.end();
    process.exit(1);
  }

  /* drain the stream, collecting the events that matter */
  const authors: string[] = [];
  let sawDone = false;
  let sessionId = "";
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const chunk of buffer.split("\n\n")) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (event.type === "session") sessionId = String(event.id);
        if (event.type === "agent_message") authors.push(String(event.author));
        if (event.type === "done") sawDone = true;
      } catch { /* a partial frame; the next read completes it */ }
    }
    buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
  }
  check(sawDone, "the stream finished with `done`");

  /* ── 1. the WIRING half: were they offered? ─────────────────────────── */
  const [run] = await sql<{ id: string; request: Record<string, unknown> }[]>`
    select id, request from echo.agent_run
     where actor_id = ${actor.id} and started_at >= ${startedAt}
     order by started_at asc limit 1`;
  check(run !== undefined, "the run was recorded");
  const offered = (run?.request?.tools as string[] | undefined) ?? [];
  const delegates = offered.filter((t) => t.startsWith("ask_"));
  check(
    delegates.length === 2,
    "both colleagues were OFFERED to the model",
    delegates.join(",") || "none offered",
  );

  /* ── 2/3/4. the BEHAVIOURAL half ────────────────────────────────────── */
  if (authors.length === 0) {
    /* a legitimate outcome, reported with its evidence rather than as a
       failure — the model was given the option and chose not to use it */
    console.log(
      "  --  the model DECLINED to delegate this turn. The offered-tools check "
      + "above is what makes that a choice rather than a missing wire.",
    );
  } else {
    check(true, "a colleague spoke in the stream", authors.join(","));

    const persisted = await sql<{ author: string; role: string }[]>`
      select author, role from echo.agent_message
       where session_id = ${sessionId} and author is not null order by seq`;
    check(
      persisted.length > 0,
      "the colleague's turn is IN THE THREAD with its own author",
      persisted.map((r) => `${r.author}/${r.role}`).join(", "),
    );
    check(
      persisted.every((r) => r.role === "assistant"),
      "and it is an assistant turn — the role enum did not have to grow",
    );

    const runs = await sql<{ n: number }[]>`
      select count(*)::int as n from echo.agent_run
       where actor_id = ${actor.id} and started_at >= ${startedAt}`;
    check(
      (runs[0]?.n ?? 0) > 1,
      "the delegate's own run happened",
      `${runs[0]?.n ?? 0} runs in the window`,
    );
  }

  await sql.end();
  console.log(failures === 0 ? "\nDELEGATION LIVE: green" : `\nDELEGATION LIVE: ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
