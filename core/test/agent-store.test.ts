/** Saved assistant personas (M30): resolution and wire boundary. */
import { describe, expect, it } from "vitest";

import {
  createAssistantAgent, listAssistantAgents, resolveAssistantAgent,
} from "../src/agent/agent-store.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member",
  isActive: true,
};

const row = (over: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  handle: "sales", name: "Sales", description: "System wording", level: "system",
  instructions: "SERVER ONLY", model: null,
  tools: ["search_transcripts"], source_scope: { calls: "accessible" },
  icon: "chart", color: "lime", ...over,
});

function fakeDb(rowsFor: (sql: string, params?: unknown[]) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return rowsFor(sql, params) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

describe("saved-agent resolution", () => {
  it("selects the most-specific row, and shows a prompt only where it is the caller's to edit", async () => {
    const { db } = fakeDb(() => [
      row(),
      row({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", level: "org", name: "Sales team", instructions: "ORG ONLY" }),
      row({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", level: "user", name: "My sales", instructions: "PERSONAL ONLY" }),
      row({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", handle: "legal", name: "Legal", instructions: "LEGAL ONLY" }),
    ]);

    const cards = await listAssistantAgents(db, IDENTITY);
    expect(cards).toHaveLength(2);
    expect(cards.find((agent) => agent.handle === "sales")?.name).toBe("My sales");
    /*
     * 0166: the rule NARROWED, and the narrowing is the assertion.
     *
     * It used to be "prompt text never crosses this boundary", which was right
     * about the two agents the product ships and wrong about an agent somebody
     * wrote themselves: PATCH has accepted `instructions` since M47 and no
     * screen could fill the field, because the read never returned it. A form
     * that cannot show you your own text cannot let you change a line of it.
     *
     * So the boundary moved from "never" to "not the system's". Both halves
     * are asserted here — a rule that only checks the permissive side would be
     * satisfied by returning every prompt to everyone.
     */
    const own = cards.find((agent) => agent.handle === "sales");
    expect(own?.instructions).toBe("PERSONAL ONLY");
    expect(own?.editable).toBe(true);
    /* the half that was the whole rule: what the product ships is nobody's to
       read or change, and a card that carried it would be the old bug with a
       new field name */
    const shipped = cards.find((agent) => agent.handle === "legal");
    expect(shipped?.instructions).toBeNull();
    expect(shipped?.editable).toBe(false);

    const resolved = await resolveAssistantAgent(db, IDENTITY, "sales");
    expect(resolved?.instructions).toBe("PERSONAL ONLY");
  });

  it("creates a personal persona under the caller and uses an opaque safe handle", async () => {
    const created = row({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", handle: "agent-created", name: "عامل فروش", level: "user", tools: [] });
    const { db, log } = fakeDb((sql) => sql.includes("insert into echo.assistant_agent") ? [created] : []);

    const agent = await createAssistantAgent(db, IDENTITY, {
      level: "user", name: "عامل فروش", instructions: "فقط با شواهد پاسخ بده.", tools: [],
    });
    expect(agent.tools).toEqual([]);
    expect(agent.handle).toBe("agent-created");
    /* the creator gets the prompt back — this is the read that fills the edit
       form, and returning it empty is how "save" would blank a persona
       somebody had just written. It is the ROW's text, not the argument's:
       this fake answers every insert with a canned row, so asserting the input
       here would be asserting that the code echoes what it was given, which is
       the one thing a create must not do. */
    expect(agent.instructions).toBe(created.instructions);
    expect(agent.editable).toBe(true);

    const insert = log.find((entry) => entry.sql.includes("insert into echo.assistant_agent"));
    expect(insert?.params?.[2]).toBe(IDENTITY.userId);
    expect(insert?.params?.[3]).toMatch(/^agent-[0-9a-f-]{36}$/);
  });

  it("refuses organisation authoring for an ordinary member before touching the database", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(createAssistantAgent(db, IDENTITY, {
      level: "org", name: "Team agent", instructions: "x",
    })).rejects.toThrow("not permitted");
    expect(log).toEqual([]);
  });
});
