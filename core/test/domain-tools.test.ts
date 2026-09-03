/**
 * The four read tools db/0015 declared and nothing implemented.
 *
 * The steward's acceptance requirement is the interesting one, and it is
 * rule 12's deepest form: **the fixture is TWO calls about the same subject.**
 * A single call is the one input where the feature working and the feature
 * missing produce identical output — SPEC says "with nothing prior, it writes
 * from the transcript alone", so a summary with no tools at all looks exactly
 * like a correct first-call summary. Backend 2's live 20/20 acceptance run
 * could not see this gap for precisely that reason. However real the audio,
 * one call can never prove it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/pi.ts", async () => {
  const { Type } = await import("@earendil-works/pi-ai");
  return { Type, catalogue: () => [], runPi: vi.fn(), resolveModel: vi.fn(), reasoningFor: vi.fn() };
});

const { createDomainTools, DOMAIN_TOOL_NAMES } = await import("../src/agent/domain-tools.ts");
import { ToolDenied } from "../src/agent/tools.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const CALL_2 = "22222222-2222-4222-8222-222222222222";
const CALL_1 = "33333333-3333-4333-8333-333333333333";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

const tools = createDomainTools();
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, db: ReturnType<typeof createDb>, args: unknown) =>
  tool(name).run({ identity: IDENTITY, deps: { db } }, args as never);

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

const callRow = (id: string, title: string) => ({
  id, title, scope: "private", status: "ready", language: "fa",
  started_at: new Date("2026-08-12T09:00:00.000Z"), duration_ms: 60_000,
  owner_id: ALICE, transcribed_part_count: 1, timed_part_count: 1,
});

describe("the tools exist and are the ones the system skill declares", () => {
  it("implements every name db/0015 seeds — the set may grow, this floor may not", () => {
    // The intersection of these with the skill's `tools` array WAS empty, so
    // the summarizer ran with no tools and nothing said so. That is what this
    // asserts, and it is a CONTAINMENT rather than an equality now: 0167 added
    // `list_members`, which the seeded skill does not declare and does not
    // need — the runtime intersects, so an extra implemented tool reaches
    // nobody who did not ask for it.
    //
    // Equality was the right assertion while the two lists were the same list.
    // Keeping it would have made every new tool a red in a test about a
    // four-year-old seed, which is how a check gets edited into agreement
    // instead of read.
    const implemented = new Set(tools.map((t) => t.name));
    for (const declared of DOMAIN_TOOL_NAMES) {
      expect(implemented.has(declared), declared).toBe(true);
    }
    // and the control: this cannot pass by containing everything
    expect(implemented.has("definitely_not_a_tool")).toBe(false);
  });

  it("the members tool is here, and it is a READ", () => {
    /* user directive, 2026-09-03: "they must have the ability to know all
       members and their roles". Named explicitly rather than left to the
       containment above — a tool nothing asserts is a tool that can quietly
       stop being registered. */
    expect(tools.map((t) => t.name)).toContain("list_members");
  });

  it("declares parameters pi can serialise", () => {
    for (const t of tools) {
      expect(t.parameters, t.name).toBeTruthy();
      expect(t.description.length, t.name).toBeGreaterThan(20);
    }
  });
});

describe("THE acceptance case: a second call about the same subject", () => {
  /**
   * Two calls, same owner, same subject. Call 2 is being summarised; call 1
   * happened earlier. The tool must surface call 1 — that is the whole of
   * SPEC's "this is the fourth conversation about the same contract".
   */
  const twoCalls = (sql: string) => {
    if (sql.includes("websearch_to_tsquery")) {
      return [
        { call_id: CALL_1, call_title: "مذاکره قرارداد", kind: "summary",
          start_ms: null, end_ms: null, snippet: "قیمت پیشنهادی…" },
        { call_id: CALL_2, call_title: "مذاکره قرارداد — جلسه دوم", kind: "transcript",
          start_ms: 1_000, end_ms: 2_000, snippet: "…" },
      ];
    }
    if (sql.includes("echo.call")) return [callRow(CALL_2, "مذاکره قرارداد — جلسه دوم")];
    return [];
  };

  it("finds the EARLIER call and excludes the one being written about", async () => {
    const { db } = fakeDb(twoCalls);
    const result = await run("list_related_calls", db, { call_id: CALL_2 }) as {
      calls: { call_id: string; title: string }[]; count: number; related_on: string;
    };
    // the prior call is there…
    expect(result.calls.map((c) => c.call_id)).toEqual([CALL_1]);
    // …and the call being summarised is NOT, or the summary would cite itself
    expect(result.calls.some((c) => c.call_id === CALL_2)).toBe(false);
    expect(result.count).toBe(1);
  });

  it("relates on the call's own title when given no query", async () => {
    // one-argument usability: the title is what a person named the meeting,
    // which beats anything this layer could infer
    const { db, log } = fakeDb(twoCalls);
    await run("list_related_calls", db, { call_id: CALL_2 });
    const search = log.find((l) => l.sql.includes("websearch_to_tsquery"))!;
    expect(search.params?.[0]).toBe("مذاکره قرارداد — جلسه دوم");
  });

  it("returns an EMPTY list, not an error, when there is nothing prior", async () => {
    // SPEC: "with nothing prior, it writes from the transcript alone". The
    // model must be able to tell "searched, found nothing" from "could not
    // search" — which is the distinction that made this bug invisible.
    const { db } = fakeDb((sql) =>
      (sql.includes("echo.call") && !sql.includes("websearch") ? [callRow(CALL_2, "جلسه")] : []));
    const result = await run("list_related_calls", db, { call_id: CALL_2 }) as { count: number };
    expect(result.count).toBe(0);
  });
});

describe("every tool reaches only what its CALLER could reach", () => {
  it("refuses an invisible call the same way for every tool", async () => {
    // Same refusal for "no such call" and "not yours" — ownership must not be
    // probeable through the assistant.
    const { db } = fakeDb(() => []);
    for (const name of ["get_call", "read_window", "list_related_calls"]) {
      await expect(run(name, db, { call_id: CALL_1 }), name).rejects.toBeInstanceOf(ToolDenied);
    }
  });

  it("reads a window through the same repo the REST API uses", async () => {
    const { db, log } = fakeDb((sql) => {
      if (sql.includes("transcript_segment") && sql.includes("start_ms <=")) {
        return [{
          id: "s1", seq: 0, part_id: "p1", start_ms: 1_000, end_ms: 2_000,
          call_speaker_id: null, channel: null, text: "بودجه",
          words: [{ w: "بودجه", s: 1_000, e: 1_400 }], edited: false,
        }];
      }
      if (sql.includes("echo.call")) return [callRow(CALL_2, "جلسه")];
      return [];
    });
    const result = await run("read_window", db, { call_id: CALL_2, from_ms: 0, to_ms: 5_000 }) as {
      segments: { text: string; start_ms: number }[]; truncated: boolean;
    };
    expect(result.segments).toEqual([{ start_ms: 1_000, end_ms: 2_000, speaker_id: null, text: "بودجه" }]);
    expect(result.truncated).toBe(false);
    // The call was read FIRST — an invisible call is a refusal, not an empty
    // transcript, which would be a different and probeable claim.
    //
    // Matched on `order by s.start_ms`, not on "transcript_segment": the
    // CALL query also contains that table name, inside its part-count
    // subqueries, so the loose pattern found the same statement twice and
    // compared an index to itself.
    const callRead = log.findIndex((l) => l.sql.includes("from echo.call c"));
    const segmentRead = log.findIndex((l) => l.sql.includes("order by s.start_ms"));
    expect(callRead).toBeGreaterThanOrEqual(0);
    expect(segmentRead).toBeGreaterThan(callRead);
  });

  it("does not put word timings in a tool result — the model cannot use them", async () => {
    // Every word inflates the context for no benefit; the model needs text
    // and a timestamp to cite, not a per-word array.
    const { db } = fakeDb((sql) => {
      if (sql.includes("transcript_segment") && sql.includes("start_ms <=")) {
        return [{
          id: "s1", seq: 0, part_id: "p1", start_ms: 1_000, end_ms: 2_000,
          call_speaker_id: null, channel: null, text: "بودجه",
          words: [{ w: "بودجه", s: 1_000, e: 1_400 }], edited: false,
        }];
      }
      if (sql.includes("echo.call")) return [callRow(CALL_2, "جلسه")];
      return [];
    });
    const result = await run("read_window", db, { call_id: CALL_2 }) as {
      segments: Record<string, unknown>[];
    };
    expect(result.segments[0]).not.toHaveProperty("words");
  });

  it("search passes the caller's query straight to the folded index", async () => {
    const { db, log } = fakeDb(() => []);
    const result = await run("search_transcripts", db, { query: "قرارداد" }) as { count: number };
    expect(result.count).toBe(0);
    const search = log.find((l) => l.sql.includes("websearch_to_tsquery"))!;
    expect(search.sql).toContain("echo.fa_fold($1)");
    expect(search.params?.[0]).toBe("قرارداد");
  });
});
