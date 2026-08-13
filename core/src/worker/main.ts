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

import { createDb, type SqlClient } from "../db/identity.ts";
import { loadWorkerConfig } from "./config.ts";
import { createDeadLetterSink } from "./dead-letter.ts";
import { createLifecycle } from "./lifecycle.ts";
import { createMlClient } from "./ml-client.ts";
import { createQueue } from "./queue.ts";
import { createRunner } from "./runner.ts";
import { createPartStep, type StorageSigner } from "./steps.ts";
import { storageSignerFromEnv } from "../storage/signer.ts";
import { createLinkSpeakersStep, createSummarizeStep } from "./call-steps.ts";
import { createSummarizer } from "./summarizer.ts";
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
  const agentUrl = normalizeDbUrl(process.env.DATABASE_URL_AGENT || appUrl);

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
    deps: { db },
    apiKey: process.env.OPENROUTER_API_KEY,
    fallbackModel: process.env.WORKER_SUMMARY_MODEL,
  });

  const runner = createRunner({
    queue,
    handlers: [
      createPartStep({ db, ml, queue, lifecycle, storage }),
      createLinkSpeakersStep({ db, queue, lifecycle }),
      createSummarizeStep({ db, lifecycle, summarizer, queue }),
    ],
    config,
    sink: createDeadLetterSink({ db, lifecycle, queue, log }),
    log,
  });

  let running = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log.info({ signal }, "draining");
      running = false;
    });
  }

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
