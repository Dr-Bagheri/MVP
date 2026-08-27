/**
 * M41 P1 — the LIVE acceptance (prove-at-acceptance, the live-lane standard):
 * a real workflow through the real repo, the real queue, the real database
 * and a real model, as the fixture member. Self-seeding and self-sweeping
 * (rule 9's live-harness clause): it creates its workflow, runs it, asserts,
 * and removes every row it minted — at owner altitude, listed before delete.
 *
 * Run:  node --experimental-strip-types core/scripts/workflow-p1-live.ts
 * Spends: one small model completion. NOT part of any default suite.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { createDb, type SqlClient } from "../src/db/identity.ts";
import { createQueue, Q_WORKFLOW_STEP } from "../src/worker/queue.ts";
import { createRunner } from "../src/worker/runner.ts";
import { loadWorkerConfig } from "../src/worker/config.ts";
import { createWorkflowStep } from "../src/worker/workflow-step.ts";
import { createWorkflowRunsRepo } from "../src/api/workflow-runs.ts";
import { resolveIdentity } from "../src/db/actor.ts";

const PY = process.env.NEURAI_PYTHON
  ?? "C:/Users/amirreza/Desktop/neurai-mvp/server/.venv/Scripts/python.exe";

function secret(name: string): string {
  const code = "import os;os.environ.setdefault('NEURAI_DATA_DIR',os.path.expanduser('~/.neurai'));"
    + `from neurai.security import get_secret;print(get_secret('${name}') or '',end='')`;
  const out = execFileSync(PY, ["-c", code], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!out) throw new Error(`secret ${name} is empty`);
  return out;
}

/* SELF-SEEDED actors (rule 9's live-harness clause: a check depending on
   ambient data must seed its own). e2-prefixed ids; everything minted here
   is listed and deleted at the end, auth rows included. */
const ALICE = "e2000000-0000-4000-8000-0000000000a1"; // seeded org owner
const BOB = "e2000000-0000-4000-8000-0000000000b2";   // seeded member
const ORG = "e2000000-0000-4000-8000-00000000000a";
const HANDLE = "wf-p1-live";

const appUrl = secret("echo_platform_db_app_url");
const agentUrl = secret("echo_platform_db_agent_url");
const apiKey = secret("openrouter_key");

const pools = {
  app: postgres(appUrl, { max: 4 }) as unknown as SqlClient,
  agent: postgres(agentUrl, { max: 2 }) as unknown as SqlClient,
};
const db = createDb(pools);
const queue = createQueue(db);

const log = {
  info: (o: object, m: string) => console.log("info", m, JSON.stringify(o)),
  warn: (o: object, m: string) => console.log("WARN", m, JSON.stringify(o)),
  error: (o: object, m: string) => console.log("ERR ", m, JSON.stringify(o)),
};

async function seed(): Promise<void> {
  const owner = postgres(secret("echo_platform_db_url"), { max: 1 });
  await owner.begin(async (tx) => {
    await tx.unsafe(`insert into auth.users (id, email) values
      ($1, 'p1-owner@harness.local'), ($2, 'p1-member@harness.local')
      on conflict (id) do nothing`, [ALICE, BOB]);
    await tx.unsafe(`insert into echo.org (id, name) values ($1, 'P1 harness org')
      on conflict (id) do nothing`, [ORG]);
    await tx.unsafe(`insert into echo.app_user
        (id, org_id, email, display_name, role, status, accepted_at) values
      ($1, $3, 'p1-owner@harness.local', 'P1 Owner', 'owner', 'active', now()),
      ($2, $3, 'p1-member@harness.local', 'P1 Member', 'member', 'active', now())
      on conflict (id) do nothing`, [ALICE, BOB, ORG]);
  });
  await owner.end();
}

async function main() {
  await seed();
  const alice = await resolveIdentity(db, ALICE);
  const bob = await resolveIdentity(db, BOB);
  if (!alice.isActive || !bob.isActive) throw new Error("fixture identities not active — run db test first");

  // ── seed: alice authors, publishes ───────────────────────────────────
  const graph = {
    entry: "s1",
    steps: [
      { id: "s1", kind: "search", scope: "calls", limit: 5 },
      { id: "s2", kind: "ask", from: "{{s1}}",
        instruction: "در یک جملهٔ کوتاه بگو این فهرست چند مورد دارد." },
      { id: "s3", kind: "notify", card: "workflow_result" },
    ],
  };
  const [wf] = await db.withIdentity(alice, (tx) =>
    tx.unsafe<{ id: string }>(
      `insert into echo.workflow (org_id, handle, name, created_by)
       values ($1, $2, 'پذیرش P1', $3) returning id`,
      [ORG, HANDLE, ALICE]));
  const [version] = await db.withIdentity(alice, (tx) =>
    tx.unsafe<{ id: string }>(
      `insert into echo.workflow_version (workflow_id, org_id, version, graph, published_by)
       values ($1, $2, 1, $3::text::jsonb, $4) returning id`,
      [wf!.id, ORG, JSON.stringify(graph), ALICE]));
  await db.withIdentity(alice, (tx) =>
    tx.unsafe(`update echo.workflow set current_version_id = $2 where id = $1`,
      [wf!.id, version!.id]));
  console.log("seeded", { workflow: wf!.id, version: version!.id });

  // ── trigger: BOB presses Run through the real repo ───────────────────
  const runs = createWorkflowRunsRepo(db);
  const { run_id } = await runs.start(bob, HANDLE);
  console.log("triggered", { run_id });

  // ── execute: the real handler over the real queue ────────────────────
  const runner = createRunner({
    queue,
    handlers: [createWorkflowStep({ db, queue, apiKey,
      fallbackModel: process.env.WORKER_SUMMARY_MODEL ?? "google/gemini-2.5-flash" })],
    config: { ...loadWorkerConfig(), batchSize: 5, concurrency: 1,
      visibilityTimeoutSec: 180, idlePollMs: 200, maxAttempts: 3 },
    sink: { onDeadLetter: async (q, _b, info) => log.error({ q, info }, "dead letter") },
    log: log as never,
  });

  const deadline = Date.now() + 120_000;
  for (;;) {
    await runner.poll();
    const [run] = await db.withIdentity(bob, (tx) =>
      tx.unsafe<{ status: string; failure_code: string | null }>(
        `select status, failure_code from echo.workflow_run where id = $1`, [run_id]));
    if (!run) throw new Error("run vanished");
    if (run.status !== "running") { console.log("run settled", run); break; }
    if (Date.now() > deadline) throw new Error("timed out waiting for the run");
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── assert: the whole ledger, as bob ─────────────────────────────────
  const detail = await runs.detail(bob, run_id);
  console.log("RUN:", detail.run.status, detail.run.failure_code ?? "");
  for (const step of detail.steps) {
    const out = step.output === undefined ? "(no output)" :
      JSON.stringify(step.output).slice(0, 100);
    console.log(` step ${step.step_id}: ${step.status}`,
      step.agent_run_id ? `agent_run=${step.agent_run_id}` : "",
      step.model_cost ? `cost=${JSON.stringify(step.model_cost)}` : "", out);
  }
  const [card] = await db.withIdentity(bob, (tx) =>
    tx.unsafe<{ id: string; kind: string; title: string }>(
      `select id, kind, title from echo.agent_card
        where owner_id = $1 and kind = 'workflow_result'
        order by created_at desc limit 1`, [BOB]));
  console.log("CARD:", card ? `${card.kind} «${card.title}»` : "MISSING");

  const failures: string[] = [];
  if (detail.run.status !== "done") failures.push(`run status ${detail.run.status}`);
  if (detail.steps.length !== 3) failures.push(`${detail.steps.length} steps`);
  if (!detail.steps.every((s) => s.status === "done")) failures.push("a step not done");
  const ask = detail.steps.find((s) => s.step_id === "s2");
  if (!ask?.agent_run_id) failures.push("ask has no agent_run link (W8)");
  if (!ask?.model_cost) failures.push("ask cost not materialized");
  if (ask?.output === undefined) failures.push("ask produced no output");
  if (!card) failures.push("no dock card");

  // and the W16 negative control: ALICE (org owner) reads the ledger and
  // NOT bob's produce
  const asAlice = await runs.detail(alice, run_id);
  if (asAlice.steps.some((s) => s.output !== undefined)) {
    failures.push("W16 BREACH: the org owner read the member's step output");
  } else {
    console.log("W16 holds: the org owner sees the ledger, none of the produce");
  }

  // ── sweep: everything this harness minted, listed then deleted ───────
  const owner = postgres(secret("echo_platform_db_url"), { max: 1 });
  const agentRunIds = detail.steps.map((s) => s.agent_run_id).filter(Boolean);
  const counts = await owner.begin(async (tx) => {
    const del = async (label: string, sql: string, params: unknown[] = []) => {
      const rows = await tx.unsafe(sql, params as never);
      return `${label}=${rows.count}`;
    };
    return [
      await del("cards", `delete from echo.agent_card where owner_id = $1 and kind = 'workflow_result'`, [BOB]),
      await del("outputs", `delete from echo.workflow_step_output where owner_id = $1`, [BOB]),
      await del("steps", `delete from echo.workflow_step_run where run_id = $1`, [run_id]),
      await del("runs", `delete from echo.workflow_run where id = $1`, [run_id]),
    ];
  });
  // version + workflow need the current_version pointer cleared first;
  // then the seeded identities themselves, auth rows last (FK order)
  await owner.begin(async (tx) => {
    await tx.unsafe(`update echo.workflow set current_version_id = null where handle = $1`, [HANDLE]);
    await tx.unsafe(`delete from echo.workflow_version where workflow_id in (select id from echo.workflow where handle = $1)`, [HANDLE]);
    await tx.unsafe(`delete from echo.workflow where handle = $1`, [HANDLE]);
    if (agentRunIds.length > 0) {
      await tx.unsafe(`delete from echo.agent_run where id = any($1::uuid[])`, [agentRunIds as never]);
    }
    await tx.unsafe(`delete from echo.agent_session where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.app_user where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.org where id = $1`, [ORG]);
    await tx.unsafe(`delete from auth.users where id in ($1, $2)`, [ALICE, BOB]);
  });
  console.log("swept", counts.join(" "));
  await owner.end();
  await pools.app.end?.({ timeout: 2 } as never);
  await pools.agent.end?.({ timeout: 2 } as never);

  if (failures.length > 0) {
    console.error("ACCEPTANCE FAILED:", failures.join("; "));
    process.exit(1);
  }
  console.log("P1 LIVE ACCEPTANCE GREEN — real db, real queue, real model, as the member.");
}

main().catch((error) => { console.error(error); process.exit(1); });
