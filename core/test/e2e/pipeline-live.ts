/**
 * THE ACCEPTANCE BAR (steward): one real recording through the REAL wiring —
 * real Postgres, real pgmq, the real ml/ server — landing as transcript
 * segments, speakers and a summary, with `has_word_timestamps` asserted; then
 * a forced part failure exercising the visible-gap path.
 *
 * Not a vitest file on purpose: it costs money (a live STT call), writes to a
 * shared database, and must never run in CI by accident.
 *
 *   ECHO_APP_DB_URL=…  ML_BASE_URL=http://127.0.0.1:7801 \
 *   node --experimental-strip-types test/e2e/pipeline-live.ts <audio-file>
 *
 * STATUS: written, NOT YET RUN. Two prerequisites are outside this package —
 * the application roles are NOLOGIN on the dev project until grant-login.mjs
 * is run, and the real storage signer is Backend 1's. Until then this harness
 * is unverified code like any other, and saying so is the point: a harness
 * that has never executed proves nothing, however carefully it is written.
 */
import { createServer, type Server } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import postgres from "postgres";

import { createDb, type SqlClient, type SqlTx } from "../../src/db/identity.ts";
import { createLifecycle } from "../../src/worker/lifecycle.ts";
import { createMlClient, unknownVocabulary } from "../../src/worker/ml-client.ts";
import { createQueue, Q_PROCESS_PART } from "../../src/worker/queue.ts";
import { createRunner } from "../../src/worker/runner.ts";
import { createPartStep, type StorageSigner } from "../../src/worker/steps.ts";
import { createLinkSpeakersStep, createSummarizeStep } from "../../src/worker/call-steps.ts";
import { createSummarizer } from "../../src/worker/summarizer.ts";
import { createDomainTools } from "../../src/agent/domain-tools.ts";
import { createSummarizerResolver } from "../../src/agent/skill-store.ts";
import { createDeadLetterSink } from "../../src/worker/dead-letter.ts";
import { loadWorkerConfig } from "../../src/worker/config.ts";
import { normalizeDbUrl } from "../../src/worker/main.ts";

function requireArg(value: string | undefined): string {
  if (!value) {
    console.error("usage: node --experimental-strip-types test/e2e/pipeline-live.ts <audio-file>");
    process.exit(2);
  }
  return value;
}

const audioFile = requireArg(process.argv[2]);

const log = {
  info: (f: Record<string, unknown>, m: string) => console.log(`  · ${m}`, JSON.stringify(f)),
  warn: (f: Record<string, unknown>, m: string) => console.log(`  ! ${m}`, JSON.stringify(f)),
  error: (f: Record<string, unknown>, m: string) => console.log(`  ✗ ${m}`, JSON.stringify(f)),
};

/**
 * The dev-profile stand-in for Supabase Storage: serves ONE file, once, from a
 * URL carrying an unguessable token, and shuts down afterwards.
 *
 * It is a real HTTP fetch over the real code path — ml/ downloads it exactly
 * as it would download a Supabase signed URL — so this exercises the wiring
 * rather than bypassing it. It is emphatically NOT the production signer:
 * that one is Backend 1's and belongs to core/'s shared surface.
 */
function localSigner(file: string): StorageSigner & { close(): Promise<void>; server: Server } {
  const token = randomUUID();
  const server = createServer((req, res) => {
    if (!req.url?.includes(token)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(statSync(file).size),
    });
    createReadStream(file).pipe(res);
  });

  const listening = new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });

  return {
    server,
    async signDownload() {
      const port = await listening;
      return `http://127.0.0.1:${port}/audio/${token}`;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required. The application roles are NOLOGIN until db/scripts/grant-login.mjs has been run.`);
    process.exit(2);
  }
  return value;
}

const checks: [string, boolean, string | undefined][] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push([name, ok, detail]);

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const sql = postgres(normalizeDbUrl(requireEnv("ECHO_APP_DB_URL")), {
    max: 4,
    ssl: { rejectUnauthorized: false },
  });
  // TWO credentials, not one connection reused. The connection factory issues
  // `set local role echo_agent` on the agent path, which only a connection
  // entitled to that role may do — so passing the app client for both collapses
  // the two-role boundary db/0012 exists to enforce, and fails loudly with
  // "permission denied to set role". That failure is the wall working.
  const agentSql = postgres(normalizeDbUrl(requireEnv("ECHO_AGENT_DB_URL")), {
    max: 2,
    ssl: { rejectUnauthorized: false },
  });
  const db = createDb({
    app: sql as unknown as SqlClient,
    agent: agentSql as unknown as SqlClient,
  });
  const queue = createQueue(db);
  const lifecycle = createLifecycle(db);
  const ml = createMlClient({ baseUrl: config.mlBaseUrl, timeoutMs: config.mlTimeoutMs });
  const storage = localSigner(path.resolve(audioFile));

  // An org and an active member have to exist before anything can run as
  // somebody. Creating them needs the OWNER connection, because bootstrapping
  // the first user of an org is precisely the case RLS cannot help with — a
  // user who does not exist yet cannot be the actor that creates themselves.
  // Everything after this line runs as that member, under RLS, like any
  // ordinary caller.
  const ownerSql = postgres(normalizeDbUrl(requireEnv("ECHO_PLATFORM_DB_URL")), {
    max: 1,
    ssl: { rejectUnauthorized: false },
  });

  const orgId =
    process.env.ECHO_E2E_ORG_ID ??
    (
      await ownerSql<{ id: string }[]>`
        insert into echo.org (name, status) values (${"E2E acceptance"}, 'active') returning id`
    )[0]!.id;

  // `echo.app_user.id` references `auth.users(id)` on Supabase (db/0002 adds
  // the constraint only where that table exists), so the auth row comes first
  // — the same order db/'s own fixtures use.
  let ownerId = process.env.ECHO_E2E_OWNER_ID ?? "";
  if (!ownerId) {
    ownerId = randomUUID();
    const email = `e2e-${ownerId}@example.invalid`;
    await ownerSql`insert into auth.users (id, email) values (${ownerId}, ${email})`;
    await ownerSql`
      insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at)
      values (${ownerId}, ${orgId}, ${email}, 'E2E owner', 'member', 'active', now())`;
  }

  const identity = { userId: ownerId, orgId, role: "member" as const, isActive: true };
  console.log(`  org ${orgId}\n  owner ${ownerId}`);

  let callId = "";
  let partId = "";
  let secondCallId = "";

  try {
    console.log("\n[1] fixture");
    const created = await db.withIdentity(identity, async (tx: SqlTx) => {
      const call = await tx.unsafe<{ id: string }>(
        `insert into echo.call (org_id, owner_id, title, status, source)
         values ($1, $2, 'E2E acceptance', 'processing', 'upload') returning id`,
        [orgId, ownerId],
      );
      const part = await tx.unsafe<{ id: string }>(
        `insert into echo.call_part (call_id, org_id, idx, offset_ms, storage_bucket, storage_path, status)
         values ($1, $2, 0, 0, 'call-audio', $3, 'uploaded') returning id`,
        [call[0]!.id, orgId, path.basename(audioFile)],
      );
      return { callId: call[0]!.id, partId: part[0]!.id };
    });
    callId = created.callId;
    partId = created.partId;
    console.log(`  call ${callId}\n  part ${partId}`);

    console.log("\n[2] enqueue + run the real DAG");
    await queue.send(Q_PROCESS_PART, { callId, ownerId, partId });

    const summarizer = createSummarizer({
      db,
      // The one-arg specialisation, not the general resolver with a literal slug:
    // a typo in the slug fails as "no skill configured" — a legitimate answer
    // meaning "use the runtime's own prompt" — rather than as an error. The
    // constant lives with the resolver so there is one place to look when a
    // summary turns out not to have used the shipped prompt.
    resolveSkill: createSummarizerResolver(db),
    // SPEC: the summarizer reads earlier calls with the same people or subject
    // BEFORE it writes ("this is the fourth conversation about the same
    // contract"). Each tool runs the same repo the REST API runs, under the
    // caller's identity — so it reaches exactly what the call owner could reach
    // by hand and nothing more.
    tools: createDomainTools(),
    deps: { db },
        apiKey: process.env.OPENROUTER_API_KEY,
      fallbackModel: process.env.WORKER_SUMMARY_MODEL ?? "google/gemini-3.6-flash",
    });

    const runner = createRunner({
      queue,
      handlers: [
        createPartStep({ db, ml, queue, lifecycle, storage }),
        createLinkSpeakersStep({ db, queue, lifecycle }),
        createSummarizeStep({ db, lifecycle, summarizer }),
      ],
      config,
      sink: createDeadLetterSink({ db, lifecycle, queue, log }),
      log,
    });

    const result = await runner.poll();
    // One poll drains every queue, so a healthy first pass completes the part
    // step and may carry the call further. What matters is that nothing was
    // retried or abandoned.
    check(
      "first poll completed work with no retries or dead letters",
      result.done >= 1 && result.retried === 0 && result.deadLettered === 0,
      JSON.stringify(result),
    );

    console.log("\n[3] what landed");
    const [segments, speakers, part] = await db.withIdentity(identity, async (tx: SqlTx) => [
      await tx.unsafe<{ seq: number; start_ms: number; end_ms: number; text: string; words: unknown[] }>(
        `select seq, start_ms, end_ms, text, words from echo.transcript_segment where part_id = $1 order by seq`,
        [partId],
      ),
      await tx.unsafe<{ label: string }>(`select label from echo.call_speaker where call_id = $1`, [callId]),
      await tx.unsafe<{ status: string; has_word_timestamps: boolean; duration_ms: number }>(
        `select status, has_word_timestamps, duration_ms from echo.call_part where id = $1`,
        [partId],
      ),
    ]);

    check("transcript segments written", segments.length > 0, `${segments.length} segments`);
    // The producer here is ml/CONTRACT.md, not a pg_enum — so the only way to
    // catch vocabulary drift is to ask a REAL ml/ response what it says.
    const provenance = (
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ provenance: { stt: { timestamps: string }; diarization: { source: string } } }>(
          `select provenance from echo.transcript_segment where part_id = $1 limit 1`,
          [partId],
        ),
      )
    )[0]?.provenance;
    check(
      "ml/ vocabulary is all recognised by the worker",
      Boolean(provenance) && unknownVocabulary({ provenance: provenance! }).length === 0,
      provenance
        ? unknownVocabulary({ provenance }).join(", ") || "no drift"
        : "no provenance stored",
    );
    check("speakers on the roster", speakers.length > 0, speakers.map((s) => s.label).join(", "));
    check("part advanced", part[0]?.status === "diarized", part[0]?.status);
    check("duration recorded", (part[0]?.duration_ms ?? 0) > 0, String(part[0]?.duration_ms));
    check("has_word_timestamps asserted", part[0]?.has_word_timestamps === true);
    // `[].every(…)` is TRUE, so each of these demands a non-empty set first.
    // Otherwise a run that produced nothing at all reports three passes — the
    // same vacuous-assertion trap that let a broken VAD keep a suite green.
    check(
      "every segment carries real word rows",
      segments.length > 0 && segments.every((s) => Array.isArray(s.words) && s.words.length > 0),
    );
    check(
      "segments ordered and non-degenerate",
      segments.length > 0 &&
        segments.every((s) => s.end_ms > s.start_ms) &&
        segments.every((s, i, a) => i === 0 || s.start_ms >= a[i - 1]!.start_ms),
    );
    // seq must sit in THIS part's deterministic range, not restart at 0.
    check(
      "seq inside the part's range",
      segments.length > 0 && segments.every((s) => s.seq >= 0 && s.seq < 100_000),
    );

    console.log("\n[4] the visible-gap path");
    // A second part pointing at nothing: it must dead-letter into a GAP, and
    // the call must survive it.
    const gapPart = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ id: string }>(
        `insert into echo.call_part (call_id, org_id, idx, offset_ms, storage_bucket, storage_path, status)
         values ($1, $2, 1, 1800000, 'call-audio', null, 'uploaded') returning id`,
        [callId, orgId],
      ),
    );
    const gapId = gapPart[0]!.id;
    await queue.send(Q_PROCESS_PART, { callId, ownerId, partId: gapId });
    await runner.poll();

    const after = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ missing: boolean; failure_reason: string | null }>(
        `select missing, failure_reason from echo.call_part where id = $1`,
        [gapId],
      ),
    );
    check("failed part became a visible gap", after[0]?.missing === true, after[0]?.failure_reason ?? "");

    const call = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ status: string }>(`select status from echo.call where id = $1`, [callId]),
    );
    check("the call survived the gap", call[0]?.status !== "failed", call[0]?.status);

    console.log("\n[5] per-call steps: link_speakers then summarize");
    // Drain the per-call queues the part step enqueued. Each poll advances one
    // step, and summarize costs a real model call.
    for (let i = 0; i < 4; i++) {
      const pass = await runner.poll();
      if (pass.claimed === 0) break;
    }

    const [speakerSamples, summaries, finalCall, runs] = await db.withIdentity(
      identity,
      async (tx: SqlTx) => [
        await tx.unsafe<{ label: string; sample_start_ms: number | null }>(
          `select label, sample_start_ms from echo.call_speaker where call_id = $1`,
          [callId],
        ),
        await tx.unsafe<{ version: number; body: string; model: string; agent_run_id: string | null; created_by: string }>(
          `select version, body, model, agent_run_id, created_by from echo.summary where call_id = $1 order by version`,
          [callId],
        ),
        await tx.unsafe<{ status: string }>(`select status from echo.call where id = $1`, [callId]),
        await tx.unsafe<{ kind: string; status: string }>(
          `select kind, status from echo.agent_run where call_id = $1`,
          [callId],
        ),
      ],
    );

    check(
      "speakers got an identification sample",
      speakerSamples.length > 0 && speakerSamples.every((s) => s.sample_start_ms !== null),
    );
    check("a summary was written", summaries.length >= 1, `${summaries.length} version(s) · ${summaries[0]?.model}`);
    check("versions start at 1 and are sequential", summaries.every((s, i) => s.version === i + 1));
    check("summary is non-empty prose", (summaries[0]?.body.trim().length ?? 0) > 20);
    // Invariant 5: the run is recorded and replayable, and authored by the
    // call's OWNER rather than a service account.
    check("the agent run was recorded", runs.some((r) => r.kind === "summarizer"), JSON.stringify(runs));
    check("summary links to its run", Boolean(summaries[0]?.agent_run_id));
    check("summary authored by the call owner", summaries[0]?.created_by === ownerId);
    check("call reached ready", finalCall[0]?.status === "ready", finalCall[0]?.status);

    if (summaries[0]) {
      console.log(`\n  summary (${summaries[0].model}):\n  ${summaries[0].body.slice(0, 400)}`);
    }

    // ------------------------------------------------------------------
    // [6] THE SECOND CALL — the only fixture that can prove the summarizer
    // reads prior calls (SPEC). With one call, "wrote from the transcript
    // alone" and "had no tools at all" produce identical output, so a
    // single-call run reports success either way. Do not simplify this back
    // to one call.
    // ------------------------------------------------------------------
    console.log("\n[6] a SECOND call on the same subject, by the same owner");
    const second = await db.withIdentity(identity, async (tx: SqlTx) => {
      const call = await tx.unsafe<{ id: string }>(
        `insert into echo.call (org_id, owner_id, title, status, source)
         values ($1, $2, 'E2E acceptance', 'processing', 'upload') returning id`,
        [orgId, ownerId],
      );
      const part = await tx.unsafe<{ id: string }>(
        `insert into echo.call_part (call_id, org_id, idx, offset_ms, storage_bucket, storage_path, status)
         values ($1, $2, 0, 0, 'call-audio', $3, 'uploaded') returning id`,
        [call[0]!.id, orgId, path.basename(audioFile)],
      );
      return { callId: call[0]!.id, partId: part[0]!.id };
    });
    secondCallId = second.callId;

    await queue.send(Q_PROCESS_PART, { callId: secondCallId, ownerId, partId: second.partId });
    for (let i = 0; i < 5; i++) {
      const pass = await runner.poll();
      if (pass.claimed === 0) break;
    }

    const secondRuns = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ steps: { tool: string; outcome: string }[]; error: string | null; status: string }>(
        `select steps, error, status from echo.agent_run
          where call_id = $1 and kind = 'summarizer' order by id desc limit 1`,
        [secondCallId],
      ),
    );
    // `steps` currently arrives DOUBLE-ENCODED: a jsonb array whose elements
    // are JSON *strings*, each wrapping a one-element array —
    //   ["[{\"seq\":0,\"tool\":\"search_transcripts\",…}]", "[{…}]"]
    // rather than [{…},{…}]. Flattened defensively here so the behavioural
    // assertions test the BEHAVIOUR, and the encoding gets its own named check
    // below rather than hiding inside an unrelated failure. (Reported to
    // Backend 1 — it is their run-store, and it is the same double-encoding
    // shape as passing JSON.stringify to a jsonb parameter.)
    const rawSteps: unknown[] = secondRuns[0]?.steps ?? [];
    const steps = rawSteps.flatMap((entry) => {
      if (typeof entry !== "string") return [entry as { tool: string; outcome: string }];
      try {
        const parsed = JSON.parse(entry);
        return (Array.isArray(parsed) ? parsed : [parsed]) as { tool: string; outcome: string }[];
      } catch {
        return [];
      }
    });
    const stepsAreQueryable = rawSteps.every((e) => typeof e === "object" && e !== null);

    // CROSS-CALL tools only. `read_window` and `get_call` operate inside a call
    // the agent already has, so calling them proves nothing about reaching
    // EARLIER calls — which is the SPEC behaviour under test. Only
    // `search_transcripts` and `list_related_calls` look beyond this call.
    //
    // Deliberately not narrowed to `list_related_calls` alone: finding the
    // prior call by search is a legitimate path to the same behaviour, and a
    // gate that demands one specific tool goes red for a model making a
    // reasonable choice — the flakiness argument that got the prose assertion
    // ruled out applies here too.
    const searched = steps.filter((s) =>
      ["search_transcripts", "list_related_calls"].includes(s.tool),
    );

    console.log(`  tools called: ${steps.map((s) => `${s.tool}:${s.outcome}`).join(", ") || "(none)"}`);
    if (secondRuns[0]?.error) console.log(`  run note: ${secondRuns[0].error}`);

    // The deterministic assertion. Whether the prose mentions the earlier call
    // is a model's judgement and varies run to run; whether the agent REACHED
    // for it is recorded in agent_run.steps and does not.
    check(
      "the second summary's agent reached for prior calls",
      searched.length > 0,
      steps.map((s) => s.tool).join(", ") || "no tools called",
    );
    check(
      "those tool calls succeeded",
      searched.length > 0 && searched.every((s) => s.outcome === "ok"),
      searched.map((s) => `${s.tool}:${s.outcome}`).join(", "),
    );

    const secondSummary = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ body: string }>(
        `select body from echo.summary where call_id = $1 order by version desc limit 1`,
        [secondCallId],
      ),
    );
    check("the second call got its own summary", Boolean(secondSummary[0]?.body?.trim()));

    // Invariant 5: agent runs are REPLAYABLE. Steps stored as JSON strings
    // inside a jsonb array cannot be queried — `jsonb_array_elements(steps)
    // ->>'tool'` returns nothing — so the audit trail is present but not
    // usable, which is the failure mode this whole session keeps finding.
    // Not mine to fix; named so it cannot hide.
    check(
      "agent_run.steps is queryable jsonb, not double-encoded strings",
      stepsAreQueryable,
      stepsAreQueryable ? "objects" : "array of JSON strings (Backend 1's run-store)",
    );
    if (secondSummary[0]) {
      console.log(`\n  second summary:\n  ${secondSummary[0].body.slice(0, 500)}`);
    }
  } finally {
    await storage.close();
    // Clean up after ourselves: this is a shared database, and a test that
    // leaves rows behind is a test nobody runs twice.
    if (callId && process.env.ECHO_E2E_KEEP !== "1") {
      // summary BEFORE agent_run: `summary.agent_run_id` references it, so the
      // other order trips summary_agent_run_id_fkey. Children first.
      for (const id of [secondCallId].filter(Boolean)) {
        await ownerSql`delete from echo.summary where call_id = ${id}`;
        await ownerSql`delete from echo.agent_run where call_id = ${id}`;
        await ownerSql`delete from echo.transcript_segment where call_id = ${id}`;
        await ownerSql`delete from echo.call_speaker where call_id = ${id}`;
        await ownerSql`delete from echo.call_part where call_id = ${id}`;
        await ownerSql`delete from echo.call where id = ${id}`;
      }
      await ownerSql`delete from echo.summary where call_id = ${callId}`;
      await ownerSql`delete from echo.agent_run where call_id = ${callId}`;
      await ownerSql`delete from echo.transcript_segment where call_id = ${callId}`;
      await ownerSql`delete from echo.call_speaker where call_id = ${callId}`;
      await ownerSql`delete from echo.call_part where call_id = ${callId}`;
      await ownerSql`delete from echo.call where id = ${callId}`;
      // Only remove the org and user if THIS run created them.
      if (!process.env.ECHO_E2E_OWNER_ID) {
        // app_user before auth.users: the FK is ON DELETE RESTRICT.
        await ownerSql`delete from echo.app_user where id = ${ownerId}`;
        await ownerSql`delete from auth.users where id = ${ownerId}`;
      }
      if (!process.env.ECHO_E2E_ORG_ID) {
        await ownerSql`delete from echo.org where id = ${orgId}`;
      }
      console.log("\n  (fixture removed; ECHO_E2E_KEEP=1 to keep it)");
    }
    await ownerSql.end();
    await sql.end();
    await agentSql.end();
  }

  console.log("\n─── checks ───");
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`\n${failed === 0 ? "ACCEPTANCE PASSED" : `ACCEPTANCE FAILED (${failed})`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nharness failed:", (error as Error).message);
  process.exit(1);
});
