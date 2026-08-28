/**
 * The worker process (M1: one codebase, two processes).
 *
 * Poll, execute, sleep when idle. Deliberately boring: everything that could
 * go wrong is decided in `runner.ts` as a pure function, so this file has no
 * judgement in it worth hiding a bug in.
 */
import { pathToFileURL } from "node:url";
import pino from "pino";
import postgres from "postgres";

import { agentToolsDb, createDb, type SqlClient } from "../db/identity.ts";
import { initWatchtower, reportError } from "../observe/watchtower.ts";
import { loadWorkerConfig } from "./config.ts";
import { createDeadLetterSink } from "./dead-letter.ts";
import { createLifecycle } from "./lifecycle.ts";
import { createMlClient } from "./ml-client.ts";
import { Q_AGENT_RULES, createQueue } from "./queue.ts";
import { createRunner } from "./runner.ts";
import { createPartStep, type StorageSigner } from "./steps.ts";
import { storageSignerFromEnv } from "../storage/signer.ts";
import { createLinkSpeakersStep, createSummarizeStep } from "./call-steps.ts";
import { createSummarizer } from "./summarizer.ts";
import { createSignalStep } from "./signal-step.ts";
import { createWorkflowStep } from "./workflow-step.ts";
import { sweepWorkflowTimers } from "./workflow-triggers.ts";
import { sweepMailboxes } from "./mail-poll.ts";
import { sweepMeetings } from "./meeting-prep.ts";
import { createConnectorsRepo } from "../api/connectors.ts";
import { createMailDraftsRepo } from "../api/mail-drafts.ts";
import { hasSignalTables } from "../db/capabilities.ts";
import { createDomainTools } from "../agent/domain-tools.ts";
import { createSummarizerResolver } from "../agent/skill-store.ts";

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { svc: "worker" },
  // Content never reaches a log (Invariant 7). Signed URLs are credentials.
  redact: { paths: ["audio_url", "url", "text", "words", "authorization"], censor: "[redacted]" },
});

/**
 * Percent-encode the password before the URL is parsed. Supabase generates
 * passwords containing `/`, `?` and `#`; a raw `/` terminates the URI's
 * authority section and the driver ends up resolving the USERNAME as a
 * hostname — `getaddrinfo ENOTFOUND postgres`, which reads exactly like a DNS
 * fault and is not one. Split on the LAST `@` so a password containing `@`
 * survives too. (db/README.md; it cost that session a round of misdiagnosis.)
 */
export function normalizeDbUrl(raw: string): string {
  const match = /^(\w+:\/\/)([^@]*)@(.*)$/s.exec(raw);
  if (!match) return raw;
  const [, scheme, credentials, rest] = match as unknown as [string, string, string, string];
  const lastAt = credentials.lastIndexOf(":");
  if (lastAt < 0) return raw;
  const user = credentials.slice(0, lastAt);
  const password = credentials.slice(lastAt + 1);
  if (password === "" || password !== decodeURIComponent(password)) return raw; // already encoded
  return `${scheme}${user}:${encodeURIComponent(password)}@${rest}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`worker: ${name} is required`);
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function main(): Promise<void> {
  const config = loadWorkerConfig();

  const appUrl = normalizeDbUrl(requireEnv("DATABASE_URL_APP"));
  // Required, no fallback — the api's posture (api/main.ts), adopted here by
  // the 2026-08-20 tenancy audit. `|| appUrl` silently turned the agent pool
  // into echo_app when the variable went missing; SET LOCAL ROLE would still
  // fail closed (42501) at the first agent-role transaction, but "refuses to
  // boot with the reason in one line" beats "boots and fails at first use".
  const agentUrl = normalizeDbUrl(requireEnv("DATABASE_URL_AGENT"));

  const pools = {
    app: postgres(appUrl, { max: config.concurrency + 2 }) as unknown as SqlClient,
    agent: postgres(agentUrl, { max: 2 }) as unknown as SqlClient,
  };

  const db = createDb(pools);
  const queue = createQueue(db);
  const lifecycle = createLifecycle(db);
  const ml = createMlClient({ baseUrl: config.mlBaseUrl, timeoutMs: config.mlTimeoutMs });

  // core/src/storage is shared surface (api/ needs it for playback). It
  // throws at construction when unconfigured, so a half-configured worker dies
  // at startup rather than dead-lettering every part for an hour while looking
  // like a pipeline bug.
  const storage: StorageSigner = storageSignerFromEnv();

  const summarizer = createSummarizer({
    db,
    // The SAME resolver the assistant's /slug uses. If the summarizer resolved
    // skills differently, an org that customised the summarizer prompt would
    // see it applied in one place and not the other — which reads as the model
    // behaving inconsistently rather than as a bug.
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
    // The agent-role handle, same as the api's tool wiring: the summarizer's
    // reads run under echo_agent's grant set, not echo_app's.
    deps: { db: agentToolsDb(db) },
    apiKey: process.env.OPENROUTER_API_KEY,
    fallbackModel: process.env.WORKER_SUMMARY_MODEL,
  });

  /*
   * M43: the mailbox belt. Two minutes matches the door's own due-window —
   * polling faster would spend provider quota to shorten a wait nobody is
   * watching, and the drafts land in a dock, not in front of a cursor.
   *
   * The connector repo needs the same OAuth configuration the api has; with
   * it absent the poller finds no usable connection and says so once per
   * sweep rather than failing in a loop.
   */
  const connectorOAuth = {
    publicWebUrl: process.env.echo_platform_web_url,
    encryptionKey: process.env.echo_platform_connector_encryption_key,
    providers: {
      google: {
        clientId: process.env.echo_platform_google_oauth_client_id,
        clientSecret: process.env.echo_platform_google_oauth_client_secret,
      },
      microsoft: {
        clientId: process.env.echo_platform_microsoft_oauth_client_id,
        clientSecret: process.env.echo_platform_microsoft_oauth_client_secret,
      },
    },
  };
  const mailConnectors = createConnectorsRepo(db, connectorOAuth);

  const runner = createRunner({
    queue,
    handlers: [
      createPartStep({ db, ml, queue, lifecycle, storage }),
      // ml + storage arm M39 voice matching; without them the step is
      // exactly the pre-M39 step (matching is best-effort either way)
      createLinkSpeakersStep({ db, queue, lifecycle, ml, storage }),
      createSummarizeStep({ db, lifecycle, summarizer, queue }),
      // M35: signals — briefs and digests, each run AS the owner
      createSignalStep({ db }),
      // M41 P1: the workflow executor — one message, one step, as-owner
      createWorkflowStep({
        db, queue,
        apiKey: process.env.OPENROUTER_API_KEY,
        fallbackModel: process.env.WORKER_SUMMARY_MODEL,
        /* M46: a graph may READ a connector source and WRITE a mail draft.
           Both are the same repos the hardcoded automations use — the point
           is one implementation of each wall, not two. */
        connectors: mailConnectors as never,
        drafts: createMailDraftsRepo(db, mailConnectors),
      }),
    ],
    config,
    sink: (() => {
      const inner = createDeadLetterSink({ db, lifecycle, queue, log });
      return {
        // item 10: a dead letter IS the operator-attention event — the
        // watchtower hears about it with codes only (queue + errorType;
        // the letter's own content stays in the archive table)
        onDeadLetter: async (
          ...args: Parameters<typeof inner.onDeadLetter>
        ): Promise<void> => {
          const [queueName, , info] = args;
          reportError(
            new Error(`dead letter on ${queueName}: ${(info as { errorType?: string })?.errorType ?? "unknown"}`),
            { where: "worker.deadLetter", queue: String(queueName) },
          );
          return inner.onDeadLetter(...args);
        },
      };
    })(),
    log,
  });

  /*
   * M35: the cron tick. Every 5 minutes, ask the 0074 definer door which
   * rules are due (metadata: ids only — the run itself executes under the
   * owner's identity via the queue), enqueue each firing, and stamp it
   * fired BEFORE anything else can tick — the stamp is the idempotency
   * guard, so a crash between stamp and handling costs one digest and
   * never duplicates one. Capability-gated and quiet when 0074 is pending.
   */
  const cronTick = async (): Promise<void> => {
    if (!(await hasSignalTables(db))) return;
    try {
      const due = await db.withoutIdentity((tx) =>
        tx.unsafe<{ id: string; owner_id: string; org_id: string; event: string }>(
          "select id, owner_id, org_id, event from echo.due_agent_rules()",
        ));
      for (const rule of due) {
        await db.withoutIdentity((tx) =>
          tx.unsafe("select echo.mark_agent_rule_fired($1)", [rule.id]));
        await queue.send(Q_AGENT_RULES, {
          event: "cron.weekly",
          ruleId: rule.id,
          ownerId: rule.owner_id,
          orgId: rule.org_id,
        });
      }
      if (due.length > 0) log.info({ fired: due.length }, "cron rules fired");
    } catch (error) {
      log.warn({ event: "cron_tick_failed", detail: (error as Error).name }, "cron tick failed");
    }
  };
  const cronTimer = setInterval(() => { void cronTick(); }, 5 * 60_000);
  cronTimer.unref();

  /*
   * M41 P3/P4: the workflow belt — resume/expire waits, fire due
   * schedules. One minute, not five: a human just clicked Approve and the
   * push path usually already won; this is the crash-gap belt, and a
   * minute is the difference between "it resumed" and "it feels stuck".
   */
  const workflowTimer = setInterval(() => {
    void sweepWorkflowTimers(db, queue, log as never);
  }, 60_000);
  workflowTimer.unref();

  const mailTimer = setInterval(() => {
    void sweepMailboxes({
      db,
      connectors: mailConnectors as never,
      drafts: createMailDraftsRepo(db, mailConnectors),
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      fallbackModel: process.env.WORKER_SUMMARY_MODEL,
      /* M46: with a queue in hand, the poller can hand a new message to the
         person's own workflow instead of drafting it itself */
      queue,
    }, log as never);
  }, 2 * 60_000);
  mailTimer.unref();

  /*
   * M44: the calendar belt. Five minutes, because the trigger is a
   * thirty-minute window rather than an instant — a brief that lands at
   * minute 28 instead of minute 30 is the same brief, and polling a calendar
   * as often as an inbox spends quota on facts that were already scheduled.
   */
  const meetingTimer = setInterval(() => {
    void sweepMeetings({
      db,
      connectors: mailConnectors as never,
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      fallbackModel: process.env.WORKER_SUMMARY_MODEL,
      /* M46: a `meeting.soon` workflow may take the meeting */
      queue,
    }, log as never);
  }, 5 * 60_000);
  meetingTimer.unref();

  let running = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log.info({ signal }, "draining");
      running = false;
    });
  }

  // item 10 (2026-08-23): scrubbed error reporting; dark without SENTRY_DSN
  initWatchtower("worker", log);
  process.on("unhandledRejection", (reason) => {
    reportError(reason, { where: "unhandledRejection" });
    log.error({ err: reason instanceof Error ? reason.constructor.name : typeof reason },
      "unhandled rejection");
  });

  log.info(
    { concurrency: config.concurrency, batch: config.batchSize, ml: config.mlBaseUrl },
    "worker started",
  );

  while (running) {
    try {
      const result = await runner.poll();
      if (result.claimed === 0) await sleep(config.idlePollMs);
    } catch (error) {
      // The loop itself failing (database down, say) must not kill the
      // process: it backs off and tries again, because the work is still in
      // the queue and will be there when the database returns.
      log.error({ err: (error as Error).message }, "poll failed; backing off");
      reportError(error, { where: "worker.poll" });
      await sleep(config.idlePollMs);
    }
  }

  await Promise.all([pools.app.end(), pools.agent.end()]);
  log.info("worker stopped");
}

// `pathToFileURL`, never a template string. On Windows `process.argv[1]` is
// `C:\path\main.ts` while `import.meta.url` is `file:///C:/path/main.ts` —
// drive letter, forward slashes, three slashes. The naive comparison is
// silently false, `main()` never runs, and the process exits 0 with no output:
// a clean start that did nothing, which is the most misleading symptom a
// service can have. Backend 1's api had the identical bug.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    log.error({ err: (error as Error).message }, "worker failed to start");
    process.exit(1);
  });
}
