/**
 * The publish validator's corpus (M41 §4.3): one refusing fixture per rule,
 * plus the graphs that MUST validate — because "a validator is proven able
 * to refuse before it is trusted to accept" cuts both ways: a validator
 * that refuses everything is indistinguishable from one that works, until
 * the positive controls exist.
 *
 * Rule 10 pin: `MIGRATED_TEMPLATE_GRAPH` is byte-for-byte the shape
 * db/0105 writes when converting workflow_template rows. If either side
 * changes, this file is where the disagreement surfaces.
 */
import { describe, expect, it } from "vitest";
import {
  parseBindingPath,
  validateWorkflowBudget,
  validateWorkflowGraph,
  type ValidateOptions,
} from "../src/api/workflow-graph.ts";
import { ValidationError } from "../src/api/errors.ts";

const OPTS: ValidateOptions = { maxAutonomy: "assist" };

/** assert refusal AND that the refusal NAMES the rule — a check that
    cannot distinguish which rule fired cannot fail for the right reason */
function refusedWith(graph: unknown, fragment: string, options: ValidateOptions = OPTS) {
  try {
    validateWorkflowGraph(graph, options);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain(fragment);
    return;
  }
  throw new Error(`expected refusal containing "${fragment}" — the graph was accepted`);
}

/* ── the graphs that must PASS ───────────────────────────────────────── */

/** §10's worked path — the canonical full graph */
const FULL_GRAPH = {
  entry: "s1",
  steps: [
    { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
    { id: "s2", kind: "extract", agent: "analyst", from: "{{s1}}", schema: "decisions_v1" },
    { id: "s3", kind: "decide", on: "s2.action_items.length", gt: 0, then: "s4", else: "s7" },
    { id: "s4", kind: "foreach", over: "{{s2.action_items}}", max: 20, do: "s5" },
    { id: "s5", kind: "propose", proposal: "add_tags", from: "{{s4.item}}", call: "{{trigger.call_id}}" },
    { id: "s6", kind: "apply", from: "s5" },
    { id: "s7", kind: "notify", card: "workflow_result" },
  ],
};

/** EXACTLY what db/0105 writes — the migrated template's shape (W15) */
const MIGRATED_TEMPLATE_GRAPH = {
  entry: "s1",
  steps: [
    { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
    { id: "s2", kind: "ask", from: "{{s1}}", instruction: "خلاصهٔ این جلسه را بنویس." },
  ],
};

describe("the graphs that must validate", () => {
  it("accepts the canonical full path", () => {
    const graph = validateWorkflowGraph(FULL_GRAPH, OPTS);
    expect(graph.steps).toHaveLength(7);
  });

  it("accepts the migrated-template shape 0105 writes (rule 10 pin)", () => {
    // watch, because the migration declares the tightest true ceiling
    expect(() => validateWorkflowGraph(MIGRATED_TEMPLATE_GRAPH, { maxAutonomy: "watch" }))
      .not.toThrow();
  });

  it("accepts a one-step search graph", () => {
    expect(() => validateWorkflowGraph(
      { entry: "s1", steps: [{ id: "s1", kind: "search", scope: "calls" }] }, OPTS,
    )).not.toThrow();
  });
});

/* ── one refusing fixture per rule ───────────────────────────────────── */

describe("the corpus — every rule can fire, naming itself", () => {
  it("refuses a non-object graph", () => refusedWith([], "must be an object"));
  it("refuses unknown top-level keys", () =>
    refusedWith({ entry: "s1", steps: [{ id: "s1", kind: "search", scope: "calls" }], extra: 1 },
      "unknown key 'extra'"));
  it("refuses an empty step list", () => refusedWith({ entry: "s1", steps: [] }, "non-empty"));
  it("refuses a duplicate id", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "search", scope: "calls" },
      { id: "s1", kind: "notify", card: "workflow_result" },
    ] }, "duplicate step id"));
  it("refuses an unknown kind", () =>
    refusedWith({ entry: "s1", steps: [{ id: "s1", kind: "summon" }] }, "unknown step kind"));
  it("refuses an unknown key on a step", () =>
    refusedWith({ entry: "s1", steps: [{ id: "s1", kind: "search", scope: "calls", user_id: "x" }] },
      "unknown key 'user_id'"));
  it("refuses an entry that is not the first step", () =>
    refusedWith({ entry: "s2", steps: [
      { id: "s1", kind: "search", scope: "calls" },
      { id: "s2", kind: "notify", card: "workflow_result" },
    ] }, "entry must be the first step"));

  it("refuses a binding that resolves against nothing (W4)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "search", scope: "calls" },
      { id: "s2", kind: "extract", from: "{{s9}}", schema: "topics_v1" },
    ] }, "does not resolve"));

  it("refuses a FORWARD read — a step cannot bind a later step", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "ask", instruction: "x {{s2}}" },
      { id: "s2", kind: "search", scope: "calls" },
    ] }, "no earlier step declares"));

  it("refuses a malformed binding path (W25's closed grammar)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "ask", instruction: "x {{s0.a..b}}" },
    ] }, "malformed binding"));

  it("refuses arithmetic-shaped paths — the grammar has no operators", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "ask", instruction: "x {{1 + 1}}" },
    ] }, "malformed binding"));

  it("refuses a decide over raw content — only typed values steer (W6)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "search", scope: "calls" },
      { id: "s2", kind: "decide", on: "s1", then: "s3", else: "__end" },
      { id: "s3", kind: "notify", card: "workflow_result" },
    ] }, "never raw content"));

  it("refuses a numeric operator over a non-number", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "decide", on: "s1.topics", gt: 0, then: "s3", else: "__end" },
      { id: "s3", kind: "notify", card: "workflow_result" },
    ] }, "needs a number"));

  it("refuses a BACKWARD jump — acyclic by construction", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "decide", on: "s1.topics.length", gt: 0, then: "s3", else: "s1" },
      { id: "s3", kind: "notify", card: "workflow_result" },
    ] }, "forward only"));

  it("refuses foreach over a non-list", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "search", scope: "calls" },
      { id: "s2", kind: "foreach", over: "{{s1}}", max: 5, do: "s3" },
      { id: "s3", kind: "notify", card: "workflow_result" },
    ] }, "LIST field"));

  it("refuses a foreach fan-out past the cap", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "foreach", over: "{{s1.topics}}", max: 51, do: "s3" },
      { id: "s3", kind: "notify", card: "workflow_result" },
    ] }, "1..50"));

  it("refuses a foreach whose body is not the next step", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "foreach", over: "{{s1.topics}}", max: 5, do: "s4" },
      { id: "s3", kind: "notify", card: "workflow_result" },
      { id: "s4", kind: "notify", card: "workflow_result" },
    ] }, "immediately following"));

  it("refuses an apply with no propose behind it (§4.3 check 6)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "search", scope: "calls" },
      { id: "s2", kind: "apply", from: "s1" },
    ] }, "must name an earlier propose"));

  it("refuses a branch that jumps between a propose and its apply", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "decide", on: "s1.topics.length", gt: 0, then: "s4", else: "__end" },
      { id: "s3", kind: "propose", proposal: "add_tags", from: "{{s1.topics}}", call: "{{trigger.call_id}}" },
      { id: "s4", kind: "apply", from: "s3" },
    ] }, "between a propose and its apply"));

  it("refuses apply under a watch ceiling — self-contradictory (§4.3 check 10)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "propose", proposal: "add_tags", from: "{{s1.topics}}", call: "{{trigger.call_id}}" },
      { id: "s3", kind: "apply", from: "s2" },
    ] }, "self-contradictory", { maxAutonomy: "watch" }));

  it("refuses an UNKNOWN proposal kind — the set is closed (P3)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "propose", proposal: "grant_admin", from: "{{s1.topics}}", call: "{{trigger.call_id}}" },
    ] }, "known proposal kind"));

  it("refuses a propose fed raw CONTENT — payloads are typed data only (P3)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "search", scope: "calls" },
      { id: "s2", kind: "propose", proposal: "add_tags", from: "{{s1}}", call: "{{trigger.call_id}}" },
    ] }, "never raw content"));

  it("refuses a propose without its call — the decision must be readable by its decider", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "propose", proposal: "add_tags", from: "{{s1.topics}}" },
    ] }, "call must be a binding"));

  it("refuses an unknown extract schema", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "invented_v9" },
    ] }, "declared schema"));

  it("refuses a binding to a foreach BODY from outside the loop (P2)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "foreach", over: "{{s1.topics}}", max: 5, do: "s3" },
      { id: "s3", kind: "ask", instruction: "x {{s2.item}}" },
      /* s4 binding the BODY would silently read iteration 0 and present
         it as the whole — the loop's data flows through the foreach only */
      { id: "s4", kind: "ask", instruction: "y {{s3}}" },
    ] }, "no earlier step declares"));

  it("refuses a foreach body that is itself control flow (P2)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "extract", schema: "topics_v1" },
      { id: "s2", kind: "foreach", over: "{{s1.topics}}", max: 5, do: "s3" },
      { id: "s3", kind: "foreach", over: "{{s1.topics}}", max: 5, do: "s4" },
      { id: "s4", kind: "notify", card: "workflow_result" },
    ] }, "linear step"));

  it("refuses an unresolvable agent when the caller knows the roster (W22)", () =>
    refusedWith({ entry: "s1", steps: [
      { id: "s1", kind: "ask", instruction: "x", agent: "nobody" },
    ] }, "does not resolve (org", { maxAutonomy: "assist", knownAgents: ["analyst"] }));
});

describe("the binding grammar (W25)", () => {
  it("parses trigger and step paths with indexes", () => {
    expect(parseBindingPath("trigger.call_id")).toEqual({ source: "trigger", parts: ["call_id"] });
    expect(parseBindingPath("s2.action_items[0].title"))
      .toEqual({ source: "s2", parts: ["action_items", 0, "title"] });
  });
  it("refuses depth past 8 and junk", () => {
    expect(parseBindingPath("a.b.c.d.e.f.g.h.i.j")).toBeNull();
    expect(parseBindingPath("s1; drop table")).toBeNull();
    expect(parseBindingPath("s1[abc]")).toBeNull();
  });
});

describe("budgets", () => {
  it("accepts declared caps and refuses past the platform's", () => {
    expect(validateWorkflowBudget({ max_model_calls: 10 })).toEqual({ max_model_calls: 10 });
    expect(() => validateWorkflowBudget({ max_model_calls: 31 })).toThrow(/1\.\.30/);
    expect(() => validateWorkflowBudget({ tokens: 5 })).toThrow(/unknown budget key/);
  });
});

/**
 * The anti-theatre guard, this vocabulary's turn: every declared step kind
 * is either handled by the validator's switch (it is — the switch is
 * exhaustive over the union) AND will need an executor arm in P1. Until
 * the executor exists, pin the COUNT-free property: validating a graph
 * containing each kind exercises each arm.
 */
describe("every step kind has a validator arm", () => {
  it("a graph touching all ten kinds validates end to end", () => {
    const graph = {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript" },
        { id: "s2", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        { id: "s3", kind: "ask", instruction: "بخوان {{s2}}" },
        { id: "s4", kind: "extract", from: "{{s1}}", schema: "decisions_v1" },
        { id: "s5", kind: "decide", on: "s4.action_items.length", gt: 0, then: "s6", else: "s10" },
        { id: "s6", kind: "foreach", over: "{{s4.action_items}}", max: 10, do: "s7" },
        { id: "s7", kind: "propose", proposal: "add_tags", from: "{{s6.item}}", call: "{{trigger.call_id}}" },
        { id: "s8", kind: "wait", on: "decision" },
        { id: "s9", kind: "apply", from: "s7" },
        { id: "s10", kind: "notify", card: "workflow_result" },
      ],
    };
    expect(() => validateWorkflowGraph(graph, OPTS)).not.toThrow();
  });
});
