/**
 * Steward review rulings (2026-08-12):
 *  1. pre-filter the offered tool list AND keep the veto
 *  2. per-skill tool-call budget, default 24
 *  3. bound blocked attempts too — a denial-grind must terminate
 *
 * (3) was a real bug: the budget counted only ALLOWED calls, so a model
 * spamming a forbidden tool never exhausted anything.
 */
import { describe, expect, it } from "vitest";

import {
  createPolicy,
  DEFAULT_MAX_BLOCKED_ATTEMPTS,
  DEFAULT_MAX_TOOL_CALLS,
  filterDeclaredTools,
} from "../src/agent/policy.ts";
import type { AgentStep, Identity } from "../src/agent/types.ts";

const ACTIVE: Identity = { userId: "u1", orgId: "org-a", role: "member", isActive: true };

function collect() {
  const steps: Omit<AgentStep, "seq">[] = [];
  return { steps, onStep: (s: Omit<AgentStep, "seq">) => { steps.push(s); } };
}

describe("denial-grind terminates (steward finding)", () => {
  it("counts BLOCKED attempts against the total budget", async () => {
    const { onStep } = collect();
    // only 3 attempts allowed in total; every one of these is refused
    const policy = createPolicy({
      identity: ACTIVE, allowedTools: ["read_call"], maxToolCalls: 3,
      maxBlockedAttempts: 99, onStep,
    });

    for (let i = 0; i < 3; i++) {
      const d = await policy({ toolCall: { name: "forbidden" }, args: {} });
      expect(d?.block).toBe(true);
      expect(d?.reason).toContain("not in this skill's tool list");
    }
    // 4th attempt exceeds the TOTAL budget even though none ever executed
    const exhausted = await policy({ toolCall: { name: "forbidden" }, args: {} });
    expect(exhausted?.reason).toContain("budget exhausted");
    expect(exhausted?.terminate).toBe(true);
  });

  it("ends a denial-grind at the blocked-attempt cap, with terminate", async () => {
    const { steps, onStep } = collect();
    const policy = createPolicy({
      identity: ACTIVE, allowedTools: ["read_call"],
      maxToolCalls: 1000, maxBlockedAttempts: 4, onStep,
    });

    const decisions = [];
    for (let i = 0; i < 6; i++) {
      decisions.push(await policy({ toolCall: { name: "forbidden" }, args: {} }));
    }

    // the cap is reached and every later refusal asks Pi to stop
    expect(decisions[3]?.terminate).toBe(true);
    expect(decisions[4]?.reason).toContain("too many refused tool calls");
    expect(decisions[5]?.terminate).toBe(true);
    // and every attempt is on the record
    expect(steps).toHaveLength(6);
    expect(steps.every((s) => s.outcome === "blocked")).toBe(true);
  });

  it("allowed calls still consume the budget (unchanged behaviour)", async () => {
    const { onStep } = collect();
    const policy = createPolicy({ identity: ACTIVE, maxToolCalls: 2, onStep });
    expect(await policy({ toolCall: { name: "read_call" }, args: {} })).toBeUndefined();
    expect(await policy({ toolCall: { name: "read_call" }, args: {} })).toBeUndefined();
    const third = await policy({ toolCall: { name: "read_call" }, args: {} });
    expect(third?.block).toBe(true);
    expect(third?.terminate).toBe(true);
  });

  it("a mixed run exhausts on total attempts, allowed + blocked together", async () => {
    const { onStep } = collect();
    const policy = createPolicy({
      identity: ACTIVE, allowedTools: ["ok"], maxToolCalls: 4,
      maxBlockedAttempts: 99, onStep,
    });
    expect(await policy({ toolCall: { name: "ok" }, args: {} })).toBeUndefined();
    expect((await policy({ toolCall: { name: "nope" }, args: {} }))?.block).toBe(true);
    expect(await policy({ toolCall: { name: "ok" }, args: {} })).toBeUndefined();
    expect((await policy({ toolCall: { name: "nope" }, args: {} }))?.block).toBe(true);
    // 5th attempt — 2 allowed + 2 blocked already spent the budget of 4
    const fifth = await policy({ toolCall: { name: "ok" }, args: {} });
    expect(fifth?.reason).toContain("budget exhausted");
  });

  it("ships sane defaults", () => {
    expect(DEFAULT_MAX_TOOL_CALLS).toBe(24);
    expect(DEFAULT_MAX_BLOCKED_ATTEMPTS).toBe(8);
  });
});

describe("tool pre-filter (token economy, never enforcement)", () => {
  const tools = [{ name: "read_call" }, { name: "search_calls" }, { name: "delete_all" }];

  it("offers only what the skill declared", () => {
    expect(filterDeclaredTools(tools, ["read_call"]).map((t) => t.name)).toEqual(["read_call"]);
  });

  it("distinguishes no declared tools from no declared ceiling", async () => {
    // [] is an explicit safety ceiling: it must not silently inherit the
    // assistant's complete toolset. Undefined is the ad-hoc assistant case.
    expect(filterDeclaredTools(tools, [])).toHaveLength(0);
    expect(filterDeclaredTools(tools, undefined)).toHaveLength(3);

    const { onStep } = collect();
    const noTools = createPolicy({ identity: ACTIVE, allowedTools: [], onStep });
    const blocked = await noTools({ toolCall: { name: "read_call" }, args: {} });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("not in this skill's tool list");
  });

  it("the veto still blocks an undeclared tool even if the filter was bypassed", async () => {
    // this is the point: enforcement must not depend on the filter running
    const { onStep } = collect();
    const policy = createPolicy({ identity: ACTIVE, allowedTools: ["read_call"], onStep });
    const decision = await policy({ toolCall: { name: "delete_all" }, args: {} });
    expect(decision?.block).toBe(true);
  });
});
