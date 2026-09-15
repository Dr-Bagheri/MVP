/**
 * Conversations (M4, db/0018) — and the truncation annotation FE2 found.
 *
 * The case that matters: a run failing MID-STREAM leaves a real partial
 * answer in the thread, and after a reload nothing says it stopped early. It
 * renders identically to a complete answer the model chose to give, which in
 * a product whose value is "you need not re-listen to the call" means a user
 * can act on half a summary believing it is the whole one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../src/api/errors.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { createSessionsRepo, titleFrom } from "../src/api/sessions.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "member",
  isActive: true,
};
const SESSION = "55555555-5555-4555-8555-555555555555";

function fakeDb(rowsFor: (sql: string) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes("set local") || sql.includes("set_config")) return [];
        return rowsFor(sql);
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const message = (over: Record<string, unknown> = {}) => ({
  id: "m1", seq: 0, role: "assistant", content: "سه موضوع مطرح شد: نخست",
  tool_calls: [], agent_run_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  created_at: new Date("2026-08-13T10:00:00Z"), ...over,
});

describe("a cut-off answer says so", () => {
  const thread = (sql: string, row: Record<string, unknown>) =>
    sql.includes("agent_message") ? [row] : [{ id: SESSION }];

  it("marks a turn whose run errored", async () => {
    const { db } = fakeDb((sql) => thread(sql, message({ truncated: true })));
    const [turn] = await createSessionsRepo(db).messages(IDENTITY, SESSION);
    expect(turn!.truncated).toBe(true);
  });

  it("leaves a completed turn unmarked", async () => {
    const { db } = fakeDb((sql) => thread(sql, message({ truncated: false })));
    const [turn] = await createSessionsRepo(db).messages(IDENTITY, SESSION);
    expect(turn!.truncated).toBe(false);
  });

  it("does NOT claim truncation when the run is unreadable", async () => {
    // A LEFT JOIN to a run this caller cannot see yields null. The safe
    // default is silence: a wrong "cut off" on a complete answer is its own
    // lie, and worse than the vaguer nothing.
    const { db } = fakeDb((sql) => thread(sql, message({ truncated: null })));
    const [turn] = await createSessionsRepo(db).messages(IDENTITY, SESSION);
    expect(turn!.truncated).toBe(false);
  });

  it("never marks a human turn", async () => {
    const { db } = fakeDb((sql) =>
      thread(sql, message({ role: "user", agent_run_id: null, truncated: null })));
    const [turn] = await createSessionsRepo(db).messages(IDENTITY, SESSION);
    expect(turn!.truncated).toBe(false);
  });

  it("calls the SHARED predicate rather than spelling the rule again", async () => {
    /**
     * Three predicates existed for one rule: my `= 'error'`, db/0047's stamp
     * `<> 'ok'`, and my near-miss `<> 'ok'` live. db/0048 makes it one
     * function both halves call, with the context as a parameter — a run is
     * truncated if it did not finish cleanly AND is not still plausibly in
     * flight, and `started_at` is what decides the second clause.
     *
     * Asserted on the SQL because the divergence IS the predicate: any
     * re-spelling of the rule here is exactly the drift this closed.
     */
    const { db, log } = fakeDb((sql) => thread(sql, message({ truncated: true })));
    await createSessionsRepo(db).messages(IDENTITY, SESSION);
    const query = log.find((l) => l.sql.includes("agent_message"))!.sql;
    // The TWO-argument form: `started_at` is what makes the answer structural
    // rather than dependent on the api appending after the run resolves.
    expect(query).toContain("echo.run_is_truncated(r.status, r.started_at)");
    // No local copy of the rule, in either spelling.
    expect(query).not.toContain("r.status = 'error'");
    expect(query).not.toContain("r.status <> 'ok'");
  });

  it("derives it by join rather than reading a stored column", async () => {
    // Stored, it would be a second copy of agent_run.status that can disagree
    // with it — and it would have needed a migration for a fact the database
    // already held.
    const { db, log } = fakeDb((sql) => thread(sql, message({ truncated: true })));
    await createSessionsRepo(db).messages(IDENTITY, SESSION);
    const query = log.find((l) => l.sql.includes("agent_message"))!.sql;
    expect(query).toContain("left join echo.agent_run");
  });
});

describe("a thread that isn't there is not an empty thread", () => {
  it("404s for a conversation the caller cannot see", async () => {
    // Both would otherwise be `[]` — the recurring two-kinds-of-nothing bug.
    const { db } = fakeDb(() => []);
    await expect(createSessionsRepo(db).messages(IDENTITY, SESSION))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns an empty array for a real conversation with nothing said", async () => {
    const { db } = fakeDb((sql) => (sql.includes("agent_message") ? [] : [{ id: SESSION }]));
    await expect(createSessionsRepo(db).messages(IDENTITY, SESSION)).resolves.toEqual([]);
  });
});

describe("titles are made from the first question", () => {
  it("keeps a short one whole", () => {
    expect(titleFrom("خلاصهٔ جلسه؟")).toBe("خلاصهٔ جلسه؟");
  });

  it("collapses whitespace so a pasted prompt does not become a ragged title", () => {
    expect(titleFrom("  چه\n\n خبر  ")).toBe("چه خبر");
  });

  it("cuts on a word boundary when there is one nearby", () => {
    const title = titleFrom(`${"word ".repeat(30)}end`);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/wo…$/);
  });

  it("still truncates an unbroken string rather than collapsing it", () => {
    // Searching back for a space must not eat most of the title when there
    // is no space to find.
    const title = titleFrom("a".repeat(200));
    expect(title.length).toBeGreaterThan(60);
  });
});


/**
 * THE FLOOR ON THE SESSION (db/0194, 2026-09-06): read with the thread so a
 * resumed conversation knows who is in the room, and written by the × the
 * way the router writes it — one spelling, `["echo"]` stored as `[]`.
 */
describe("the floor", () => {
  it("the thread read carries the floor beside the rows", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("select floor from echo.agent_session")) return [{ floor: ["roya", "ava"] }];
      if (sql.includes("select id from echo.agent_session")) return [{ id: SESSION }];
      return [];
    });
    const repo = createSessionsRepo(db);
    const thread = await repo.thread(IDENTITY, SESSION);
    expect(thread.messages).toEqual([]);
    expect(thread.floor).toEqual(["roya", "ava"]);
  });

  it("setFloor lowercases, dedupes, and stores a lone «echo» as nothing", async () => {
    const { db, log } = fakeDb((sql) => (sql.includes("returning floor") ? [{ floor: [] }] : []));
    const repo = createSessionsRepo(db);
    await repo.setFloor(IDENTITY, SESSION, ["Echo", " echo "]);
    const write = log.find((l) => l.sql.includes("returning floor"));
    expect(write?.params?.[1]).toEqual([]);
    await repo.setFloor(IDENTITY, SESSION, ["Roya", "roya", "ava"]);
    const second = log.filter((l) => l.sql.includes("returning floor")).at(-1);
    expect(second?.params?.[1]).toEqual(["roya", "ava"]);
  });

  it("setFloor refuses what is not a handle, and a ninth name", async () => {
    const { db } = fakeDb(() => [{ floor: [] }]);
    const repo = createSessionsRepo(db);
    await expect(repo.setFloor(IDENTITY, SESSION, ["not a handle"])).rejects.toMatchObject({ code: "bad_handle" });
    await expect(repo.setFloor(IDENTITY, SESSION, ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"]))
      .rejects.toMatchObject({ code: "floor_too_wide" });
  });

  it("setFloor on a conversation the caller cannot see is not-found, not silence", async () => {
    const { db } = fakeDb(() => []);
    await expect(createSessionsRepo(db).setFloor(IDENTITY, SESSION, ["roya"])).rejects.toBeInstanceOf(NotFoundError);
  });
});

/**
 * THE SESSION'S OTHER CONVERSATIONS (user directive, 2026-09-08: "make the
 * memory per session not per thread").
 *
 * `messages` above answers what was said in ONE conversation; this answers
 * what the person has been talking to us about, which is the question a
 * brand-new conversation cannot answer for itself.
 *
 * Two kinds of rule live here and they are tested differently. The GROUPING
 * and the BOUNDS are behaviour, and a fake can be asked about them. The rest
 * — archived excluded, the window, tool rows dropped — are in the statement,
 * where a fake that decides its own rows cannot reach them; those are pinned
 * as SQL text, deliberately and for the same reason the double-encode fix
 * was (the string IS the wall), with the real check being db's own suite.
 */
describe("the other conversations of this session", () => {
  const turn = (id: string, title: string, seq: number, over: Record<string, unknown> = {}) => ({
    id, title, seq, role: "user", content: `${title}-${seq}`, author: null, ...over,
  });

  it("groups the rows into conversations, in the order they arrive", async () => {
    const { db } = fakeDb(() => [
      turn("s-old", "دیروز", 0),
      turn("s-old", "دیروز", 1, { role: "assistant", content: "پاسخ", author: "roya" }),
      turn("s-new", "امروز", 4),
    ]);
    const out = await createSessionsRepo(db).recentConversations(IDENTITY, {
      exclude: SESSION, withinHours: 12, limit: 3, turnsEach: 6,
    });
    expect(out.map((c) => c.title)).toEqual(["دیروز", "امروز"]);
    expect(out[0]!.rows).toHaveLength(2);
    expect(out[0]!.rows[1]).toEqual({ role: "assistant", content: "پاسخ", author: "roya" });
    expect(out[1]!.rows).toHaveLength(1);
  });

  it("EXCLUDES the conversation being asked in — carried in full elsewhere", async () => {
    const { db, log } = fakeDb(() => []);
    await createSessionsRepo(db).recentConversations(IDENTITY, {
      exclude: SESSION, withinHours: 12, limit: 3, turnsEach: 6,
    });
    const read = log.find((l) => l.sql.includes("agent_session"));
    expect(read?.params?.[0], "the current conversation is the first parameter").toBe(SESSION);
  });

  it("asks for every conversation when there is none to exclude", async () => {
    /* the hub's first message opens its session AFTER this read in one path
       and before it in another; null must mean "all of them", not "none" */
    const { db, log } = fakeDb(() => []);
    await createSessionsRepo(db).recentConversations(IDENTITY, {
      exclude: null, withinHours: 12, limit: 3, turnsEach: 6,
    });
    const read = log.find((l) => l.sql.includes("agent_session"));
    expect(read?.params?.[0]).toBeNull();
    expect(read?.sql).toContain("is distinct from");
  });

  it("CLAMPS what it is asked for — every one of these multiplies an ask's cost", async () => {
    const { db, log } = fakeDb(() => []);
    await createSessionsRepo(db).recentConversations(IDENTITY, {
      exclude: null, withinHours: 10_000, limit: 500, turnsEach: 5_000,
    });
    const [, hours, limit, turns] = log.find((l) => l.sql.includes("agent_session"))?.params ?? [];
    expect(hours).toBe(24 * 7);
    expect(limit).toBe(10);
    expect(turns).toBe(40);
  });

  it("reads only what a session may carry: not archived, inside the window, words only", async () => {
    const { db, log } = fakeDb(() => []);
    await createSessionsRepo(db).recentConversations(IDENTITY, {
      exclude: null, withinHours: 12, limit: 3, turnsEach: 6,
    });
    const sql = log.find((l) => l.sql.includes("agent_session"))?.sql ?? "";
    /* archiving is the person saying "done with this" — `resolveForAsk`
       already refuses to resume one, and a thread that cannot be reopened
       must not go on answering through a prompt */
    expect(sql).toContain("archived_at is null");
    /* the window is what makes "per session" a claim rather than "everything
       you have ever said" */
    expect(sql).toContain("interval '1 hour'");
    /* the newest conversations, and the END of each */
    expect(sql).toContain("order by last_message_at desc");
    expect(sql).toContain("order by seq desc");
    /* tool rows are codes, not speech: dropped here so `turnsEach` counts
       six things somebody said and not six rows of which four are codes */
    expect(sql).toContain("role <> 'tool'");
  });
});

/**
 * A BRIEF IS NOT A CONVERSATION YOU HAD (db/0221, 2026-09-09).
 *
 * Four rehearsal meetings put four «خلاصهٔ آمادهٔ …» rows in the sidebar: the
 * post-call brief opens a session so its `agent_card` has something to point
 * at, and `resolveForAsk(identity, null, title)` is the same call the ask
 * route makes when a person starts a conversation.
 *
 * WHAT IS ASSERTED HERE AND WHAT IS NOT. The RULE — who is in the list — is a
 * database function, and db/test/126 walks its three arms against real rows
 * under real RLS (opened-by-her in, brief-she-ignored out, brief-she-answered
 * in), verified red by six mutations. Re-deciding it against a fake here would
 * be a test that agrees with itself; what this file owns is the WIRING: that
 * the repo asks the database's rule instead of spelling a second one, and that
 * a background job's session is opened as the background job's.
 */
describe("a brief the agent wrote is not a conversation you had", () => {
  const listRows = (sql: string) =>
    (sql.includes("from echo.agent_session") && sql.includes("message_count")
      ? [{
        id: SESSION, title: "t", last_message_at: null, archived_at: null,
        created_at: new Date("2026-09-09T00:00:00Z"), message_count: 0,
      }]
      : []);

  /** The catalogue probe `hasSessionOrigin` runs before the query it gates. */
  const withColumn = (present: boolean) => (sql: string) =>
    (sql.includes("information_schema.columns") ? (present ? [{ present: 1 }] : []) : listRows(sql));

  const listSql = (log: { sql: string }[]) =>
    log.find((l) => l.sql.includes("message_count"))!.sql;

  beforeEach(() => resetCapabilityCache());
  afterEach(() => resetCapabilityCache());

  it("asks the DATABASE's rule rather than spelling a second one", async () => {
    /*
     * db/0048 is the standing lesson: `run_is_truncated` was one rule written
     * three times and the three disagreed. So the assertion is on the SQL,
     * because a re-spelling IS the defect — a predicate here that happened to
     * agree with the function today is exactly what drifts tomorrow.
     */
    const { db, log } = fakeDb(withColumn(true));
    await createSessionsRepo(db).list(IDENTITY);
    const sql = listSql(log);
    expect(sql).toContain("echo.session_belongs_in_history(");
    // No local copy of either arm, in any spelling.
    expect(sql).not.toContain("origin = 'user'");
    expect(sql).not.toContain("origin <> 'agent'");
    expect(sql).not.toContain("from echo.agent_message m where m.session_id");
  });

  it("does NOT filter before the migration lands — and still returns the list", async () => {
    /*
     * The forfeit, said out loud (M21). A query naming a column the catalogue
     * has not got 500s the assistant's first screen for every request until
     * the migration runs, and deploys and migrations arrive in either order.
     *
     * This is also the negative control for the test above: asserting only
     * that the predicate is PRESENT cannot tell "the repo consults the rule"
     * from "this string appears in every query the repo writes". A case where
     * it must be ABSENT is what makes the presence mean something — and the
     * row coming back is what stops a degraded path being a broken one.
     */
    const { db, log } = fakeDb(withColumn(false));
    const rows = await createSessionsRepo(db).list(IDENTITY);
    expect(listSql(log)).not.toContain("session_belongs_in_history");
    expect(rows).toHaveLength(1);
  });

  it("a background job's session is opened as the background job's", async () => {
    const { db, log } = fakeDb((sql) =>
      (sql.includes("information_schema.columns") ? [{ present: 1 }] : [{ id: SESSION }]));
    await createSessionsRepo(db).resolveForAsk(IDENTITY, null, "خلاصهٔ آماده", "agent");
    const write = log.find((l) => l.sql.includes("insert into echo.agent_session"))!;
    expect(write.params?.[3]).toBe("agent");
  });

  it("but a person's own ask still opens a conversation of theirs", async () => {
    /*
     * The control that matters most, and the one a fix aimed at the sidebar
     * gets wrong: marking EVERY new session 'agent' hides the defect's rows
     * and empties the sidebar for everybody, and every assertion above still
     * passes. The default has to be proven, not assumed from a signature.
     */
    const { db, log } = fakeDb((sql) =>
      (sql.includes("information_schema.columns") ? [{ present: 1 }] : [{ id: SESSION }]));
    await createSessionsRepo(db).resolveForAsk(IDENTITY, null, "چه خبر؟");
    const write = log.find((l) => l.sql.includes("insert into echo.agent_session"))!;
    expect(write.params?.[3]).toBe("user");
  });

  it("writes no origin at all before the migration lands", async () => {
    const { db, log } = fakeDb((sql) =>
      (sql.includes("information_schema.columns") ? [] : [{ id: SESSION }]));
    await createSessionsRepo(db).resolveForAsk(IDENTITY, null, "خلاصهٔ آماده", "agent");
    const write = log.find((l) => l.sql.includes("insert into echo.agent_session"))!;
    expect(write.sql).not.toContain("origin");
    expect(write.params).toHaveLength(3);
  });
});
