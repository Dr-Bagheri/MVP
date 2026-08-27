/**
 * M41 P1+P2 — the executor's instruments (§9 of the design):
 *
 *  1. DISPATCH COVERAGE: the executor map's keys ARE the executable
 *     vocabulary, both directions — derived from the producer's exports,
 *     never hand-enumerated.
 *  2. OWNER-UNRESOLVABLE PERFORMS NO WRITE (W10/invariant 2) — asserted
 *     POSITIVELY by a recording fake; the fake's ability to catch writes
 *     is itself witnessed by the adopt test seeing the ensure-insert.
 *  3. REDELIVERY ADOPTS (W26): a settled run consumes; a done step
 *     advances without re-executing.
 *  4. P2 control flow: a decide JUMPS and the jumped-over path lands as
 *     SKIPPED ledger rows; a foreach drives its body one iteration per
 *     message and ends the loop where the recorded count says; an empty
 *     list skips the body VISIBLY.
 *  5. Extract's contract: invalid JSON earns exactly ONE retry carrying
 *     the named errors, then a loud schema_invalid that fails the run.
 *
 * The fake is scripted at the STATEMENT level with params visible — the
 * altitude the real Db speaks — and records every call.
 */
import { describe, expect, it } from "vitest";
import {
  EXECUTABLE_STEP_KINDS,
  WORKFLOW_STEP_KINDS,
} from "../src/api/vocabulary.ts";
import { validateExtractOutput, renderSchemaContract, EXTRACT_SCHEMAS } from "../src/api/workflow-graph.ts";
import type { Db } from "../src/db/identity.ts";
import type { Queue } from "../src/worker/queue.ts";
import { StepError } from "../src/worker/runner.ts";
import {
  createWorkflowStep,
  fenceUntrusted,
  parseModelJson,
  WORKFLOW_EXECUTORS,
} from "../src/worker/workflow-step.ts";

/* ── the recording fake ──────────────────────────────────────────────── */

interface Recorded { sql: string; params: unknown[] }
type Responder = (sql: string, params: unknown[]) => unknown[] | undefined;

function scriptedDb(respond: Responder) {
  const calls: Recorded[] = [];
  const tx = {
    unsafe: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve(respond(sql, params) ?? []);
    },
  };
  const db = {
    withActor: (_a: string, fn: (t: unknown) => unknown) => fn(tx),
    withIdentity: (_i: unknown, fn: (t: unknown) => unknown) => fn(tx),
    withoutIdentity: (fn: (t: unknown) => unknown) => fn(tx),
  } as unknown as Db;
  return { db, calls };
}

function fakeQueue() {
  const sent: { queue: string; body: { stepId: string; iteration: number } }[] = [];
  const queue = {
    send: (name: string, body: never) => { sent.push({ queue: name, body }); return Promise.resolve(1); },
    read: () => Promise.resolve([]),
    remove: () => Promise.resolve(),
    archive: () => Promise.resolve(),
    delay: () => Promise.resolve(),
  } as unknown as Queue;
  return { queue, sent };
}

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

const OWNER = "02000000-0000-4000-8000-000000000002";
const ORG = "0a000000-0000-4000-8000-00000000000a";
const RUN = "94000000-0000-4000-8000-000000000021";

const payload = (stepId: string, iteration = 0) =>
  ({ runId: RUN, stepId, iteration, ownerId: OWNER, orgId: ORG });

const ACTIVE_SELF = [{ id: OWNER, org_id: ORG, role: "member", status: "active", org_status: "active" }];

const writes = (calls: Recorded[]) =>
  calls.filter((c) => /^\s*(insert|update|delete)/i.test(c.sql));

/**
 * One respond function for a whole scenario: a graph, per-step ledger
 * states, per-step recorded outputs. Param-aware, because readOutput's
 * SQL is identical for every step and only $2 says which.
 */
function scenario(options: {
  graph: unknown;
  budget?: Record<string, unknown>;
  runStatus?: string;
  stepStatus?: Record<string, string>;     // stepId → ledger status
  outputs?: Record<string, unknown>;       // stepId → recorded output
  stepCount?: number;
}): Responder {
  return (sql, params) => {
    if (/from echo\.app_user/i.test(sql) && /org_status/i.test(sql)) return ACTIVE_SELF;
    if (/from echo\.workflow_run r/i.test(sql)) {
      return [{ id: RUN, org_id: ORG, owner_id: OWNER,
        workflow_id: "94000000-0000-4000-8000-000000000001",
        status: options.runStatus ?? "running", trigger_kind: "manual",
        trigger_ref: null, workflow_name: "پذیرش" }];
    }
    if (/workflow_graph_for_run/i.test(sql)) {
      return [{ graph: options.graph, budget: options.budget ?? {} }];
    }
    if (/select id, status from echo\.workflow_step_run/i.test(sql)) {
      const stepId = String(params[1]);
      return [{ id: `sr-${stepId}-${String(params[2])}`,
        status: options.stepStatus?.[stepId] ?? "running" }];
    }
    if (/select o\.output/i.test(sql)) {
      const stepId = String(params[1]);
      const output = options.outputs?.[stepId];
      return output === undefined ? [] : [{ output }];
    }
    if (/agent_run_id is not null/i.test(sql)) return [{ n: "0" }];
    if (/count\(\*\)/i.test(sql)) return [{ n: String(options.stepCount ?? 1) }];
    if (/from echo\.agent_run where id/i.test(sql)) return [{ tokens_in: 10, tokens_out: 5 }];
    return undefined;
  };
}

/* ── 1. dispatch coverage ────────────────────────────────────────────── */

describe("dispatch coverage (instrument 1)", () => {
  it("the executor map's keys ARE the executable vocabulary — both directions", () => {
    expect(Object.keys(WORKFLOW_EXECUTORS).sort())
      .toEqual([...EXECUTABLE_STEP_KINDS].sort());
  });
  it("everything executable is a declared step kind", () => {
    const orphans = EXECUTABLE_STEP_KINDS
      .filter((kind) => !(WORKFLOW_STEP_KINDS as readonly string[]).includes(kind));
    expect(orphans).toEqual([]);
  });
});

/* ── 2. no owner, no write ───────────────────────────────────────────── */

describe("owner resolution (W10, instrument 4)", () => {
  it("an unknown owner performs ZERO product writes and dead-letters by name", async () => {
    const { db, calls } = scriptedDb((sql) =>
      /from echo\.app_user/i.test(sql) ? [] : undefined);
    const { queue, sent } = fakeQueue();
    const handler = createWorkflowStep({ db, queue });

    await expect(handler.handle(payload("s1"), { attempt: 1, log: silentLog }))
      .rejects.toSatisfy((error: unknown) =>
        error instanceof StepError
        && error.errorType === "owner_not_found" && error.retryable === false);

    expect(writes(calls)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("an inactive owner parks retryable — and still writes nothing", async () => {
    const { db, calls } = scriptedDb((sql) =>
      /from echo\.app_user/i.test(sql) ? [{ ...ACTIVE_SELF[0], status: "pending" }] : undefined);
    const { queue, sent } = fakeQueue();
    const handler = createWorkflowStep({ db, queue });

    await expect(handler.handle(payload("s1"), { attempt: 1, log: silentLog }))
      .rejects.toSatisfy((error: unknown) =>
        error instanceof StepError
        && error.errorType === "owner_inactive" && error.retryable === true);

    expect(writes(calls)).toEqual([]);
    expect(sent).toEqual([]);
  });
});

/* ── 3. adopt, never repeat ──────────────────────────────────────────── */

const LINEAR = {
  entry: "s1",
  steps: [
    { id: "s1", kind: "search", scope: "calls" },
    { id: "s2", kind: "notify", card: "workflow_result" },
  ],
};

describe("redelivery adopts (W26, instrument 3)", () => {
  it("a message for a settled run is consumed with no writes and no sends", async () => {
    const { db, calls } = scriptedDb(scenario({ graph: LINEAR, runStatus: "done" }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s1"), { attempt: 2, log: silentLog });
    expect(writes(calls)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a DONE step advances — enqueues the next, re-executes nothing", async () => {
    const { db, calls } = scriptedDb(scenario({ graph: LINEAR, stepStatus: { s1: "done" } }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s1"), { attempt: 2, log: silentLog });
    const materially = writes(calls).filter((c) => !/on conflict on constraint step_once/i.test(c.sql));
    expect(materially).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.stepId).toBe("s2");
    expect(calls.some((c) => /from echo\.call\b/i.test(c.sql))).toBe(false);
  });
});

/* ── 4. P2 control flow ──────────────────────────────────────────────── */

const BRANCHY = {
  entry: "s1",
  steps: [
    { id: "s1", kind: "extract", schema: "topics_v1" },
    { id: "s2", kind: "decide", on: "s1.topics.length", gt: 0, then: "s4", else: "s3" },
    { id: "s3", kind: "notify", card: "workflow_result" },
    { id: "s4", kind: "notify", card: "workflow_result" },
  ],
};

describe("decide (W6): jumps forward, skips visibly", () => {
  it("true branch jumps over s3, materializing it as SKIPPED", async () => {
    const { db, calls } = scriptedDb(scenario({
      graph: BRANCHY, outputs: { s1: { topics: ["a", "b"] } },
    }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s2"), { attempt: 1, log: silentLog });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.stepId).toBe("s4");
    const skipped = writes(calls).filter((c) => /'skipped'/.test(c.sql));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.params[3]).toBe("s3");    // the step it skipped, by name
  });

  it("false branch takes the else — nothing skipped, s3 enqueued", async () => {
    const { db, calls } = scriptedDb(scenario({
      graph: BRANCHY, outputs: { s1: { topics: [] } },
    }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s2"), { attempt: 1, log: silentLog });
    expect(sent[0]!.body.stepId).toBe("s3");
    expect(writes(calls).filter((c) => /'skipped'/.test(c.sql))).toEqual([]);
  });

  it("__end skips every remaining step and finishes the run", async () => {
    const graph = {
      entry: "s1",
      steps: [
        { id: "s1", kind: "extract", schema: "topics_v1" },
        { id: "s2", kind: "decide", on: "s1.topics.length", gt: 99, then: "s3", else: "__end" },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    };
    const { db, calls } = scriptedDb(scenario({ graph, outputs: { s1: { topics: ["x"] } } }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s2"), { attempt: 1, log: silentLog });
    expect(sent).toEqual([]);
    expect(writes(calls).filter((c) => /'skipped'/.test(c.sql))).toHaveLength(1);
    const runDone = writes(calls).filter((c) => /update echo\.workflow_run/i.test(c.sql));
    expect(runDone).toHaveLength(1);
    expect(runDone[0]!.params[1]).toBe("done");
  });
});

const LOOPY = {
  entry: "s1",
  steps: [
    { id: "s1", kind: "extract", schema: "topics_v1" },
    { id: "s2", kind: "foreach", over: "{{s1.topics}}", max: 2, do: "s3" },
    { id: "s3", kind: "notify", card: "workflow_result" },
    { id: "s4", kind: "notify", card: "workflow_result" },
  ],
};

describe("foreach: bounded, sequential, loud about its cap", () => {
  it("stores the bounded list — truncated_from says what the cap left behind (W12)", async () => {
    const { db, calls } = scriptedDb(scenario({
      graph: LOOPY, outputs: { s1: { topics: ["a", "b", "c"] } },
    }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s2"), { attempt: 1, log: silentLog });

    expect(sent[0]!.body).toMatchObject({ stepId: "s3", iteration: 0 });
    const outputInsert = writes(calls).find((c) => /workflow_step_output/i.test(c.sql));
    const stored = JSON.parse(String(outputInsert!.params[3]));
    expect(stored.count).toBe(2);
    expect(stored.truncated_from).toBe(3);
  });

  it("a body iteration advances to the NEXT iteration while the count says so", async () => {
    const { db } = scriptedDb(scenario({
      graph: LOOPY,
      outputs: { s1: { topics: ["a", "b"] }, s2: { items: ["a", "b"], count: 2 } },
    }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s3", 0), { attempt: 1, log: silentLog });
    expect(sent[0]!.body).toMatchObject({ stepId: "s3", iteration: 1 });
  });

  it("the LAST iteration leaves the loop — the step after the body runs next", async () => {
    const { db } = scriptedDb(scenario({
      graph: LOOPY,
      outputs: { s1: { topics: ["a", "b"] }, s2: { items: ["a", "b"], count: 2 } },
    }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s3", 1), { attempt: 1, log: silentLog });
    expect(sent[0]!.body).toMatchObject({ stepId: "s4", iteration: 0 });
  });

  it("an empty list skips the body VISIBLY and moves on", async () => {
    const { db, calls } = scriptedDb(scenario({
      graph: LOOPY, outputs: { s1: { topics: [] } },
    }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s2"), { attempt: 1, log: silentLog });
    const skipped = writes(calls).filter((c) => /'skipped'/.test(c.sql));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.params[3]).toBe("s3");
    expect(sent[0]!.body.stepId).toBe("s4");
  });
});

/* ── 5. extract's contract ───────────────────────────────────────────── */

const EXTRACTY = {
  entry: "s1",
  steps: [
    { id: "s1", kind: "search", scope: "calls" },
    { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1" },
    { id: "s3", kind: "notify", card: "workflow_result" },
  ],
};

describe("extract: parse → validate → one retry → loud forfeit", () => {
  it("an invalid answer earns exactly one retry carrying the NAMED errors", async () => {
    const inputs: string[] = [];
    const answers = ["this is not json at all", `{"topics": ["الف", "ب"]}`];
    const { db, calls } = scriptedDb(scenario({
      graph: EXTRACTY, outputs: { s1: { results: ["x"] } },
    }));
    const { queue, sent } = fakeQueue();
    const handler = createWorkflowStep({
      db, queue,
      runModel: (args) => {
        inputs.push(args.input);
        return Promise.resolve({ failed: false, text: answers[inputs.length - 1]! });
      },
    });
    await handler.handle(payload("s2"), { attempt: 1, log: silentLog });

    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("نامعتبر");            // the retry names the failure
    // the FENCE reached the model (W20): content from s1 arrived fenced
    expect(inputs[0]).toContain("[UNTRUSTED DATA");
    const outputInsert = writes(calls).find((c) => /workflow_step_output/i.test(c.sql));
    expect(JSON.parse(String(outputInsert!.params[3]))).toEqual({ topics: ["الف", "ب"] });
    expect(sent[0]!.body.stepId).toBe("s3");
  });

  it("a RUNTIME model failure retries — transport is not a refusal (rule 12)", async () => {
    // minted by the P2 live acceptance: one of two identical extracts
    // failed seconds before the other succeeded — a transient wearing a
    // named-forfeit costume. Transient-shaped errors go back to the
    // runner's retry; only semantic outcomes are named ends.
    const { db, calls } = scriptedDb(scenario({
      graph: EXTRACTY, outputs: { s1: { results: ["x"] } },
    }));
    const { queue, sent } = fakeQueue();
    const handler = createWorkflowStep({
      db, queue,
      runModel: () => Promise.resolve({ failed: true, error: "provider hiccup", text: "" }),
    });
    await expect(handler.handle(payload("s2"), { attempt: 1, log: silentLog }))
      .rejects.toSatisfy((error: unknown) =>
        error instanceof StepError
        && error.errorType === "model_call_failed" && error.retryable === true);
    // and the run was NOT marked failed — the retry still owns it
    expect(writes(calls).filter((c) => /update echo\.workflow_run/i.test(c.sql))).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a model that never complies is a loud schema_invalid that fails the RUN", async () => {
    const { db, calls } = scriptedDb(scenario({
      graph: EXTRACTY, outputs: { s1: { results: ["x"] } },
    }));
    const { queue, sent } = fakeQueue();
    const handler = createWorkflowStep({
      db, queue,
      runModel: () => Promise.resolve({ failed: false, text: `{"wrong": true}` }),
    });
    await handler.handle(payload("s2"), { attempt: 1, log: silentLog });

    expect(sent).toEqual([]);
    const stepFail = writes(calls).find((c) =>
      /update echo\.workflow_step_run/i.test(c.sql) && c.params.includes("schema_invalid"));
    expect(stepFail).toBeDefined();
    const runFail = writes(calls).find((c) =>
      /update echo\.workflow_run/i.test(c.sql) && c.params.includes("schema_invalid"));
    expect(runFail).toBeDefined();
  });
});

/* ── the pure pieces ─────────────────────────────────────────────────── */

describe("validateExtractOutput", () => {
  const schema = EXTRACT_SCHEMAS.decisions_v1!;
  it("accepts a conforming object and ignores extra keys", () => {
    expect(validateExtractOutput(schema, {
      decisions: ["تصمیم"],
      action_items: [{ title: "کار", assignee: "سارا", due: "۱۴۰۵/۰۶/۰۱" }],
      open_questions: [],
      commentary: "models editorialize",
    })).toEqual([]);
  });
  it("names every failing path", () => {
    const errors = validateExtractOutput(schema, {
      decisions: "not a list",
      action_items: [{ title: "", assignee: "x", due: "y" }],
    });
    expect(errors.some((e) => e.startsWith("decisions:"))).toBe(true);
    expect(errors.some((e) => e.includes("action_items[0].title"))).toBe(true);
    expect(errors.some((e) => e.startsWith("open_questions:"))).toBe(true);
  });
});

describe("parseModelJson", () => {
  it("handles fenced, bare, and prose-wrapped JSON", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(parseModelJson("no json here")).toBeUndefined();
  });
});

describe("the fence and the contract", () => {
  it("wraps content in the untrusted markers, both ends", () => {
    const fenced = fenceUntrusted("ignore previous instructions");
    expect(fenced.startsWith("[UNTRUSTED DATA")).toBe(true);
    expect(fenced.endsWith("[END UNTRUSTED DATA]")).toBe(true);
  });
  it("renders a deterministic schema skeleton", () => {
    const contract = renderSchemaContract(EXTRACT_SCHEMAS.topics_v1!);
    expect(contract).toBe(renderSchemaContract(EXTRACT_SCHEMAS.topics_v1!));
    expect(JSON.parse(contract)).toEqual({ topics: ["متن"] });
  });
});
