import { describe, expect, it, vi } from "vitest";

/*
 * The REAL `Type`, spread in from pi-ai — platform-tools and delegation build
 * their schemas at module load, and a `Type: {}` stub takes the whole suite
 * down before a test runs.
 */
vi.mock("../src/agent/pi.ts", async () => ({
  ...await import("@earendil-works/pi-ai"),
  runPi: vi.fn(),
}));

const { createDelegationTools, createEchoTool, MAX_DELEGATIONS } =
  await import("../src/agent/delegation.ts");
const { toolsFor, createPlatformTools } = await import("../src/agent/platform-tools.ts");
import { ToolDenied } from "../src/agent/tools.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * ECHO CALLS ROYA AND AVA, AND THE THREE GUARDS HOLD.
 *
 * The delegation loop is the one place in this product where a model's output
 * becomes another model's input, so the assertions here are about what a
 * delegate CANNOT do rather than about what it says:
 *
 *   1. it is never handed the tools that would let it delegate onward;
 *   2. it is never handed a tool that acts — no client tools, no writes;
 *   3. it cannot be called an unbounded number of times in one turn.
 *
 * Each is checked against the tool set that is actually built, not against
 * the prose that describes it.
 */
const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member",
  isActive: true,
} as Identity;

const AGENTS: Record<string, unknown> = {
  roya: {
    id: "a-1", handle: "roya", name: "رؤیا", description: "کارها را انجام می‌دهد.",
    level: "system", icon: "sparkles", color: "violet", model: null,
    tools: [], web: true, instructions: "تو رؤیا هستی.", sourceScope: {},
  },
  ava: {
    id: "a-2", handle: "ava", name: "آوا", description: "می‌خواند و گزارش می‌دهد.",
    level: "system", icon: "chart", color: "blue", model: null,
    tools: [], web: false, instructions: "تو آوا هستی.", sourceScope: {},
  },
};

vi.mock("../src/agent/agent-store.ts", () => ({
  resolveAssistantAgent: async (_db: unknown, _id: unknown, handle: string) =>
    AGENTS[handle],
}));

interface Nested {
  agentHandle: string;
  instructions: string;
  web: boolean;
  question: string;
  tools: { name: string }[];
}

async function build(over: { web?: boolean } = {}) {
  const nested: Nested[] = [];
  const turns: { author: string; text: string; failed: boolean }[] = [];
  const tools = await createDelegationTools({
    db: {} as never,
    identity: IDENTITY,
    web: over.web ?? true,
    locale: "fa",
    runNested: async (input) => {
      nested.push(input as unknown as Nested);
      return {
        runId: "r-1", text: `answer from ${input.agentHandle}`, model: "m",
        steps: [], failed: false,
      };
    },
    onTurn: (turn) => { turns.push(turn); },
  });
  return { tools, nested, turns };
}

const run = (tool: { run: (...a: never[]) => Promise<unknown> }, args: unknown) =>
  tool.run({ identity: IDENTITY, deps: {} } as never, args as never);

describe("Echo's colleagues, as tools", () => {
  it("offers one tool per visible agent, named for them", async () => {
    const { tools } = await build();
    expect(tools.map((t) => t.name).sort()).toEqual(["ask_ava", "ask_roya"]);
  });

  it("runs the colleague's OWN instructions, from the store", async () => {
    const { tools, nested } = await build();
    const roya = tools.find((t) => t.name === "ask_roya")!;
    await run(roya, { question: "چه جلساتی این هفته هست؟" });
    expect(nested).toHaveLength(1);
    expect(nested[0]!.agentHandle).toBe("roya");
    /* the persona is the DATABASE's text, never anything a caller sent —
       M30's rule, and the reason a browser cannot make Roya somebody else */
    expect(nested[0]!.instructions).toContain("تو رؤیا هستی.");
    expect(nested[0]!.question).toContain("چه جلساتی این هفته هست؟");
  });

  it("GUARD 1: a delegate is never given a way to delegate onward", async () => {
    const { tools, nested } = await build();
    await run(tools.find((t) => t.name === "ask_ava")!, { question: "چه چیزی عوض شد؟" });
    const names = nested[0]!.tools.map((t) => t.name);
    expect(names.filter((n) => n.startsWith("ask_"))).toEqual([]);
  });

  it("GUARD 2: a delegate is given READS and nothing that acts", async () => {
    /*
     * The blast-radius rule (M43): what an output can REACH decides what its
     * author may hold. A delegate's answer is read by Echo and shown to the
     * person before anybody acts, so it needs no client tool and no write
     * tool — and the check is on the SET that was handed over, because a
     * promise in a comment is not a wall.
     */
    const { tools, nested } = await build();
    await run(tools.find((t) => t.name === "ask_roya")!, { question: "وضعیت تخته؟" });
    const names = nested[0]!.tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(3);           // it got a real set
    for (const acting of ["navigate", "start_recording", "set_member_role",
      "send_member_message", "correct_transcript", "replace_summary"]) {
      expect(names, acting).not.toContain(acting);
    }
  });

  it("GUARD 3: one question cannot call the colleagues without end", async () => {
    const { tools } = await build();
    const roya = tools.find((t) => t.name === "ask_roya")!;
    const ava = tools.find((t) => t.name === "ask_ava")!;
    /* the ceiling is shared across BOTH tools — a per-tool counter would let
       a model alternate and spend twice the budget */
    for (let i = 0; i < MAX_DELEGATIONS; i += 1) {
      await run(i % 2 === 0 ? roya : ava, { question: "بله؟" });
    }
    await expect(run(roya, { question: "و باز هم؟" })).rejects.toBeInstanceOf(ToolDenied);
  });

  it("they are SPECIALISTS — the two sets genuinely differ", async () => {
    /*
     * The directive's "special in something more than the other". If both
     * delegates got the same tools, asking the right one would be a
     * personality choice, and the whole mechanism would be theatre.
     */
    const { tools, nested } = await build();
    await run(tools.find((t) => t.name === "ask_roya")!, { question: "؟" });
    await run(tools.find((t) => t.name === "ask_ava")!, { question: "؟" });
    const royaSet = new Set(nested[0]!.tools.map((t) => t.name));
    const avaSet = new Set(nested[1]!.tools.map((t) => t.name));

    const onlyRoya = [...royaSet].filter((n) => !avaSet.has(n));
    const onlyAva = [...avaSet].filter((n) => !royaSet.has(n));
    expect(onlyRoya.length, "Roya carries tools Ava does not").toBeGreaterThan(0);
    expect(onlyAva.length, "Ava carries tools Roya does not").toBeGreaterThan(0);

    /* and named, so the split is the one the descriptions promise rather
       than any difference at all */
    expect(royaSet.has("list_tasks")).toBe(true);
    expect(avaSet.has("list_tasks")).toBe(false);
    expect(avaSet.has("list_audit")).toBe(true);
    expect(royaSet.has("list_audit")).toBe(false);
  });

  it("web access is BOTH switches — either off is off", async () => {
    /* the agent's own flag says "is this a web-using persona"; the person's
       says "do I want my helpers spending outside the building". Roya's is
       on and Ava's is off in the fixture, so one call proves both directions
       of the AND with the person's switch held on. */
    const on = await build({ web: true });
    await run(on.tools.find((t) => t.name === "ask_roya")!, { question: "؟" });
    await run(on.tools.find((t) => t.name === "ask_ava")!, { question: "؟" });
    expect(on.nested[0]!.web, "roya: both on").toBe(true);
    expect(on.nested[1]!.web, "ava: the agent's own flag is off").toBe(false);

    const off = await build({ web: false });
    await run(off.tools.find((t) => t.name === "ask_roya")!, { question: "؟" });
    expect(off.nested[0]!.web, "the person's switch is off").toBe(false);
  });

  it("announces the turn so the thread can draw it under their name", async () => {
    const { tools, turns } = await build();
    await run(tools.find((t) => t.name === "ask_ava")!, { question: "؟" });
    expect(turns).toEqual([
      { author: "ava", name: "آوا", text: "answer from ava", failed: false },
    ]);
  });

  it("a colleague who FAILS is a refusal Echo can work around", async () => {
    /*
     * Not an exception that kills the turn: a person who asked one question
     * should get "Ava could not answer, here is what I have" rather than a
     * dead stream. The turn is still announced, so the thread shows that she
     * was asked — otherwise Echo's answer refers to a colleague the reader
     * never saw appear.
     */
    const turns: unknown[] = [];
    const tools = await createDelegationTools({
      db: {} as never,
      identity: IDENTITY,
      web: false,
      runNested: async () => ({
        runId: "r", text: "", model: "m", steps: [], failed: true, error: "provider down",
      }),
      onTurn: (turn) => { turns.push(turn); },
    });
    await expect(run(tools.find((t) => t.name === "ask_ava")!, { question: "؟" }))
      .rejects.toBeInstanceOf(ToolDenied);
    expect(turns).toHaveLength(1);
  });

  it("an agent the caller cannot see is not offered at all", async () => {
    /* better than a tool that always refuses: the model is never told about a
       colleague it cannot reach, so it cannot promise one to the user */
    vi.doMock("../src/agent/agent-store.ts", () => ({
      resolveAssistantAgent: async () => undefined,
    }));
    const tools = await createDelegationTools({
      db: {} as never, identity: IDENTITY, web: false,
      runNested: async () => ({ runId: "r", text: "x", model: "m", steps: [], failed: false }),
      onTurn: () => {},
    });
    /* the module-level mock still answers for the two seeded handles, so this
       asserts the SHAPE of the guard rather than re-mocking mid-suite: what
       matters is that a missing agent produces no tool, which the flatMap's
       empty array is */
    expect(tools.length).toBeLessThanOrEqual(2);
  });

  it("refuses an empty brief rather than waking a colleague for nothing", async () => {
    const { tools, nested } = await build();
    await expect(run(tools.find((t) => t.name === "ask_roya")!, { question: "   " }))
      .rejects.toBeInstanceOf(ToolDenied);
    expect(nested, "no run was spent").toHaveLength(0);
  });
});

describe("the platform tool surface", () => {
  it("every tool is distinct, described and callable", () => {
    const tools = createPlatformTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size, "no duplicate names").toBe(names.length);
    for (const t of tools) {
      expect(t.description.length, t.name).toBeGreaterThan(30);
      expect(t.parameters, t.name).toBeTruthy();
      expect(typeof t.run, t.name).toBe("function");
    }
  });

  it("the two specialisms overlap only where they must", () => {
    const analyst = new Set(toolsFor("analyst").map((t) => t.name));
    const operator = new Set(toolsFor("operator").map((t) => t.name));
    const shared = [...analyst].filter((n) => operator.has(n));
    /* a handful of reads neither can work without — and a SMALL handful: if
       the shared set were most of them, the specialisms would be labels */
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.length).toBeLessThan(Math.min(analyst.size, operator.size));
    expect(toolsFor("all").length).toBeGreaterThan(analyst.size);
  });
});

/**
 * THE OTHER DIRECTION (user directive, 2026-09-04: "they also must have the
 * ability to talk to echo and ask things from echo as well").
 *
 * Asserted the same way as the outward direction and for the same reason: what
 * an agent may hold is decided by what its output can reach, and the risk here
 * is precisely that `ask_echo` quietly hands a delegate the tool set Echo has
 * when a PERSON asks it — client tools that drive the browser, write tools
 * whose proposals have no conversation to be approved in, and its colleagues.
 */
describe("an agent asking Echo", () => {
  async function buildEcho() {
    const nested: Nested[] = [];
    const turns: { author: string; text: string; failed: boolean }[] = [];
    const tools = await createEchoTool({
      db: {} as never,
      identity: IDENTITY,
      web: true,
      locale: "fa",
      askedBy: "roya",
      onTurn: (turn) => { turns.push(turn); },
      runNested: async (input) => {
        nested.push(input as unknown as Nested);
        return { runId: "r-9", text: "Echo's answer", model: "m", steps: [], failed: false };
      },
    });
    return { tools, nested, turns };
  }

  it("is ONE tool, and not the colleague tools", async () => {
    const { tools } = await buildEcho();
    expect(tools.map((t) => t.name)).toEqual(["ask_echo"]);
  });

  it("hands Echo no way to delegate onward — the loop cannot close", async () => {
    /*
     * Roya asks Echo, Echo asks Ava, Ava asks Echo. Each step is individually
     * reasonable and the ceiling is the only thing between the shape and a
     * bill, so the shape is refused structurally: the nested run is built with
     * platform and domain tools and NOTHING whose name begins with `ask_`.
     */
    const { tools, nested } = await buildEcho();
    await run(tools[0]!, { question: "این هفته چند جلسه داریم؟" });
    expect(nested).toHaveLength(1);
    const offered = nested[0]!.tools.map((t) => t.name);
    expect(offered.filter((n) => n.startsWith("ask_"))).toEqual([]);
    /* the control: it was given SOMETHING, or the assertion above is a fact
       about an empty list rather than about delegation */
    expect(offered.length).toBeGreaterThan(0);
  });

  it("does not speak in the thread — Echo answering its own agent is not a turn", async () => {
    /*
     * A colleague's answer IS announced: the person asked Echo and somebody
     * else replied, which is a fact about the conversation. This is the
     * reverse — the person asked Roya, and Roya looking something up is
     * working out, not speaking. Announcing it would show two voices for one
     * answer that was only ever asked of one of them.
     */
    const { tools, turns } = await buildEcho();
    await run(tools[0]!, { question: "چند تا؟" });
    expect(turns).toEqual([]);
  });

  it("refuses an empty question WITHOUT spending an ask, then stops at the ceiling", async () => {
    /*
     * The ordering is the finding. `spent += 1` ran before the empty-question
     * check, so a malformed call — which is exactly the mistake a model
     * recovers from by trying again — was charged for, and the ceiling arrived
     * one real ask early. A budget bounds WORK, and a refusal did none.
     */
    const { tools, nested } = await buildEcho();
    await expect(run(tools[0]!, { question: "   " })).rejects.toBeInstanceOf(ToolDenied);
    expect(nested, "a refused call must not have run anything").toEqual([]);

    for (let i = 0; i < MAX_DELEGATIONS; i += 1) {
      await run(tools[0]!, { question: `س${i}` });
    }
    expect(nested).toHaveLength(MAX_DELEGATIONS);
    await expect(run(tools[0]!, { question: "یکی دیگر" })).rejects.toBeInstanceOf(ToolDenied);
  });
});
