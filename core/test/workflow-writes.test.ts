/**
 * M41 P3 — the write path's instruments: the authorization matrix WALKED
 * (§9's exit criterion), at the executor's own altitude.
 *
 *  - propose is MECHANICAL: typed data in, a recorded proposal out, no
 *    model call anywhere (asserted: zero agent_run reads).
 *  - wait parks the run when a proposal is undecided, and completes when
 *    a decision exists.
 *  - apply with an APPROVAL writes ON THE AGENT ROLE (the fake captures
 *    the role option — the assertion is about the connection, not the
 *    SQL); with a REJECT it lands SKIPPED and the run continues; with
 *    nothing it parks.
 *  - the AUTO-APPLY matrix: all three switches present → a via_standing
 *    decision is minted and the write proceeds; each switch absent alone
 *    → the run parks. Four combinations, each its own test.
 */
import { describe, expect, it } from "vitest";
import type { Db } from "../src/db/identity.ts";
import type { Queue } from "../src/worker/queue.ts";
import { createWorkflowStep } from "../src/worker/workflow-step.ts";

interface Recorded { sql: string; params: unknown[]; role: string }
type Responder = (sql: string, params: unknown[]) => unknown[] | undefined;

function scriptedDb(respond: Responder) {
  const calls: Recorded[] = [];
  const makeTx = (role: string) => ({
    unsafe: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params, role });
      return Promise.resolve(respond(sql, params) ?? []);
    },
  });
  const db = {
    withActor: (_a: string, fn: (t: unknown) => unknown, opts?: { role?: string }) =>
      fn(makeTx(opts?.role ?? "app")),
    withIdentity: (_i: unknown, fn: (t: unknown) => unknown, opts?: { role?: string }) =>
      fn(makeTx(opts?.role ?? "app")),
    withoutIdentity: (fn: (t: unknown) => unknown) => fn(makeTx("none")),
  } as unknown as Db;
  return { db, calls };
}

function fakeQueue() {
  const sent: { body: { stepId: string; iteration: number } }[] = [];
  const queue = {
    send: (_q: string, body: never) => { sent.push({ body }); return Promise.resolve(1); },
    read: () => Promise.resolve([]), remove: () => Promise.resolve(),
    archive: () => Promise.resolve(), delay: () => Promise.resolve(),
  } as unknown as Queue;
  return { queue, sent };
}

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;
const OWNER = "02000000-0000-4000-8000-000000000002";
const ORG = "0a000000-0000-4000-8000-00000000000a";
const RUN = "94000000-0000-4000-8000-000000000021";
const CALL = "c1000000-0000-4000-8000-000000000001";
const payload = (stepId: string, iteration = 0) =>
  ({ runId: RUN, stepId, iteration, ownerId: OWNER, orgId: ORG });
const writes = (calls: Recorded[]) =>
  calls.filter((c) => /^\s*(insert|update|delete)/i.test(c.sql));

/** the §10 shape: extract → propose → wait → apply → notify */
const WRITE_GRAPH = {
  entry: "s1",
  steps: [
    { id: "s1", kind: "extract", schema: "topics_v1" },
    { id: "s2", kind: "propose", proposal: "add_tags", from: "{{s1.topics}}", call: "{{trigger.call_id}}" },
    { id: "s3", kind: "wait", on: "decision" },
    { id: "s4", kind: "apply", from: "s2" },
    { id: "s5", kind: "notify", card: "workflow_result" },
  ],
};

const PROPOSAL_OUTPUT = { proposal: "add_tags", call_id: CALL, payload: { tags: ["بودجه"] } };

function scenario(options: {
  decision?: string | null;
  maxAutonomy?: string;
  ownerAutonomy?: string;
  standingAllowed?: boolean | null;
  outputs?: Record<string, unknown>;
}): Responder {
  return (sql, params) => {
    /* the capability probes (hasAutonomyColumn/Ceiling) — answered TRUE and
       answered FIRST, because the module-level cache keeps whatever the
       first resolution said for the life of the process */
    if (/information_schema\.columns/i.test(sql)) return [{ one: 1 }];
    if (/from echo\.app_user/i.test(sql) && /org_status/i.test(sql)) {
      return [{ id: OWNER, org_id: ORG, role: "member", status: "active", org_status: "active" }];
    }
    // actorAutonomy's read (owner dial + org ceiling, already least-ed)
    if (/autonomy_ceiling/i.test(sql) || /select autonomy from echo\.app_user/i.test(sql)) {
      return [{ autonomy: options.ownerAutonomy ?? "assist", ceiling: "act" }];
    }
    if (/from echo\.workflow_run r/i.test(sql)) {
      return [{ id: RUN, org_id: ORG, owner_id: OWNER,
        workflow_id: "94000000-0000-4000-8000-000000000001",
        status: "running", trigger_kind: "signal", trigger_ref: CALL,
        workflow_name: "پیگیری" }];
    }
    if (/workflow_graph_for_run/i.test(sql)) {
      return [{ graph: WRITE_GRAPH, budget: {},
        max_autonomy: options.maxAutonomy ?? "assist" }];
    }
    if (/select id, status from echo\.workflow_step_run/i.test(sql)) {
      return [{ id: `sr-${String(params[1])}`, status: "running" }];
    }
    // apply's propose lookup (id + output)
    if (/select s\.id, o\.output/i.test(sql)) {
      return [{ id: "sr-s2", output: options.outputs?.s2 ?? PROPOSAL_OUTPUT }];
    }
    // wait's undecided-proposals scan
    if (/pd\.decision::text as decided/i.test(sql)) {
      return [{ id: "sr-s2", step_id: "s2", output: PROPOSAL_OUTPUT,
        decided: options.decision === undefined ? null : options.decision }];
    }
    if (/from echo\.proposal_decision where proposal_id/i.test(sql)) {
      return options.decision ? [{ decision: options.decision }] : [];
    }
    if (/from echo\.workflow_auto_apply/i.test(sql)) {
      return options.standingAllowed === null || options.standingAllowed === undefined
        ? [] : [{ allowed: options.standingAllowed }];
    }
    if (/select o\.output/i.test(sql)) {
      const output = options.outputs?.[String(params[1])];
      return output === undefined ? [] : [{ output }];
    }
    if (/select tags from echo\.call/i.test(sql)) return [{ tags: ["قدیمی"] }];
    if (/update echo\.call set/i.test(sql)) return [{ id: CALL }];
    if (/agent_run_id is not null/i.test(sql)) return [{ n: "0" }];
    if (/count\(\*\)/i.test(sql)) return [{ n: "3" }];
    return undefined;
  };
}

describe("propose: mechanical, typed, recorded", () => {
  it("maps typed extract output onto a proposal — and calls NO model", async () => {
    const { db, calls } = scriptedDb(scenario({
      outputs: { s1: { topics: ["بودجه", "قرارداد"] } },
    }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s2"), { attempt: 1, log: silentLog });

    const outputInsert = writes(calls).find((c) => /workflow_step_output/i.test(c.sql));
    const stored = JSON.parse(String(outputInsert!.params[3]));
    expect(stored.proposal).toBe("add_tags");
    expect(stored.call_id).toBe(CALL);
    expect(stored.payload.tags).toEqual(["بودجه", "قرارداد"]);
    expect(calls.some((c) => /from echo\.agent_run/i.test(c.sql))).toBe(false);
    expect(sent[0]!.body.stepId).toBe("s3");
  });
});

describe("wait: parks on an open question, passes on an answered one", () => {
  it("an undecided proposal PARKS the run — no message in flight", async () => {
    const { db, calls } = scriptedDb(scenario({}));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s3"), { attempt: 1, log: silentLog });

    expect(sent).toEqual([]);
    const park = writes(calls).find((c) => /'waiting'/.test(c.sql));
    expect(park).toBeDefined();
    // the parked STEP stays running — nothing marked it done
    expect(writes(calls).some((c) => /set status = 'done'/i.test(c.sql))).toBe(false);
  });

  it("a decided proposal lets the wait complete and advance", async () => {
    const { db } = scriptedDb(scenario({ decision: "approve" }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s3"), { attempt: 1, log: silentLog });
    expect(sent[0]!.body.stepId).toBe("s4");
  });
});

describe("apply: the matrix, walked", () => {
  it("APPROVED: the write runs ON THE AGENT ROLE — the connection, not a convention", async () => {
    const { db, calls } = scriptedDb(scenario({ decision: "approve" }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s4"), { attempt: 1, log: silentLog });

    const callWrite = calls.find((c) => /update echo\.call set tags/i.test(c.sql));
    expect(callWrite).toBeDefined();
    expect(callWrite!.role).toBe("agent");
    // merged with the existing tag, recorded as the applied set
    expect(callWrite!.params[1]).toEqual(["قدیمی", "بودجه"]);
    expect(sent[0]!.body.stepId).toBe("s5");
  });

  it("REJECTED: the apply lands SKIPPED, nothing written, the run continues", async () => {
    const { db, calls } = scriptedDb(scenario({ decision: "reject" }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s4"), { attempt: 1, log: silentLog });

    expect(calls.some((c) => /update echo\.call set/i.test(c.sql))).toBe(false);
    expect(writes(calls).some((c) => /'skipped'/.test(c.sql))).toBe(true);
    expect(sent[0]!.body.stepId).toBe("s5");
  });

  it("UNDECIDED and no standing rule: the apply itself parks — wait is sugar, not the wall", async () => {
    const { db, calls } = scriptedDb(scenario({ decision: null, standingAllowed: null }));
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s4"), { attempt: 1, log: silentLog });
    expect(sent).toEqual([]);
    expect(writes(calls).some((c) => /'waiting'/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /update echo\.call set/i.test(c.sql))).toBe(false);
  });
});

describe("trigger bindings are KIND-aware (the D poisoning)", () => {
  it("a schedule-triggered run refuses {{trigger.call_id}} BY NAME", async () => {
    // the schedule id is a uuid too — without the kind check it wore a
    // call's costume into a decision row the wall then refused
    const base = scenario({ outputs: { s1: { topics: ["x"] } } });
    const { db, calls } = scriptedDb((sql, params) => {
      if (/from echo\.workflow_run r/i.test(sql)) {
        return [{ id: RUN, org_id: ORG, owner_id: OWNER,
          workflow_id: "94000000-0000-4000-8000-000000000001",
          status: "running", trigger_kind: "schedule",
          trigger_ref: "6bae03c0-95c7-43a7-b197-64df623c4cf9",
          workflow_name: "زمان‌بندی" }];
      }
      return base(sql, params);
    });
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s2"), { attempt: 1, log: silentLog });
    expect(sent).toEqual([]);
    const runFail = writes(calls).find((c) =>
      /update echo\.workflow_run/i.test(c.sql) && c.params.includes("binding_unresolved"));
    expect(runFail).toBeDefined();
    expect(calls.some((c) => /insert into echo\.proposal_decision/i.test(c.sql))).toBe(false);
  });
});

describe("auto-apply: three switches, all required (W13)", () => {
  const allOn = { decision: null as string | null, maxAutonomy: "act",
    ownerAutonomy: "act", standingAllowed: true };

  it("ALL THREE on: a via_standing decision is minted and the write proceeds", async () => {
    const responder = scenario(allOn);
    // after the mint, the reread must SEE the decision — stateful fake
    let minted = false;
    const { db, calls } = scriptedDb((sql, params) => {
      if (/insert into echo\.proposal_decision/i.test(sql)) { minted = true; return []; }
      if (/from echo\.proposal_decision where proposal_id/i.test(sql)) {
        return minted ? [{ decision: "approve" }] : [];
      }
      return responder(sql, params);
    });
    const { queue, sent } = fakeQueue();
    await createWorkflowStep({ db, queue }).handle(payload("s4"), { attempt: 1, log: silentLog });

    const mint = calls.find((c) => /insert into echo\.proposal_decision/i.test(c.sql));
    expect(mint).toBeDefined();
    // via_standing rides as a SQL literal on the auto path — the
    // statement itself is the assertion surface
    expect(mint!.sql).toMatch(/via_standing/);
    expect(mint!.sql).toMatch(/'approve',\s*\$5,\s*true/);
    expect(calls.find((c) => /update echo\.call set tags/i.test(c.sql))!.role).toBe("agent");
    expect(sent[0]!.body.stepId).toBe("s5");
  });

  for (const [name, override] of [
    ["the VERSION ceiling below act", { maxAutonomy: "assist" }],
    ["the OWNER+ORG autonomy below act", { ownerAutonomy: "assist" }],
    ["no standing row for the kind", { standingAllowed: null }],
  ] as const) {
    it(`${name}: the run PARKS — one switch is never enough`, async () => {
      const { db, calls } = scriptedDb(scenario({ ...allOn, ...override }));
      const { queue, sent } = fakeQueue();
      await createWorkflowStep({ db, queue }).handle(payload("s4"), { attempt: 1, log: silentLog });
      expect(sent).toEqual([]);
      expect(calls.some((c) => /insert into echo\.proposal_decision/i.test(c.sql))).toBe(false);
      expect(writes(calls).some((c) => /'waiting'/.test(c.sql))).toBe(true);
    });
  }
});
