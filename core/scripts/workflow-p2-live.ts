/**
 * M41 P2 — the LIVE acceptance: a branchy, loopy workflow through the real
 * repo, queue, database and model, as a seeded member. Two runs:
 *
 *   A — the loop path: search → extract(topics) → decide(len>0) →
 *       foreach(max 2) → ask-per-item → notify. Proves typed extraction,
 *       the true branch, sequential iterations with per-iteration outputs,
 *       and the card.
 *   B — the branch not taken: decide(len>999) → else → notify. Proves the
 *       jumped-over foreach AND its body land as SKIPPED ledger rows — the
 *       path not taken stays visible.
 *
 * Self-seeding, self-sweeping (rule 9's live-harness clause), owner-
 * altitude cleanup listed before delete. Spends ~4 small model calls.
 *
 * Run:  node --experimental-strip-types core/scripts/workflow-p2-live.ts
 * Run AFTER deploying: the production worker polls the same queue and
 * must speak P2 — whichever worker claims a message, the assertions read
 * the database, which is the point.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { createDb, type SqlClient } from "../src/db/identity.ts";
import { createQueue } from "../src/worker/queue.ts";
import { createRunner } from "../src/worker/runner.ts";
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

const ALICE = "e3000000-0000-4000-8000-0000000000a1";
const BOB = "e3000000-0000-4000-8000-0000000000b2";
const ORG = "e3000000-0000-4000-8000-00000000000a";
const CALLS = ["e3000000-0000-4000-8000-0000000000c1", "e3000000-0000-4000-8000-0000000000c2"];

const pools = {
  app: postgres(secret("echo_platform_db_app_url"), { max: 4 }) as unknown as SqlClient,
  agent: postgres(secret("echo_platform_db_agent_url"), { max: 2 }) as unknown as SqlClient,
};
const db = createDb(pools);
const queue = createQueue(db);
const apiKey = secret("openrouter_key");

const log = {
  info: (o: object, m: string) => console.log("info", m, JSON.stringify(o)),
  warn: (o: object, m: string) => console.log("WARN", m, JSON.stringify(o)),
  error: (o: object, m: string) => console.log("ERR ", m, JSON.stringify(o)),
};

async function seed(): Promise<void> {
  const owner = postgres(secret("echo_platform_db_url"), { max: 1 });
  await owner.begin(async (tx) => {
    await tx.unsafe(`insert into auth.users (id, email) values
      ($1, 'p2-owner@harness.local'), ($2, 'p2-member@harness.local')
      on conflict (id) do nothing`, [ALICE, BOB]);
    await tx.unsafe(`insert into echo.org (id, name) values ($1, 'P2 harness org')
      on conflict (id) do nothing`, [ORG]);
    await tx.unsafe(`insert into echo.app_user
        (id, org_id, email, display_name, role, status, accepted_at) values
      ($1, $3, 'p2-owner@harness.local', 'P2 Owner', 'owner', 'active', now()),
      ($2, $3, 'p2-member@harness.local', 'P2 Member', 'member', 'active', now())
      on conflict (id) do nothing`, [ALICE, BOB, ORG]);
    /* the member's own calls — the material the extraction reads */
    await tx.unsafe(`insert into echo.call (id, org_id, owner_id, title, scope, status) values
      ($1, $3, $4, 'جلسهٔ بودجهٔ فصل پاییز', 'org', 'ready'),
      ($2, $3, $4, 'بازبینی قرارداد تأمین\u200cکننده', 'org', 'ready')
      on conflict (id) do nothing`, [CALLS[0], CALLS[1], ORG, BOB]);
  });
  await owner.end();
}

async function publish(alice: never, handle: string, graph: unknown): Promise<void> {
  const [wf] = await db.withIdentity(alice, (tx) =>
    tx.unsafe<{ id: string }>(
      `insert into echo.workflow (org_id, handle, name, created_by)
       values ($1, $2, $3, $4) returning id`,
      [ORG, handle, `پذیرش P2 ${handle}`, ALICE]));
  const [version] = await db.withIdentity(alice, (tx) =>
    tx.unsafe<{ id: string }>(
      `insert into echo.workflow_version (workflow_id, org_id, version, graph, published_by)
       values ($1, $2, 1, $3::text::jsonb, $4) returning id`,
      [wf!.id, ORG, JSON.stringify(graph), ALICE]));
  await db.withIdentity(alice, (tx) =>
    tx.unsafe(`update echo.workflow set current_version_id = $2 where id = $1`,
      [wf!.id, version!.id]));
}

async function waitFor(bob: never, runId: string): Promise<{ status: string; failure_code: string | null }> {
  const runner = createRunner({
    queue,
    handlers: [createWorkflowStep({ db, queue, apiKey,
      fallbackModel: process.env.WORKER_SUMMARY_MODEL ?? "google/gemini-2.5-flash" })],
    config: { mlBaseUrl: "http://127.0.0.1:0", mlTimeoutMs: 1000,
      batchSize: 5, concurrency: 1, visibilityTimeoutSec: 180, idlePollMs: 200,
      maxAttempts: 3 } as never,
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
    if (run.status !== "running") return run;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function main() {
  await seed();
  const alice = (await resolveIdentity(db, ALICE)) as never;
  const bob = (await resolveIdentity(db, BOB)) as never;

  await publish(alice, "wf-p2-loop", {
    entry: "s1",
    steps: [
      { id: "s1", kind: "search", scope: "calls", limit: 5 },
      { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
        instruction: "از عنوان جلسه\u200cها موضوع\u200cهای اصلی را استخراج کن." },
      { id: "s3", kind: "decide", on: "s2.topics.length", gt: 0, then: "s4", else: "s6" },
      { id: "s4", kind: "foreach", over: "{{s2.topics}}", max: 2, do: "s5" },
      { id: "s5", kind: "ask", instruction: "دربارهٔ «{{s4.item}}» یک جملهٔ کوتاه بنویس." },
      { id: "s6", kind: "notify", card: "workflow_result" },
    ],
  });
  await publish(alice, "wf-p2-skip", {
    entry: "s1",
    steps: [
      { id: "s1", kind: "search", scope: "calls", limit: 5 },
      { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1" },
      { id: "s3", kind: "decide", on: "s2.topics.length", gt: 999, then: "s4", else: "s6" },
      { id: "s4", kind: "foreach", over: "{{s2.topics}}", max: 2, do: "s5" },
      { id: "s5", kind: "ask", instruction: "دربارهٔ «{{s4.item}}» یک جمله بنویس." },
      { id: "s6", kind: "notify", card: "workflow_result" },
    ],
  });

  const runs = createWorkflowRunsRepo(db);
  const failures: string[] = [];

  // ── RUN A: the loop path ─────────────────────────────────────────────
  const a = await runs.start(bob, "wf-p2-loop");
  console.log("A triggered", a.run_id);
  const aEnd = await waitFor(bob, a.run_id);
  const aDetail = await runs.detail(bob, a.run_id);
  console.log("A:", aEnd.status, aEnd.failure_code ?? "");
  for (const step of aDetail.steps) {
    console.log(`  ${step.step_id}[${step.iteration}] ${step.status}`,
      step.output !== undefined ? JSON.stringify(step.output).slice(0, 90) : "");
  }
  if (aEnd.status !== "done") failures.push(`A ended ${aEnd.status}/${aEnd.failure_code}`);
  const topics = (aDetail.steps.find((s) => s.step_id === "s2")?.output as { topics?: string[] })?.topics;
  if (!Array.isArray(topics) || topics.length === 0) failures.push("A: extraction produced no topics");
  const loopCount = Math.min(topics?.length ?? 0, 2);
  const iterations = aDetail.steps.filter((s) => s.step_id === "s5" && s.status === "done");
  if (iterations.length !== loopCount) {
    failures.push(`A: expected ${loopCount} iterations, saw ${iterations.length}`);
  }
  if (!iterations.every((s) => s.output !== undefined)) failures.push("A: an iteration made no output");

  // ── RUN B: the branch not taken, visible ─────────────────────────────
  const b = await runs.start(bob, "wf-p2-skip");
  console.log("B triggered", b.run_id);
  const bEnd = await waitFor(bob, b.run_id);
  const bDetail = await runs.detail(bob, b.run_id);
  console.log("B:", bEnd.status, bEnd.failure_code ?? "");
  for (const step of bDetail.steps) {
    console.log(`  ${step.step_id}[${step.iteration}] ${step.status}`);
  }
  if (bEnd.status !== "done") failures.push(`B ended ${bEnd.status}/${bEnd.failure_code}`);
  const skipped = bDetail.steps.filter((s) => s.status === "skipped").map((s) => s.step_id).sort();
  if (skipped.join(",") !== "s4,s5") {
    failures.push(`B: expected s4,s5 SKIPPED, saw [${skipped.join(",")}]`);
  }
  if (bDetail.steps.find((s) => s.step_id === "s6")?.status !== "done") {
    failures.push("B: the else branch's notify did not run");
  }

  // ── sweep everything, agent runs included ────────────────────────────
  const agentRunIds = [...aDetail.steps, ...bDetail.steps]
    .map((s) => s.agent_run_id).filter(Boolean);
  const owner = postgres(secret("echo_platform_db_url"), { max: 1 });
  await owner.begin(async (tx) => {
    await tx.unsafe(`delete from echo.agent_card where owner_id = $1`, [BOB]);
    await tx.unsafe(`delete from echo.workflow_step_output where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow_step_run where org_id = $1`, [ORG]);
    await tx.unsafe(`delete from echo.workflow_run where org_id = $1`, [ORG]);
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
  await owner.end();
  await pools.app.end?.({ timeout: 2 } as never);
  await pools.agent.end?.({ timeout: 2 } as never);

  if (failures.length > 0) {
    console.error("ACCEPTANCE FAILED:", failures.join("; "));
    process.exit(1);
  }
  console.log("P2 LIVE ACCEPTANCE GREEN — typed extraction, a real branch both ways, a bounded loop, and the path not taken visible on the ledger.");
}

main().catch((error) => { console.error(error); process.exit(1); });
