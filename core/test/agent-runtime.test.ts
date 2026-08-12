/**
 * The scope wall gets its own tests (M9). These assert the security claims
 * of M4/invariants 2,3,5 — not that the code runs.
 */
import { describe, expect, it } from "vitest";

import { createPolicy } from "../src/agent/policy.ts";
import { modelForRun, resolveSkill, resolveSkills } from "../src/agent/skills.ts";
import { ToolDenied, wrapTools, type DomainTool } from "../src/agent/tools.ts";
import type { AgentStep, Identity, Skill } from "../src/agent/types.ts";

const ACTIVE: Identity = { userId: "u1", orgId: "org-a", role: "member", isActive: true };
const ADMIN: Identity = { ...ACTIVE, userId: "u-admin", role: "admin" };
const PENDING: Identity = { ...ACTIVE, userId: "u-pending", isActive: false };

// --- fake domain: two orgs' calls; org-b must never be reachable -------------

const CALLS = [
  { id: "c1", orgId: "org-a", text: "بودجه بازاریابی بیست درصد افزایش یافت" },
  { id: "c2", orgId: "org-b", text: "SECRET OTHER ORG CONTENT" },
];

const readCall: DomainTool<unknown, { call_id: string }> = {
  name: "read_call",
  label: "Read call",
  description: "Read one call's transcript.",
  parameters: {},
  async run(ctx, args) {
    const row = CALLS.find((c) => c.id === args.call_id);
    // identical refusal for missing and not-yours — not probeable
    if (!row || row.orgId !== ctx.identity.orgId) throw new ToolDenied("call not found");
    return row.text;
  },
};

const exploding: DomainTool<unknown, Record<string, never>> = {
  name: "boom",
  label: "Boom",
  description: "throws",
  parameters: {},
  async run() { throw new Error("postgres connection string leaked in message"); },
};

function collect() {
  const steps: Omit<AgentStep, "seq">[] = [];
  return { steps, onStep: (s: Omit<AgentStep, "seq">) => { steps.push(s); } };
}

interface ToolResult { content: [{ text: string }, ...{ text: string }[]]; isError?: boolean }

const call = (
  tool: { execute: (id: string, args: unknown) => Promise<unknown> },
  args: unknown,
): Promise<ToolResult> => tool.execute("tc-1", args) as Promise<ToolResult>;

// --- layer 1: the identity-carrying wrapper ---------------------------------

describe("tool wrapper (wall layer 1)", () => {
  it("scopes reads to the caller's org and records the attempt", async () => {
    const { steps, onStep } = collect();
    const tool = (wrapTools([readCall as never], { identity: ACTIVE, deps: {}, onStep }) as never[])[0]!;

    const ok = await call(tool, { call_id: "c1" });
    expect(ok.content[0].text).toContain("بودجه");

    const denied = await call(tool, { call_id: "c2" });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toBe("call not found");

    expect(steps.map((s) => s.outcome)).toEqual(["ok", "denied"]);
    expect(steps[1]?.tool).toBe("read_call");
  });

  it("returns the identical refusal for missing and foreign rows", async () => {
    const { onStep } = collect();
    const tool = (wrapTools([readCall as never], { identity: ACTIVE, deps: {}, onStep }) as never[])[0]!;
    const foreign = await call(tool, { call_id: "c2" });
    const missing = await call(tool, { call_id: "does-not-exist" });
    expect(foreign.content[0].text).toBe(missing.content[0].text);
    expect(foreign.isError).toBe(missing.isError);
  });

  it("gives an inactive actor NO tools at all (M15)", () => {
    const { onStep } = collect();
    const tools = wrapTools([readCall as never], { identity: PENDING, deps: {}, onStep });
    expect(tools).toEqual([]);
  });

  it("never leaks an unexpected error's message to the model", async () => {
    const { steps, onStep } = collect();
    const tool = (wrapTools([exploding as never], { identity: ACTIVE, deps: {}, onStep }) as never[])[0]!;
    const result = await call(tool, {});
    expect(result.content[0].text).toBe("tool failed");
    expect(JSON.stringify(result)).not.toContain("postgres");
    // the audit records the error TYPE, not the message
    expect(steps[0]?.detail).toBe("Error");
    expect(steps[0]?.outcome).toBe("error");
  });

  it("passes identity to the tool, not credentials", async () => {
    const seen: unknown[] = [];
    const probe: DomainTool<{ secret: string }, Record<string, never>> = {
      name: "probe", label: "p", description: "", parameters: {},
      async run(ctx) { seen.push(ctx.identity); return "ok"; },
    };
    const { onStep } = collect();
    const tool = (wrapTools([probe as never], {
      identity: ACTIVE, deps: { secret: "not-a-credential-path" }, onStep,
    }) as never[])[0]!;
    await call(tool, {});
    expect(seen[0]).toEqual(ACTIVE);
  });
});

// --- layer 2: the central veto ----------------------------------------------

describe("policy (wall layer 2 — beforeToolCall)", () => {
  it("blocks tools the skill did not declare", async () => {
    const { steps, onStep } = collect();
    const policy = createPolicy({ identity: ACTIVE, allowedTools: ["read_call"], onStep });

    expect(await policy({ toolCall: { name: "read_call" }, args: {} })).toBeUndefined();
    const blocked = await policy({ toolCall: { name: "delete_everything" }, args: {} });
    expect(blocked?.block).toBe(true);
    expect(steps.at(-1)?.outcome).toBe("blocked");
  });

  it("hides admin-only tools from members with a non-probeable reason", async () => {
    const { onStep } = collect();
    const member = createPolicy({ identity: ACTIVE, adminOnlyTools: new Set(["delete_everything"]), onStep });
    const admin = createPolicy({ identity: ADMIN, adminOnlyTools: new Set(["delete_everything"]), onStep });

    const denied = await member({ toolCall: { name: "delete_everything" }, args: {} });
    expect(denied?.block).toBe(true);
    expect(denied?.reason).toBe('tool "delete_everything" is not available');
    expect(await admin({ toolCall: { name: "delete_everything" }, args: {} })).toBeUndefined();
  });

  it("enforces a tool-call budget so a loop cannot grind forever", async () => {
    const { onStep } = collect();
    const policy = createPolicy({ identity: ACTIVE, maxToolCalls: 2, onStep });
    expect(await policy({ toolCall: { name: "read_call" }, args: {} })).toBeUndefined();
    expect(await policy({ toolCall: { name: "read_call" }, args: {} })).toBeUndefined();
    const third = await policy({ toolCall: { name: "read_call" }, args: {} });
    expect(third?.block).toBe(true);
    expect(third?.reason).toContain("budget");
  });

  it("blocks everything for an inactive actor", async () => {
    const { onStep } = collect();
    const policy = createPolicy({ identity: PENDING, onStep });
    const result = await policy({ toolCall: { name: "read_call" }, args: {} });
    expect(result?.block).toBe(true);
  });
});

// --- skills as data ----------------------------------------------------------

const skill = (over: Partial<Skill>): Skill => ({
  id: "s", level: "system", slug: "summarize", name: "n", description: "",
  prompt: "p", model: null, tools: [], enabled: true, ...over,
});

describe("skills-as-data resolution (system < org < user)", () => {
  it("most specific level wins", () => {
    const resolved = resolveSkills([
      skill({ id: "sys", level: "system", prompt: "system" }),
      skill({ id: "org", level: "org", prompt: "org" }),
      skill({ id: "usr", level: "user", prompt: "user" }),
    ]);
    expect(resolved.get("summarize")?.id).toBe("usr");
  });

  it("org beats system when no user override exists", () => {
    const resolved = resolveSkills([
      skill({ id: "sys", level: "system" }),
      skill({ id: "org", level: "org" }),
    ]);
    expect(resolved.get("summarize")?.id).toBe("org");
  });

  it("a disabled override falls back to the level beneath it", () => {
    const resolved = resolveSkills([
      skill({ id: "sys", level: "system" }),
      skill({ id: "org", level: "org", enabled: false }),
    ]);
    expect(resolved.get("summarize")?.id).toBe("sys");
  });

  it("resolves through an injected source", async () => {
    const source = { listVisible: async () => [skill({ id: "org", level: "org" })] };
    const found = await resolveSkill(source, ACTIVE, "summarize");
    expect(found?.id).toBe("org");
    expect(await resolveSkill(source, ACTIVE, "nope")).toBeUndefined();
  });

  it("model: skill pin wins, else caller's choice, else refuse (M5)", () => {
    expect(modelForRun(skill({ model: "pinned" }), "chosen")).toBe("pinned");
    expect(modelForRun(skill({ model: null }), "chosen")).toBe("chosen");
    expect(() => modelForRun(skill({ model: null }), undefined)).toThrow(/no model selected/);
  });
});
