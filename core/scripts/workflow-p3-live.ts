/**
 * M41 P3+P4 — the LIVE acceptance: the §10 path end to end on production,
 * with a REAL decision in the middle, through the same repo door the UI
 * presses. Six movements:
 *
 *   A  APPROVE   — park at wait → owner approves → apply writes tags ON
 *                  the agent role → notify. Replay of the decision → 409.
 *   B  REJECT    — admin's approval REFUSED first (the matrix's ordinary
 *                  refusal), then the owner rejects → apply SKIPPED,
 *                  tags untouched.
 *   C  AUTO      — all three switches on → no park; the decision row is
 *                  via_standing with the owner stamped and the standing
 *                  rule naming the admin.
 *   D  SCHEDULE  — a due schedule fires through the CAS belt.
 *   E  EVENT     — the pipeline hook fires the subscribed workflow for a
 *                  fact; a double delivery stays ONE live run.
 *   F  EXPIRY    — a question nobody answers becomes an answer.
 *
 * Self-seeding, self-sweeping, owner-altitude cleanup.
 * Run AFTER deploying (the production worker shares the queue).
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { createDb, type SqlClient } from "../src/db/identity.ts";
import { createQueue } from "../src/worker/queue.ts";
import { createRunner } from "../src/worker/runner.ts";
import { loadWorkerConfig } from "../src/worker/config.ts";
import { createWorkflowStep } from "../src/worker/workflow-step.ts";
import { sweepWorkflowTimers, enqueueWorkflowEvents } from "../src/worker/workflow-triggers.ts";
import { createWorkflowRunsRepo } from "../src/api/workflow-runs.ts";
import { createWorkflowAuthoringRepo } from "../src/api/workflow-authoring.ts";
import { resolveIdentity } from "../src/db/actor.ts";
import { ConflictError, NotActivatedError } from "../src/api/errors.ts";

const PY = process.env.NEURAI_PYTHON
  ?? "C:/Users/amirreza/Desktop/neurai-mvp/server/.venv/Scripts/python.exe";
function secret(name: string): string {
  const code = "import os;os.environ.setdefault('NEURAI_DATA_DIR',os.path.expanduser('~/.neurai'));"
    + `from neurai.security import get_secret;print(get_secret('${name}') or '',end='')`;
  const out = execFileSync(PY, ["-c", code], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!out) throw new Error(`secret ${name} is empty`);
  return out;
}

const ALICE = "e4000000-0000-4000-8000-0000000000a1";
const BOB = "e4000000-0000-4000-8000-0000000000b2";
const ORG = "e4000000-0000-4000-8000-00000000000a";
const CALL = "e4000000-0000-4000-8000-0000000000c1";
const CALL_F = "e4000000-0000-4000-8000-0000000000c2";

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

async function seed(): Promise<void> {
  const owner = postgres(ownerUrl, { max: 1 });
  await owner.begin(async (tx) => {
    await tx.unsafe(`insert into auth.users (id, email) values
      ($1, 'p3-owner@harness.local'), ($2, 'p3-member@harness.local')
      on conflict (id) do nothing`, [ALICE, BOB]);
    await tx.unsafe(`insert into echo.org (id, name) values ($1, 'P3 harness org')
      on conflict (id) do nothing`, [ORG]);
    await tx.unsafe(`insert into echo.app_user
        (id, org_id, email, display_name, role, status, accepted_at) values
      ($1, $3, 'p3-owner@harness.local', 'P3 Owner', 'owner', 'active', now()),
      ($2, $3, 'p3-member@harness.local', 'P3 Member', 'member', 'active', now())
      on conflict (id) do nothing`, [ALICE, BOB, ORG]);
    await tx.unsafe(`update echo.app_user
        set preferred_model = 'google/gemini-2.5-flash' where org_id = $1`, [ORG]);
    await tx.unsafe(`insert into echo.call (id, org_id, owner_id, title, scope, status) values
      ($1, $3, $4, 'جلسهٔ بودجه و قرارداد', 'org', 'ready'),
      ($2, $3, $4, 'جلسهٔ برنامهٔ فروش', 'org', 'ready')
      on conflict (id) do nothing`, [CALL, CALL_F, ORG, BOB]);
  });
  await owner.end();
}

async function drive(bob: never, runId: string, until: (status: string) => boolean) {
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
  for (;;) {
    await runner.poll();
    const [run] = await db.withIdentity(bob, (tx) =>
      tx.unsafe<{ status: string; failure_code: string | null }>(
        `select status, failure_code from echo.workflow_run where id = $1`, [runId]));
    if (!run) throw new Error("run vanished");
    if (until(run.status)) return run;
    if (Date.now() > deadline) throw new Error(`timed out at ${run.status}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function main() {
  await sweepHarness();     // a crashed prior run leaves residue; start clean
  await seed();
  const alice = (await resolveIdentity(db, ALICE)) as never;
  const bob = (await resolveIdentity(db, BOB)) as never;
  const runs = createWorkflowRunsRepo(db);
  const authoring = createWorkflowAuthoringRepo(db);

  // ── P5 server-side: authored without SQL ─────────────────────────────
  const wf = await authoring.create(alice, { name: "پیگیری P3", handle: "wf-p3-writes" });
  const { version } = await authoring.publish(alice, wf.id, {
    max_autonomy: "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 5 },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
          instruction: "از عنوان جلسه\u200cها موضوع\u200cها را دربیاور." },
        { id: "s3", kind: "propose", proposal: "add_tags",
          from: "{{s2.topics}}", call: "{{trigger.call_id}}" },
        { id: "s4", kind: "wait", on: "decision" },
        { id: "s5", kind: "apply", from: "s3" },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  });
  await authoring.update(alice, wf.id, { enabled: true });
  check(version === 1, "P5: authored and published through the repo, no SQL");

  // ── A: APPROVE ───────────────────────────────────────────────────────
  const a = await runs.signal(bob, "wf-p3-writes", CALL);
  let run = await drive(bob, a.run_id, (s) => s === "waiting" || s === "failed" || s === "refused");
  check(run.status === "waiting", `A parked at the wait (got ${run.status} ${run.failure_code ?? ""})`);
  let detail = await runs.detail(bob, a.run_id);
  const proposalA = detail.steps.find((s) => s.step_id === "s3");
  check(proposalA?.output !== undefined, "A: the proposal stands on the ledger");

  // the ordinary refusal FIRST: the ADMIN cannot approve the member's run
  let adminRefused = false;
  try {
    await runs.decide(alice, a.run_id, { step_id: "s3", decision: "approve" });
  } catch (error) {
    adminRefused = error instanceof NotActivatedError;
  }
  check(adminRefused, "MATRIX: the org owner cannot approve the member's run — consent is the subject's");

  const decided = await runs.decide(bob, a.run_id, { step_id: "s3", decision: "approve" });
  check(decided.resumed === true, "A: the owner's approval resumed the run (push path)");
  run = await drive(bob, a.run_id, (s) => s === "done" || s === "failed");
  check(run.status === "done", `A ran to done (got ${run.status})`);
  const [callRow] = await db.withIdentity(bob, (tx) =>
    tx.unsafe<{ tags: string[] }>(`select tags from echo.call where id = $1`, [CALL]));
  check((callRow?.tags ?? []).length > 0, `A: THE WRITE LANDED — tags ${JSON.stringify(callRow?.tags)}`);

  let replay = false;
  try {
    await runs.decide(bob, a.run_id, { step_id: "s3", decision: "reject" });
  } catch (error) {
    replay = error instanceof ConflictError;
  }
  check(replay, "A: a second decision is one insert and one 409 — the replay wall");

  // ── B: REJECT ────────────────────────────────────────────────────────
  const b = await runs.signal(bob, "wf-p3-writes", CALL); // A is terminal → a new live run is legal
  await drive(bob, b.run_id, (s) => s === "waiting");
  const tagsBefore = (await db.withIdentity(bob, (tx) =>
    tx.unsafe<{ tags: string[] }>(`select tags from echo.call where id = $1`, [CALL])))[0]?.tags;
  await runs.decide(bob, b.run_id, { step_id: "s3", decision: "reject" });
  run = await drive(bob, b.run_id, (s) => s === "done" || s === "failed");
  detail = await runs.detail(bob, b.run_id);
  check(run.status === "done"
    && detail.steps.find((s) => s.step_id === "s5")?.status === "skipped",
    "B: a human's no lands the apply SKIPPED and the run still finishes");
  const tagsAfter = (await db.withIdentity(bob, (tx) =>
    tx.unsafe<{ tags: string[] }>(`select tags from echo.call where id = $1`, [CALL])))[0]?.tags;
  check(JSON.stringify(tagsBefore) === JSON.stringify(tagsAfter),
    "B: nothing was written on a reject");

  // ── C: AUTO — three switches on ──────────────────────────────────────
  const owner = postgres(ownerUrl, { max: 1 });
  await owner.unsafe(`update echo.app_user set autonomy = 'act' where id = $1`, [BOB]);
  await owner.end();
  await authoring.setAutoApply(alice, "add_tags", true);
  const c = await runs.signal(bob, "wf-p3-writes", CALL);
  run = await drive(bob, c.run_id, (s) => s === "done" || s === "waiting" || s === "failed");
  check(run.status === "done", `C: with all three switches on, no park — straight to done (got ${run.status})`);
  const owner2 = postgres(ownerUrl, { max: 1 });
  const [autoDecision] = await owner2.unsafe<{ via_standing: boolean; decided_by: string }[]>(
    `select pd.via_standing, pd.decided_by
       from echo.proposal_decision pd
       join echo.workflow_step_run sr on sr.id = pd.proposal_id
      where sr.run_id = $1`, [c.run_id]);
  check(autoDecision?.via_standing === true && autoDecision?.decided_by === BOB,
    "C: the minted decision is via_standing, stamped with the run's owner (W17 at the wall)");
  await owner2.end();

  // ── D: SCHEDULE ──────────────────────────────────────────────────────
  // a SCHEDULABLE workflow: no call bindings — a schedule carries no item,
  // and the executor now refuses {{trigger.call_id}} on one BY NAME (the
  // first D attempt bound the schedule id as a call and poisoned itself)
  const wfSched = await authoring.create(alice, { name: "زمان‌بندی P3", handle: "wf-p3-sched" });
  await authoring.publish(alice, wfSched.id, {
    max_autonomy: "watch",
    graph: { entry: "s1", steps: [
      { id: "s1", kind: "search", scope: "calls", limit: 3 },
      { id: "s2", kind: "notify", card: "workflow_result" },
    ] },
  });
  await authoring.update(alice, wfSched.id, { enabled: true });
  const scheduled = await runs.schedule(bob, "wf-p3-sched", { cadence: "daily" });
  const owner3 = postgres(ownerUrl, { max: 1 });
  await owner3.unsafe(`update echo.workflow_schedule set next_due = now() - interval '1 minute'
    where id = $1`, [scheduled.schedule_id]);
  await owner3.end();
  await sweepWorkflowTimers(db, queue, log as never);
  {
    const probe = postgres(ownerUrl, { max: 1 });
    const [after] = await probe.unsafe<{ last_fired_at: string | null; next_due: string }[]>(
      `select last_fired_at, next_due from echo.workflow_schedule where id = $1`,
      [scheduled.schedule_id]);
    console.log("D probe:", JSON.stringify(after));
    await probe.end();
  }
  const [schedRun] = await db.withIdentity(bob, (tx) =>
    tx.unsafe<{ id: string }>(
      `select id from echo.workflow_run
        where trigger_kind = 'schedule' and trigger_ref = $1`, [scheduled.schedule_id]));
  check(schedRun !== undefined, "D: the due schedule fired through the CAS belt");
  if (schedRun) {
    const schedEnd = await drive(bob, schedRun.id, (s) => s !== "running");
    check(schedEnd.status === "done", `D: the scheduled run finished (got ${schedEnd.status})`);
  }

  // ── E: EVENT + the one-live-run dedup ────────────────────────────────
  await authoring.update(alice, wf.id, { trigger_event: "call.summarized" });
  await enqueueWorkflowEvents(db, bob, "call.summarized", CALL, queue, log as never);
  await enqueueWorkflowEvents(db, bob, "call.summarized", CALL, queue, log as never);
  const eventRuns = await db.withIdentity(bob, (tx) =>
    tx.unsafe<{ id: string }>(
      `select id from echo.workflow_run
        where trigger_kind = 'event' and trigger_ref = $1`, [CALL]));
  check(eventRuns.length === 1, "E: a double-delivered fact is ONE live run (W26)");
  if (eventRuns[0]) await drive(bob, eventRuns[0].id, (s) => s === "done" || s === "waiting" || s === "failed");

  // ── F: EXPIRY ────────────────────────────────────────────────────────
  await authoring.setAutoApply(alice, "add_tags", false);
  const f = await runs.signal(bob, "wf-p3-writes", CALL_F); // a REAL call: propose binds trigger.call_id
  await drive(bob, f.run_id, (s) => s === "waiting");
  const owner4 = postgres(ownerUrl, { max: 1 });
  await owner4.unsafe(`update echo.workflow_run set wait_deadline = now() - interval '1 hour'
    where id = $1`, [f.run_id]);
  await owner4.end();
  await sweepWorkflowTimers(db, queue, log as never);
  const [expired] = await db.withIdentity(bob, (tx) =>
    tx.unsafe<{ status: string }>(
      `select status from echo.workflow_run where id = $1`, [f.run_id]));
  check(expired?.status === "expired",
    "F: a question nobody answered is an answer — the run expired, loudly");
  const [card] = await db.withIdentity(bob, (tx) =>
    tx.unsafe<{ id: string }>(
      `select id from echo.agent_card where owner_id = $1 and kind = 'workflow_result'
        order by created_at desc limit 1`, [BOB]));
  check(card !== undefined, "F: the expiry raised a card in the owner's dock");

  await sweepHarness();
  await pools.app.end?.({ timeout: 2 } as never);
  await pools.agent.end?.({ timeout: 2 } as never);

  if (failures.length > 0) {
    console.error(`ACCEPTANCE FAILED (${failures.length}):`, failures.join(" | "));
    process.exit(1);
  }
  console.log("P3+P4 LIVE ACCEPTANCE GREEN — a human in the middle, the matrix walked live, both new triggers fired, and silence became an answer.");
}

/** everything the harness minted, gone — safe to call on an empty slate,
    which is why it ALSO runs first (a crashed prior run must not make the
    next one fail on its residue) */
async function sweepHarness(): Promise<void> {
  const cleaner = postgres(ownerUrl, { max: 1 });
  /* drain THIS org's in-flight step messages: a swept run's leftover
     message otherwise dead-letters on the next harness run as
     owner_cannot_see_run — correct behavior, noisy acceptance */
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
    await tx.unsafe(`delete from auth.users where id in ($1, $2)`, [ALICE, BOB]);
  });
  console.log("swept the harness org whole");
  await cleaner.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
