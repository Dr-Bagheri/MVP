/**
 * Transcript / summary reads and search. Same split as calls-repo: RLS owns
 * visibility (Backend 3's SQL suite), this owns shape, bounds and the
 * normalisation contract that makes Persian search actually match.
 */
import { describe, expect, it } from "vitest";

import { createTranscriptsRepo, MAX_HITS, MAX_SEGMENTS, toWords } from "../src/api/transcripts.ts";
import { NotFoundError, ValidationError } from "../src/api/errors.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const CALL = "33333333-3333-4333-8333-333333333333";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

/**
 * NOTE `words` here is the STORAGE shape `{w, s, e}`, taken from the worker's
 * insert in worker/steps.ts — not the wire shape. Writing this fixture in the
 * wire shape is precisely how the two drifted apart unnoticed: both suites
 * were green while the API passed the jsonb through verbatim and every
 * consumer read `undefined` for every timestamp.
 */
const segmentRow = (over: Record<string, unknown> = {}) => ({
  id: "seg-1", seq: 0, part_id: "part-1", start_ms: 1_000, end_ms: 2_500,
  call_speaker_id: null, channel: null, text: "بودجه سال آینده",
  words: [{ w: "بودجه", s: 1_000, e: 1_400 }],
  edited: false, ...over,
});

const summaryRow = (over: Record<string, unknown> = {}) => ({
  id: "sum-2", version: 2, body: "خلاصه", model: "anthropic/claude-opus-5",
  created_at: "2026-08-12T10:00:00.000Z", created_by: ALICE, agent_run_id: null, ...over,
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
  return { log, db: createDb({ app: make(), agent: make() }) };
}

/**
 * The statements that matter. Identity plumbing is `set local role …` AND
 * `select set_config('echo.actor_id', …)` — the second one is a SELECT, so
 * filtering on a `set` prefix silently stops filtering and every index below
 * shifts by one.
 */
const queries = (log: { sql: string; params?: unknown[] | undefined }[]) =>
  log.filter((l) => {
    const sql = l.sql.trim().toLowerCase();
    return !sql.startsWith("set local")
      && !sql.includes("set_config('echo.actor_id'")
      // the 0087 capability probe is plumbing, not a product statement
      && !sql.includes("information_schema");
  });

describe("transcript segments", () => {
  it("returns the client shape, translating stored words to the wire shape", async () => {
    const { db } = fakeDb(() => [segmentRow()]);
    const [segment] = await createTranscriptsRepo(db).segments(IDENTITY, CALL);
    expect(segment).toEqual({
      id: "seg-1", seq: 0, part_id: "part-1", start_ms: 1_000, end_ms: 2_500,
      speaker_id: null, channel: null, text: "بودجه سال آینده",
      words: [{ w: "بودجه", start_ms: 1_000, end_ms: 1_400 }],
      edited: false,
    });
  });

  it("carries part_id, so grouping by part is not inferred from timestamps", async () => {
    const { db } = fakeDb(() => [segmentRow()]);
    const [segment] = await createTranscriptsRepo(db).segments(IDENTITY, CALL);
    expect(segment!.part_id).toBe("part-1");
  });

  it("carries an EMPTY words array rather than dropping the row (M20)", async () => {
    // A degraded part still has segments — they are seekable at line level.
    // Filtering them out here would silently truncate the transcript.
    const { db } = fakeDb(() => [segmentRow({ words: [] })]);
    const [segment] = await createTranscriptsRepo(db).segments(IDENTITY, CALL);
    expect(segment!.words).toEqual([]);
    expect(segment!.text).toBe("بودجه سال آینده");
  });

  it("pins the STORAGE shape the worker writes: {w, s, e}", () => {
    // This is the guard, and it is the point of the whole translation. The
    // worker's insert (worker/steps.ts) writes short keys because a word
    // array is the largest payload in the system. If that ever changes, this
    // fails by name here rather than silently emptying every words array in
    // production while both suites stay green — which is exactly what
    // happened when the jsonb went out verbatim.
    expect(toWords([{ w: "بودجه", s: 1_000, e: 1_400 }]))
      .toEqual([{ w: "بودجه", start_ms: 1_000, end_ms: 1_400 }]);
  });

  it("degrades a malformed word array to [] rather than fabricating a 0", () => {
    // [] already means "line-level timing only" and every consumer handles
    // it. A coerced 0ms would put an invented number on screen underneath a
    // seek affordance, which is worse than having no affordance.
    expect(toWords([{ w: "و", start_ms: 300, end_ms: 400 }])).toEqual([]);   // wire shape in storage
    expect(toWords([{ w: "و", s: "300", e: 400 }])).toEqual([]);
    expect(toWords([{ s: 300, e: 400 }])).toEqual([]);
    expect(toWords([{ w: "و", s: Number.NaN, e: 400 }])).toEqual([]);
  });

  it("keeps a legitimately zero-length word span (the real «و» case)", () => {
    // Backend 2's clip contains a word at 45128–45128. It is a real word with
    // a real position; only SEGMENT spans must be non-zero.
    expect(toWords([{ w: "و", s: 45_128, e: 45_128 }]))
      .toEqual([{ w: "و", start_ms: 45_128, end_ms: 45_128 }]);
  });

  it("treats a non-array or empty words value as line-level timing", () => {
    expect(toWords(null)).toEqual([]);
    expect(toWords([])).toEqual([]);
    expect(toWords("[]")).toEqual([]);
  });

  it("survives a null words column without throwing", async () => {
    // jsonb defaults to '[]', but a row written before that default (or by a
    // future writer) must not take the whole read down.
    const { db } = fakeDb(() => [segmentRow({ words: null })]);
    const [segment] = await createTranscriptsRepo(db).segments(IDENTITY, CALL);
    expect(segment!.words).toEqual([]);
  });

  it("clamps the window size — a transcript is unbounded, a response is not", async () => {
    const { db, log } = fakeDb(() => [segmentRow()]);
    const repo = createTranscriptsRepo(db);
    await repo.segments(IDENTITY, CALL);
    expect(queries(log)[0]!.params?.[3]).toBe(500);
    await repo.segments(IDENTITY, CALL, { limit: 99_999 });
    expect(queries(log)[1]!.params?.[3]).toBe(MAX_SEGMENTS);
    await repo.segments(IDENTITY, CALL, { limit: 0 });
    expect(queries(log)[2]!.params?.[3]).toBe(1);
  });

  it("selects segments that OVERLAP the window, not only those inside it", async () => {
    // A segment straddling from_ms is the one the user clicked toward; an
    // inside-only predicate drops exactly the utterance being sought.
    const { db, log } = fakeDb(() => [segmentRow()]);
    await createTranscriptsRepo(db).segments(IDENTITY, CALL, { fromMs: 1_500, toMs: 9_000 });
    const sql = queries(log)[0]!.sql;
    expect(sql).toContain("s.end_ms   >= $2::int");
    expect(sql).toContain("s.start_ms <= $3::int");
    expect(queries(log)[0]!.params?.slice(1, 3)).toEqual([1_500, 9_000]);
  });

  it("orders by time, not by insertion — parts land out of order", async () => {
    const { db, log } = fakeDb(() => [segmentRow()]);
    await createTranscriptsRepo(db).segments(IDENTITY, CALL);
    expect(queries(log)[0]!.sql).toContain("order by s.start_ms, s.seq");
  });

  it("validates the call id before touching the database", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(createTranscriptsRepo(db).segments(IDENTITY, "'; drop table echo.call; --"))
      .rejects.toThrow(/invalid call id/);
    expect(log).toHaveLength(0);
  });

  it("rejects a non-numeric window instead of passing NaN to SQL", async () => {
    const { db } = fakeDb(() => []);
    await expect(createTranscriptsRepo(db).segments(IDENTITY, CALL, { fromMs: Number("abc") }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe("summaries", () => {
  it("returns every version, newest first — regeneration never destroys", async () => {
    const { db, log } = fakeDb(() => [summaryRow(), summaryRow({ id: "sum-1", version: 1 })]);
    const versions = await createTranscriptsRepo(db).summaries(IDENTITY, CALL);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(queries(log)[0]!.sql).toContain("order by version desc");
  });

  it("current is the highest version", async () => {
    const { db } = fakeDb(() => [summaryRow(), summaryRow({ id: "sum-1", version: 1 })]);
    expect((await createTranscriptsRepo(db).currentSummary(IDENTITY, CALL)).version).toBe(2);
  });

  it("404s when there is no summary — not an empty body pretending to be one", async () => {
    const { db } = fakeDb(() => []);
    await expect(createTranscriptsRepo(db).currentSummary(IDENTITY, CALL))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("search", () => {
  const hitRows = () => [
    { call_id: CALL, call_title: "جلسه", kind: "transcript", start_ms: 1_000, end_ms: 2_000, snippet: "…<mark>بودجه</mark>…" },
    { call_id: CALL, call_title: "جلسه", kind: "summary", start_ms: null, end_ms: null, snippet: "…" },
  ];

  it("folds the QUERY with the same function that built the index", async () => {
    // The index is to_tsvector(fa_fold(text)). An unfolded query silently
    // matches nothing for Arabic-keyboard spellings — it looks like bad
    // search, not like a bug, which is why this is asserted rather than
    // trusted.
    const { db, log } = fakeDb(() => hitRows());
    await createTranscriptsRepo(db).search(IDENTITY, "بودجه");
    const sql = queries(log)[0]!.sql;
    expect(sql).toContain("websearch_to_tsquery('simple', echo.fa_fold($1))");
    expect(queries(log)[0]!.params?.[0]).toBe("بودجه");
  });

  it("highlights the RAW text, because fa_fold deletes ZWNJ", async () => {
    // Folding for display would render «می‌رود» as «میرود» in every snippet.
    // A missing <mark> degrades; mangled Persian does not.
    const { db, log } = fakeDb(() => hitRows());
    await createTranscriptsRepo(db).search(IDENTITY, "بودجه");
    const sql = queries(log)[0]!.sql;
    expect(sql).toContain("ts_headline('simple', s.text,");
    expect(sql).toContain("ts_headline('simple', m.body,");
    expect(sql).not.toContain("ts_headline('simple', echo.fa_fold(");
  });

  it("searches transcripts AND summaries, tagging which is which", async () => {
    const { db } = fakeDb(() => hitRows());
    const hits = await createTranscriptsRepo(db).search(IDENTITY, "بودجه");
    expect(hits.map((h) => h.kind)).toEqual(["transcript", "summary"]);
  });

  it("gives transcript hits a timestamp to seek to and summary hits none", async () => {
    const { db } = fakeDb(() => hitRows());
    const hits = await createTranscriptsRepo(db).search(IDENTITY, "بودجه");
    expect(hits[0]!.start_ms).toBe(1_000);
    // a summary is about the whole call — a fabricated timestamp would be a lie
    expect(hits[1]!.start_ms).toBeNull();
  });

  it("excludes soft-deleted calls — search must not resurrect them", async () => {
    const { db, log } = fakeDb(() => hitRows());
    await createTranscriptsRepo(db).search(IDENTITY, "بودجه");
    const sql = queries(log)[0]!.sql;
    expect(sql.match(/c\.deleted_at is null/g)).toHaveLength(3);   // all three branches
  });

  it("matches call TITLES too — a call is findable by name before it has words", async () => {
    // 2026-08-20: a call named "call2" with no transcript yet was invisible
    // to search AND to the assistant's Sources picker — the index only ever
    // covered transcript text and summaries, so an empty call could not be
    // found at all. Titles match folded (Arabic-keyboard spellings) and by
    // ILIKE, not tsquery — a name lookup must prefix-match while typing.
    const { db, log } = fakeDb(() => [
      { call_id: CALL, call_title: "call2", kind: "call", start_ms: null, end_ms: null, snippet: "call2" },
    ]);
    const hits = await createTranscriptsRepo(db).search(IDENTITY, "call2");
    expect(hits[0]!.kind).toBe("call");
    expect(hits[0]!.start_ms).toBeNull();
    const sql = queries(log)[0]!.sql;
    expect(sql).toContain("echo.fa_fold(c.title) ilike ('%' || echo.fa_fold($4) || '%') escape '\\'");
  });

  it("escapes ILIKE wildcards in the title pattern — `%` must not disable the filter", async () => {
    // The members-directory lesson, applied here: an unescaped % in the
    // query would match EVERY title, and an unescaped _ every character.
    const { db, log } = fakeDb(() => []);
    await createTranscriptsRepo(db).search(IDENTITY, "100%_\\done");
    expect(queries(log)[0]!.params?.[3]).toBe("100\\%\\_\\\\done");
  });

  it("clamps the hit count", async () => {
    const { db, log } = fakeDb(() => hitRows());
    await createTranscriptsRepo(db).search(IDENTITY, "بودجه", { limit: 10_000 });
    expect(queries(log)[0]!.params?.[2]).toBe(MAX_HITS);
  });

  it("rejects a query too short to be a search, before touching the database", async () => {
    const { db, log } = fakeDb(() => []);
    await expect(createTranscriptsRepo(db).search(IDENTITY, " ")).rejects.toBeInstanceOf(ValidationError);
    await expect(createTranscriptsRepo(db).search(IDENTITY, "ب")).rejects.toBeInstanceOf(ValidationError);
    expect(log).toHaveLength(0);
  });

  it("passes the query as a PARAMETER — websearch syntax is not injection", async () => {
    // websearch_to_tsquery swallows operator junk by design; the protection
    // that matters is that the text never reaches the SQL string.
    const { db, log } = fakeDb(() => []);
    await createTranscriptsRepo(db).search(IDENTITY, "'); drop table echo.summary; --");
    expect(queries(log)[0]!.sql).not.toContain("drop table");
    expect(queries(log)[0]!.params?.[0]).toBe("'); drop table echo.summary; --");
  });

  it("scopes to one call when asked, and validates that id", async () => {
    const { db, log } = fakeDb(() => hitRows());
    const repo = createTranscriptsRepo(db);
    await repo.search(IDENTITY, "بودجه", { callId: CALL });
    expect(queries(log)[0]!.params?.[1]).toBe(CALL);
    await expect(repo.search(IDENTITY, "بودجه", { callId: "not-a-uuid" }))
      .rejects.toThrow(/invalid call id/);
  });
});
