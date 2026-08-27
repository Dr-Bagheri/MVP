/**
 * M41 — the STARTERS' live acceptance: the one-press install path against
 * the real database, then one starter actually RUN to done. This is the
 * check behind the user's exact complaint ("make workflows work"): a shelf
 * that fills on a press, and a press that starts something real.
 *
 *   1  install `followups`  → enabled, v1, no trigger
 *   2  install `autotag`    → enabled, v1, trigger call.summarized
 *   3  the ENGINE catalogue lists both (what /v1/workflows/engine serves)
 *   4  a REPEAT install     → ConflictError, named starter_installed
 *   5  followups runs to `done` manually — the shelf is not decorative
 *
 * Self-seeding (e5 prefix), self-sweeping at BOTH ends.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { createDb, type SqlClient } from "../src/db/identity.ts";
import { createQueue } from "../src/worker/queue.ts";
import { createRunner } from "../src/worker/runner.ts";
import { loadWorkerConfig } from "../src/worker/config.ts";
import { createWorkflowStep } from "../src/worker/workflow-step.ts";
import { createWorkflowRunsRepo } from "../src/api/workflow-runs.ts";
import { createWorkflowAuthoringRepo, STARTER_WORKFLOWS } from "../src/api/workflow-authoring.ts";
import { resolveIdentity } from "../src/db/actor.ts";
import { ConflictError } from "../src/api/errors.ts";

const PY = process.env.NEURAI_PYTHON
  ?? "C:/Users/amirreza/Desktop/neurai-mvp/server/.venv/Scripts/python.exe";
function secret(name: string): string {
  const code = "import os;os.environ.setdefault('NEURAI_DATA_DIR',os.path.expanduser('~/.neurai'));"
    + `from neurai.security import get_secret;print(get_secret('${name}') or '',end='')`;
  const out = execFileSync(PY, ["-c", code], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!out) throw new Error(`secret ${name} is empty`);
  return out;
}

const ALICE = "e5000000-0000-4000-8000-0000000000a1"; // admin (installs)
const ORG = "e5000000-0000-4000-8000-00000000000a";
const CALL = "e5000000-0000-4000-8000-0000000000c1";

const pools = {
  app: postgres(secret("echo_platform_db_app_url"), { max: 4 }) as unknown as SqlClient,
  agent: postgres(secret("echo_platform_db_agent_url"), { max: 2 }) as unknown as SqlClient,
};
const db = createDb(pools);
const queue = createQueue(db);
const apiKey = secret("openrouter_key");
const ownerUrl = secret("echo_platform_db_url");

const log = {
  info: (o: object, m: string) => console.log("info", m, JSON.stringify(o)),
  warn: (o: object, m: string) => console.log("WARN", m, JSON.stringify(o)),
  error: (o: object, m: string) => console.log("ERR ", m, JSON.stringify(o)),
};

const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  console.log(cond ? "ok  " : "FAIL", label);
  if (!cond) failures.push(label);
};

async function sweepHarness(): Promise<void> {
  const cleaner = postgres(ownerUrl, { max: 1 });
  await cleaner.unsafe(
    `delete from pgmq.q_echo_workflow_step where message->>'orgId' = $1`, [ORG])
    .catch(() => undefined);
  const agentRunIds = (await cleaner.unsafe<{ agent_run_id: string }[]>(
    `select agent_run_id from echo.workflow_step_run
      where org_id = $1 and agent_run_id is not null`, [ORG]))
    .map((row) => row.agent_run_id);
  await cleaner.begin(async (tx) => {
    await tx.unsafe(`delete from echo.proposal_decision where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.agent_card where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow_step_output where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow_step_run where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow_run where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow_schedule where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow_auto_apply where org_id = $1`, [ORG]);
    await tx.unsafe(`update echo.workflow set current_version_id = null where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow_version where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow where org_id = $1`, [ORG]);
    if (agentRunIds.length > 0) {
      await tx.unsafe(`delete from echo.agent_run where id = any($1::uuid[])`, [agentRunIds as never]);
    }
    await tx.unsafe(`delete from echo.agent_session where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.call where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.app_user where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.org where id = $1`, [ORG]);
    await tx.unsafe(`delete from auth.users where id = $1`, [ALICE]);
  });
  await cleaner.end();
}

async function seed(): Promise<void> {
  const owner = postgres(ownerUrl, { max: 1 });
  await owner.begin(async (tx) => {
    await tx.unsafe(`insert into auth.users (id, email) values
      ($1, 'starters-admin@harness.local') on conflict (id) do nothing`, [ALICE]);
    await tx.unsafe(`insert into echo.org (id, name) values ($1, 'Starters harness org')
      on conflict (id) do nothing`, [ORG]);
    await tx.unsafe(`insert into echo.app_user
        (id, org_id, email, display_name, role, status, accepted_at) values
      ($1, $2, 'starters-admin@harness.local', 'Starters Admin', 'admin', 'active', now())
      on conflict (id) do nothing`, [ALICE, ORG]);
    await tx.unsafe(`update echo.app_user
        set preferred_model = 'google/gemini-2.5-flash' where org_id = $1`, [ORG]);
    /* one real call so followups' search has something to read */
    await tx.unsafe(`insert into echo.call (id, org_id, owner_id, title, scope, status) values
      ($1, $2, $3, 'جلسهٔ برنامه\u200cریزی محصول', 'org', 'ready')
      on conflict (id) do nothing`, [CALL, ORG, ALICE]);
  });
  await owner.end();
}

async function main() {
  await sweepHarness();
  await seed();
  const alice = (await resolveIdentity(db, ALICE)) as never;
  const runs = createWorkflowRunsRepo(db);
  const authoring = createWorkflowAuthoringRepo(db);

  // ── 1+2 the presses ──────────────────────────────────────────────────
  const followups = await authoring.installStarter(alice, "followups");
  check(followups.enabled === true && followups.current_version === 1
    && followups.trigger_event === null,
    "followups installs enabled at v1, manual");
  const autotag = await authoring.installStarter(alice, "autotag");
  check(autotag.enabled === true && autotag.current_version === 1
    && autotag.trigger_event === "call.summarized",
    "autotag installs enabled at v1, subscribed to call.summarized");

  // ── 3 the shelf ──────────────────────────────────────────────────────
  const shelf = await runs.catalogue(alice);
  check(STARTER_WORKFLOWS.followups.handle !== STARTER_WORKFLOWS.autotag.handle
    && shelf.some((w) => w.handle === STARTER_WORKFLOWS.followups.handle)
    && shelf.some((w) => w.handle === STARTER_WORKFLOWS.autotag.handle),
    "the engine catalogue lists both starters");

  // ── 4 the repeat press ───────────────────────────────────────────────
  let repeat: unknown = null;
  try { await authoring.installStarter(alice, "followups"); }
  catch (error) { repeat = error; }
  check(repeat instanceof ConflictError
    && (repeat as ConflictError & { code?: string }).code === "starter_installed",
    "a second install is the named 409, not a duplicate");

  // ── 5 followups actually RUNS ────────────────────────────────────────
  const { run_id } = await runs.start(alice, STARTER_WORKFLOWS.followups.handle);
  const runner = createRunner({
    queue,
    handlers: [createWorkflowStep({ db, queue, apiKey,
      fallbackModel: "google/gemini-2.5-flash" })],
    config: { ...loadWorkerConfig(), batchSize: 5, concurrency: 1,
      visibilityTimeoutSec: 180, idlePollMs: 200, maxAttempts: 3 },
    sink: { onDeadLetter: async (q, _b, info) => log.error({ q, info }, "dead letter") },
    log: log as never,
  });
  const deadline = Date.now() + 180_000;
  let final = { status: "queued", failure_code: null as string | null };
  for (;;) {
    await runner.poll();
    const [run] = await db.withIdentity(alice, (tx) =>
      tx.unsafe<{ status: string; failure_code: string | null }>(
        `select status, failure_code from echo.workflow_run where id = $1`, [run_id]));
    if (!run) throw new Error("run vanished");
    final = run;
    if (run.status === "done" || run.status === "failed" || run.status === "cancelled") break;
    if (Date.now() > deadline) throw new Error(`timed out at ${run.status}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  check(final.status === "done" && final.failure_code === null,
    `the installed starter runs to done (got ${final.status}${final.failure_code ? "/" + final.failure_code : ""})`);
  const [card] = await db.withIdentity(alice, (tx) =>
    tx.unsafe<{ id: string }>(
      `select id from echo.agent_card where org_id = $1 and kind = 'workflow_result'`, [ORG]));
  check(card !== undefined, "the run left its workflow_result card");

  await sweepHarness();
  console.log(failures.length === 0
    ? `\nSTARTERS LIVE: all ${6} checks green`
    : `\nSTARTERS LIVE: ${failures.length} FAILURES\n- ${failures.join("\n- ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().then(
  () => { void pools; },
  async (error) => {
    console.error("harness error:", error);
    await sweepHarness().catch(() => undefined);
    process.exit(1);
  },
);
