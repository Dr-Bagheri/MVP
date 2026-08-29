import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditCursor, AuditEntry, AuditPage, User } from "@/api/types";

/**
 * Audit Logs — and mostly, the two ways this screen could lie.
 *
 * It could **drop** an entry (a page boundary that skips rows, an unknown
 * source silently filtered out), which turns an incomplete record into a
 * confident one. Or it could **show** something the audit trail is not allowed
 * to carry. Both failures render as a clean, plausible table, which is why
 * they are what this file is built around rather than "the columns appear".
 *
 * The paging tests are the ones that earn their keep, and their shape is
 * deliberate: `api.audit` is faked as a **server that implements the
 * endpoint's RULE** — order by `(at, source, id)` DESC, take rows row-wise
 * strictly after the cursor, over-fetch by one to decide `next_cursor` — over
 * a fixed dataset. A fake that returned prepared pages would answer whatever
 * cursor it was handed and could never disagree with the client, so the bug it
 * exists to catch would be unrepresentable in it. When the thing being faked
 * is a rule, the fake has to be the rule.
 *
 * The dataset carries the one detail that makes the cursor easy to get wrong:
 * **a full-precision timestamp that is not the displayed one.** Postgres
 * stores microseconds, `at` is rendered in milliseconds, and `next_cursor.at`
 * is the microsecond text. A client that rebuilds a cursor out of what is on
 * screen looks completely correct and silently loses rows.
 */

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

const admin: User = {
  id: ADMIN_ID, org_id: "o-1", username: "admin", email: "admin@example.test",
  display_name: "مدیر سازمان", avatar_url: null, role: "admin", status: "active",
  locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
};
const member: User = {
  ...admin, id: "u-9", username: "member", role: "member", display_name: "عضو ساده",
};

/**
 * The instant that makes the paging bug reachable: five entries share it.
 *
 * That is not a contrived coincidence — `now()` in Postgres is TRANSACTION
 * time, so every row a single transaction writes carries the same instant by
 * construction. A purge or a bulk member change lands exactly like this.
 */
const TIE = "2026-08-13T09:00:00.000Z";
/** …and the microseconds only the cursor ever sees. */
const TIE_FULL = "2026-08-13T09:00:00.000123Z";

/** What the server holds: the entry as published, plus the full-precision
 *  timestamp that never reaches the screen. */
interface Row {
  entry: AuditEntry;
  atFull: string;
}

function row(id: string, at: string, atFull: string, over: Partial<AuditEntry> = {}): Row {
  const base: AuditEntry = {
    source: "admin_action", id, at, actor_id: ADMIN_ID, actor_name: "مدیر سازمان",
    action: "member.role_changed", target_type: "member", target_id: "u-9",
    // `kind` is rendered verbatim, so it doubles as this row's marker on screen
    detail: { kind: id },
  };
  return { entry: Object.assign(base, over), atFull };
}

/** Milliseconds → the same instant with zero microseconds, uniformly wide so
 *  string order is chronological order. */
const full = (ms: string) => `${ms.slice(0, -1)}000Z`;

/**
 * 55 rows: 47 at distinct instants, 5 sharing `TIE`, 3 older.
 *
 * At `limit` 50 the tie group straddles the page boundary — which is the whole
 * point. Ordered `id DESC` within the tie, `e52 e51 e50` fit and **`e49` and
 * `e48` do not**; they are the rows a cursor that filtered on the timestamp
 * alone, or one rebuilt from the displayed value, would never send.
 */
function dataset(): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= 47; i += 1) {
    const at = new Date(Date.parse(TIE) + (48 - i) * 60_000).toISOString();
    rows.push(row(`e${String(i).padStart(2, "0")}`, at, full(at)));
  }
  for (let i = 48; i <= 52; i += 1) rows.push(row(`e${i}`, TIE, TIE_FULL));
  for (let i = 53; i <= 55; i += 1) {
    const at = new Date(Date.parse(TIE) - (i - 52) * 60_000).toISOString();
    rows.push(row(`e${i}`, at, full(at)));
  }
  return rows;
}

/**
 * Microseconds since the epoch.
 *
 * Postgres compares `timestamptz` as a VALUE, not as text, and the difference
 * decides what a broken cursor looks like: string comparison makes a truncated
 * `…000Z` sort *below* `…000123Z` (because `'1' < 'Z'`) and the page comes back
 * with duplicates, where the real database excludes those rows and the page
 * comes back short. Both are failures and either would fail this suite — but a
 * fake should fail the way production fails, or the symptom it teaches is the
 * wrong one.
 */
const micros = (iso: string) =>
  Date.parse(`${iso.slice(0, 23)}Z`) * 1000 + (Number(iso.slice(23, 26)) || 0);

/** `(at, source, id)` as the ORDER BY compares them. */
const tuple = (r: Row): [number, string, string] => [micros(r.atFull), r.entry.source, r.entry.id];
const cursorTuple = (c: AuditCursor): [number, string, string] => [micros(c.at), c.source, c.id];
const before = (a: [number, string, string], b: [number, string, string]) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/**
 * The endpoint, as a rule. Nothing here knows what the client intends — which
 * is exactly what lets the client be wrong.
 */
function fakeServer(rows: Row[], forceLimit?: number) {
  return vi.fn(
    async (query?: { limit?: number; cursor?: AuditCursor; source?: string }): Promise<AuditPage> => {
      /*
       * `forceLimit` overrides the client's page size so a test can place the
       * boundary exactly where it wants it — inside a tie group of two, say.
       * The SERVER decides how many rows a page holds; a client asking for 50
       * and receiving 1 is ordinary, so this narrows nothing the real endpoint
       * guarantees.
       */
      const limit = forceLimit ?? query?.limit ?? 50;
      const ordered = [...rows].sort((a, b) => (before(tuple(a), tuple(b)) ? 1 : -1));
      const scoped = query?.source
        ? ordered.filter((r) => r.entry.source === query.source)
        : ordered;
      const after = query?.cursor
        ? scoped.filter((r) => before(tuple(r), cursorTuple(query.cursor!)))
        : scoped;
      // over-fetch by one, exactly as core/ does, so `next_cursor` is a fact
      const window = after.slice(0, limit + 1);
      const page = window.slice(0, limit);
      const last = page[page.length - 1];
      return {
        entries: page.map((r) => r.entry),
        next_cursor:
          window.length > limit && last
            ? { at: last.atFull, source: last.entry.source, id: last.entry.id }
            : null,
      };
    },
  );
}

const me = vi.fn();
const audit = vi.fn();
vi.mock("@/api/client", () => ({
  api: { me: () => me(), audit: (query?: unknown) => audit(query) },
}));

const { AuditLogs, auditDetailValue } = await import("./AuditLogs");

const page = (entries: AuditEntry[], next: AuditCursor | null = null): AuditPage => ({
  entries,
  next_cursor: next,
});

/**
 * The house pager (2026-08-27) sits between the fetched rows and the screen:
 * a request brings 50, the table shows TEN. So "did paging lose a row" is no
 * longer answerable from one screenful, and these three helpers walk it.
 *
 * `detail.kind` is rendered verbatim, which is why every fixture row's marker
 * is its own id — the marker names the row on whatever page it lands.
 */
const markers = () =>
  screen
    .getAllByRole("row")
    .slice(1) // the header
    .map((row) => row.textContent?.match(/e\d\d/)?.[0])
    .filter((found): found is string => found !== undefined);

/** The pager's numbers, told apart from its two chevrons by carrying one. */
const pageButtons = () =>
  within(screen.getByRole("navigation")).getAllByRole("button", {
    name: /[۰۱۲۳۴۵۶۷۸۹]/,
  });

const faDigits = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
const goToPage = (n: number) =>
  userEvent.click(screen.getByRole("button", { name: new RegExp(`${faDigits(n)}$`) }));

beforeEach(() => {
  me.mockReset();
  audit.mockReset();
  me.mockResolvedValue(admin);
  audit.mockResolvedValue(page([]));
});

describe("the admin gate", () => {
  it("refuses a member — and does not ask for the feed at all", async () => {
    me.mockResolvedValue(member);
    render(<AuditLogs />);

    await screen.findByText(/این بخش در اختیار مدیر سازمان است/);
    expect(screen.queryByRole("table")).toBeNull();
    /*
     * Not a performance point. A member who saw an EMPTY audit table would
     * read it as "nothing has ever happened in this organization" — a claim
     * about the org assembled out of a fact about their permissions. Asking
     * for nothing is what makes that misreading impossible.
     */
    expect(audit).not.toHaveBeenCalled();
  });

  it("renders the feed for an admin — proving the gate is not simply always closed", async () => {
    audit.mockResolvedValue(page([row("e01", TIE, TIE_FULL).entry]));
    render(<AuditLogs />);
    await waitFor(() => expect(audit).toHaveBeenCalled());
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.queryByText(/این بخش در اختیار مدیر سازمان است/)).toBeNull();
  });
});

describe("paging across an instant shared by more rows than fit on a page", () => {
  it("loses nothing — including the tie-mates that never fit on the first page", async () => {
    audit.mockImplementation(fakeServer(dataset()));
    render(<AuditLogs />);

    // anchored on a value that exists only AFTER the first page arrives —
    // waiting for "the table" would also be satisfied mid-load
    await screen.findByText("e01");
    expect(screen.queryByText("e49")).toBeNull(); // the request genuinely ends above it

    await userEvent.click(screen.getByRole("button", { name: /رویدادهای قدیمی‌تر/ }));
    await waitFor(() => expect(audit).toHaveBeenCalledTimes(2));

    /*
     * **The discriminating assertion**, now walked across the pager rather
     * than read off one screenful. `e48` and `e49` share `TIE` with rows that
     * DID fit on the server's first page. They are reachable only if the
     * cursor compares all three ordered fields AND carries the microseconds —
     * either failure makes them vanish from the record with nothing on screen
     * to suggest anything is missing.
     *
     * Collecting instead of counting also buys the assertion the pager's own
     * boundaries: a display page that repeated a row, or skipped one, is a
     * different bug in the same shape, and a bare `toHaveLength` on a single
     * page could not see either.
     */
    await waitFor(() => expect(pageButtons()).toHaveLength(6)); // 55 rows, ten a page
    const seen: string[] = [];
    for (let p = 1; p <= 6; p += 1) {
      if (p > 1) await goToPage(p);
      seen.push(...markers());
    }

    expect(seen).toContain("e49");
    expect(seen).toContain("e48");
    // every row, ONCE — losing one and showing one twice are both failures here
    expect(seen).toHaveLength(55);
    expect(new Set(seen).size).toBe(55);
  });

  it("hands the cursor back verbatim, microseconds and all", async () => {
    audit.mockImplementation(fakeServer(dataset()));
    render(<AuditLogs />);
    await screen.findByText("e01");
    await userEvent.click(screen.getByRole("button", { name: /رویدادهای قدیمی‌تر/ }));

    await waitFor(() => expect(audit).toHaveBeenCalledTimes(2));
    const sent = audit.mock.calls[1]![0] as { cursor: AuditCursor };
    /*
     * `TIE_FULL`, not `TIE`. The displayed `at` and the cursor's `at` are
     * different values on purpose, and a cursor rebuilt from the screen would
     * be the truncated one — correct in shape, lossy in practice, and green in
     * any test that only checked that *a* cursor was sent.
     */
    expect(sent.cursor.at).toBe(TIE_FULL);
    expect(sent.cursor.id).toBe("e50");
    expect(sent.cursor.source).toBe("admin_action");
  });

  it("offers no further paging once the cursor comes back null", async () => {
    audit.mockImplementation(fakeServer([row("e01", TIE, TIE_FULL), row("e02", TIE, TIE_FULL)]));
    render(<AuditLogs />);
    await screen.findByText("e01");
    /*
     * `next_cursor === null` is the end signal, not a short page. The two agree
     * today; only one of them is a promise.
     */
    expect(screen.queryByRole("button", { name: /رویدادهای قدیمی‌تر/ })).toBeNull();
    expect(screen.getByText(/به ابتدای سوابق رسیدید/)).toBeTruthy();
  });
});

describe("an entry this build does not understand", () => {
  it("renders an unknown source instead of dropping it", async () => {
    audit.mockResolvedValue(
      page([row("e01", TIE, TIE_FULL, { source: "vendor_action" as AuditEntry["source"] }).entry]),
    );
    render(<AuditLogs />);

    expect(await screen.findByText(/نوع ناشناخته/)).toBeTruthy();
    // the raw value survives to the screen — a reader can act on a code
    expect(screen.getByText("vendor_action")).toBeTruthy();
    // and the entry itself is still there, which is the point
    expect(screen.getByText("e01")).toBeTruthy();
  });

  it("does NOT mark a known source as unknown", async () => {
    /*
     * The negative control. "The unknown chip appears for an unknown source"
     * cannot distinguish a working check from one that marks everything —
     * only a case that should come back NO can.
     */
    audit.mockResolvedValue(page([row("e01", TIE, TIE_FULL).entry]));
    render(<AuditLogs />);
    await screen.findByText("e01");
    expect(screen.queryByText(/نوع ناشناخته/)).toBeNull();
  });
});

describe("detail is rendered as codes, and absence is told apart from zero", () => {
  it("keeps a zero and drops a null", async () => {
    audit.mockResolvedValue(
      page([
        row("e01", TIE, TIE_FULL, {
          source: "agent_run", action: "ok", target_type: "agent_run",
          detail: { kind: "e01", tokens_out: 0, error: null },
        }).entry,
      ]),
    );
    render(<AuditLogs />);
    await screen.findByText("e01");

    // ۰ in Persian digits — a measured zero is a fact and stays on screen
    expect(screen.getByText("۰")).toBeTruthy();
    // a null `error` is the ABSENCE of an error, not a detail worth a row
    expect(screen.queryByText(/^خطا$/)).toBeNull();
  });

  it("shows a detail key it does not recognise rather than hiding it", async () => {
    audit.mockResolvedValue(
      page([row("e01", TIE, TIE_FULL, { detail: { kind: "e01", vendor_ref: "vr-7" } }).entry]),
    );
    render(<AuditLogs />);
    await screen.findByText("e01");
    expect(screen.getByText("vendor_ref")).toBeTruthy();
    expect(screen.getByText("vr-7")).toBeTruthy();
  });
});

describe("who acted", () => {
  it("shows the name the server resolved, without looking anyone up", async () => {
    audit.mockResolvedValue(page([row("e01", TIE, TIE_FULL).entry]));
    render(<AuditLogs />);
    expect(await screen.findByText("مدیر سازمان")).toBeTruthy();
  });

  it("says the account was removed when the server resolved no name", async () => {
    audit.mockResolvedValue(page([row("e01", TIE, TIE_FULL, { actor_name: null }).entry]));
    render(<AuditLogs />);
    await screen.findByText("e01");
    /*
     * `null` here is core/'s statement that the actor was tombstoned — not a
     * failed join, and not a blank. The id stays visible because it is what
     * still ties the record together.
     */
    expect(screen.getByText(/حساب برداشته‌شده/)).toBeTruthy();
    expect(screen.getByText(ADMIN_ID.slice(0, 8))).toBeTruthy();
  });
});

/**
 * **The producer's own body, transcribed verbatim** (rule 10: one fixture,
 * generated by the producing side, asserted by the consuming side).
 *
 * Everything above this point is my belief about the wire expressed as a
 * fixture I wrote — which is exactly the closed loop that let four invented
 * `CallStatus` values render perfectly for weeks. This block is a real capture
 * from B1's live database, pasted unedited, and it carries three things I
 * would not have invented:
 *
 *   1. An in-flight run: `action: "running"` with `finished_at`, `tokens_in`,
 *      `tokens_out` and `target_id` ALL null. A renderer written only against
 *      finished runs meets this row in production, not in a test.
 *   2. `finished_at` in MICROSECOND ISO with a `+00:00` offset
 *      (`…52.062643+00:00`), not the millisecond `Z` form every hand-written
 *      fixture in this file uses. It goes through `formatDate`/`formatTime`,
 *      so "Invalid Date" is a real possible output.
 *   3. A `next_cursor.at` in POSTGRES text form — `2026-08-13 10:00:00.341567+00`,
 *      with a space and no `Z`. `new Date()` of that is implementation-defined
 *      at best. It must survive untouched.
 *
 * Live source counts when captured: proposal_decision 4, agent_run 11,
 * admin_action 0 — see the note in the `admin_action` test below.
 */
const CAPTURED = {
  entries: [
    {
      source: "proposal_decision",
      id: "760231b7-a27a-4430-a3c2-eaab7081813c",
      at: "2026-08-13T11:08:53.442Z",
      actor_id: "0d000000-0000-4000-8000-000000000002",
      actor_name: "عضو توسعه",
      action: "approve",
      target_type: "proposal",
      target_id: "635c6be3-6a16-4c09-948d-557472424167",
      detail: { kind: "correct_transcript", run_id: "7308f777-b016-4325-9a7a-3c9f9a28bae9" },
    },
    {
      source: "agent_run",
      id: "7308f777-b016-4325-9a7a-3c9f9a28bae9",
      at: "2026-08-13T11:08:39.902Z",
      actor_id: "0d000000-0000-4000-8000-000000000002",
      actor_name: "عضو توسعه",
      action: "ok",
      target_type: "agent_run",
      target_id: "635c6be3-6a16-4c09-948d-557472424167",
      detail: {
        kind: "assistant", error: null, model: "google/gemini-3.6-flash", skill_id: null,
        tokens_in: 6335, tokens_out: 853, finished_at: "2026-08-13T11:08:52.062643+00:00",
      },
    },
    {
      source: "agent_run",
      id: "5251c3a0-1cee-4b6f-9fdc-c4d5242973ad",
      at: "2026-08-13T11:08:33.341Z",
      actor_id: "0d000000-0000-4000-8000-000000000002",
      actor_name: "عضو توسعه",
      action: "running",
      target_type: "agent_run",
      target_id: null,
      detail: {
        kind: "assistant", error: null, model: "google/gemini-3.6-flash", skill_id: null,
        tokens_in: null, tokens_out: null, finished_at: null,
      },
    },
  ],
  // full-precision Postgres text, deliberately NOT equal to any entry's `at`
  next_cursor: {
    at: "2026-08-13 11:08:33.341567+00",
    source: "agent_run",
    id: "5251c3a0-1cee-4b6f-9fdc-c4d5242973ad",
  },
} as unknown as AuditPage;

describe("the producer's real captured body", () => {
  it("renders every entry, including the in-flight run", async () => {
    audit.mockResolvedValue(CAPTURED);
    render(<AuditLogs />);

    await screen.findByText("correct_transcript");
    expect(screen.getAllByRole("row")).toHaveLength(4); // 3 entries + header
    // the two closed vocabularies, translated from their own source's set
    expect(screen.getByText("تأیید شد")).toBeTruthy();   // proposal_decision → approve
    expect(screen.getByText("انجام شد")).toBeTruthy();   // agent_run → ok
    expect(screen.getByText("در حال اجرا")).toBeTruthy(); // agent_run → running
    expect(screen.getAllByText("عضو توسعه")).toHaveLength(3);
  });

  it("shows nothing for the in-flight run's unmeasured fields, and a real date for the finished one", async () => {
    audit.mockResolvedValue(CAPTURED);
    render(<AuditLogs />);
    await screen.findByText("correct_transcript");

    /*
     * The finished run reports 6335 tokens; the running one reports null and
     * must render NO token row at all. A zero would be a fabricated
     * measurement — the same rule as the server surface's "—" never "0", met
     * here first because this fixture is real.
     */
    // `digits()` substitutes glyphs and does not group thousands — no
    // separator, app-wide. Written after the real fixture disagreed with me.
    expect(screen.getByText("۶۳۳۵")).toBeTruthy();
    expect(screen.getAllByText(/توکن ورودی/)).toHaveLength(1);
    expect(screen.getAllByText(/پایان/)).toHaveLength(1);

    // and the µs-with-offset timestamp is a DATE, not "Invalid Date"
    const finished = screen.getByText(/پایان/).closest("li")!;
    expect(finished.textContent).not.toMatch(/Invalid/);
    expect(finished.textContent).toMatch(/۱۴۰۵|۲۰۲۶/); // Jalali or Gregorian year, per locale
  });

  it("hands back the Postgres-text cursor without touching it", async () => {
    /*
     * `2026-08-13 11:08:33.341567+00` — a space, no `T`, no `Z`, microseconds.
     * Anything that round-trips this through a JS `Date` truncates it to
     * milliseconds and silently re-opens the page-boundary skip; anything that
     * "normalises" it produces a 400. Verbatim is the whole contract.
     */
    audit.mockResolvedValue(CAPTURED);
    render(<AuditLogs />);
    await screen.findByText("correct_transcript");

    await userEvent.click(screen.getByRole("button", { name: /رویدادهای قدیمی‌تر/ }));
    await waitFor(() => expect(audit).toHaveBeenCalledTimes(2));
    const sent = audit.mock.calls[1]![0] as { cursor: AuditCursor };
    expect(sent.cursor).toEqual(CAPTURED.next_cursor);
  });
});

/**
 * **The second real capture — and it contains a genuine tie.**
 *
 * B1 ran two actual admin mutations through the repos, read the feed back, and
 * rolled the transaction back so dev keeps no residue. Both rows carry
 * `2026-08-13T13:06:32.897Z`, **identical to the millisecond**, because they
 * were written in one transaction and `now()` is transaction time.
 *
 * That is the case I argued was guaranteed rather than theoretical, and it
 * turned up unprompted in the first capture that could contain it — which is
 * better evidence than the synthetic tie above, because nobody arranged it.
 *
 * These rows also close the last hand-derived third of the feed: until the
 * writers landed there were no `admin_action` rows anywhere, so the shape was
 * derived from SQL and its free-text `action`/`target_type` fallbacks were
 * exercised only by values I invented.
 */
const CAPTURED_ADMIN = [
  {
    source: "admin_action",
    id: "74a3ccd4-6824-4653-8861-adce61cc02b3",
    at: "2026-08-13T13:06:32.897Z",
    actor_id: "0d000000-0000-4000-8000-000000000001",
    actor_name: "مدیر توسعه",
    action: "org_updated",
    target_type: "org",
    target_id: "0d000000-0000-4000-8000-00000000000d",
    detail: { fields: ["locale", "name"] },
  },
  {
    source: "admin_action",
    id: "53459ddc-89d2-4ec8-9ad8-54c1bcb6524a",
    at: "2026-08-13T13:06:32.897Z",
    actor_id: "0d000000-0000-4000-8000-000000000001",
    actor_name: "مدیر توسعه",
    action: "member_role_changed",
    target_type: "member",
    target_id: "0d000000-0000-4000-8000-000000000002",
    detail: { role: "member" },
  },
] as unknown as AuditEntry[];

describe("real admin_action rows", () => {
  it("renders free-text action codes literally instead of mapping them to a label", async () => {
    audit.mockResolvedValue(page(CAPTURED_ADMIN));
    render(<AuditLogs />);

    /*
     * `action` on `admin_action` is free text by design — a new admin
     * operation must be able to name itself without a migration — so the
     * closed set lives in core/ and can gain a member at any time. A
     * client-side label map would silently fall behind and, worse, would map
     * an unrecognised code onto whichever nearby label happens to exist.
     * Translating ONLY the two closed vocabularies is what makes these render
     * as what they are: codes.
     */
    expect(await screen.findByText("org_updated")).toBeTruthy();
    expect(screen.getByText("member_role_changed")).toBeTruthy();
  });

  it("shows an unrecognised detail key under its own name", async () => {
    audit.mockResolvedValue(page(CAPTURED_ADMIN));
    render(<AuditLogs />);
    /*
     * `detail`'s keys legitimately differ per action — `{fields: […]}` for an
     * org update, `{role: …}` for a role change — so there is no closed set to
     * translate. Field NAMES only: an audit reader learns the org was renamed
     * and never what to.
     */
    expect(await screen.findByText("fields")).toBeTruthy();
    expect(screen.getByText('["locale","name"]')).toBeTruthy();
    expect(screen.getByText("role")).toBeTruthy();
  });

  it("resolves the actor the same way on an admin row", async () => {
    audit.mockResolvedValue(page(CAPTURED_ADMIN));
    render(<AuditLogs />);
    // same join, same null-means-tombstoned semantics as the other two sources
    expect(await screen.findAllByText("مدیر توسعه")).toHaveLength(2);
  });

  it("keeps BOTH rows when paging splits a real one-transaction tie", async () => {
    /*
     * **The strongest paging test in this file, because the tie is real.**
     *
     * Two rows, one instant, `limit: 1` — the page boundary lands exactly
     * inside the tie. A cursor comparing `at` alone finds no row strictly
     * older than the first, returns nothing, and the second admin action is
     * gone from the record with nothing on screen to say so. Only comparing
     * `(at, source, id)` row-wise reaches it.
     */
    const rows: Row[] = CAPTURED_ADMIN.map((entry) => ({
      entry,
      // identical to the microsecond: one transaction, one `now()`
      atFull: "2026-08-13T13:06:32.897000Z",
    }));
    audit.mockImplementation(fakeServer(rows, 1));
    render(<AuditLogs />);

    await screen.findByText("org_updated");
    expect(screen.queryByText("member_role_changed")).toBeNull(); // limit 1 truly split them

    await userEvent.click(screen.getByRole("button", { name: /رویدادهای قدیمی‌تر/ }));
    expect(await screen.findByText("member_role_changed")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3); // both entries + header
  });
});

describe("when the feed cannot be read", () => {
  it("says so and shows no rows at all", async () => {
    audit
      .mockResolvedValueOnce(page([row("e01", TIE, TIE_FULL).entry]))
      .mockRejectedValueOnce(new Error("nope"));
    render(<AuditLogs />);
    await screen.findByText("e01");

    // change the filter to trigger the failing reload
    await userEvent.selectOptions(screen.getByRole("combobox"), "agent_run");

    expect(await screen.findByText(/خواندن سوابق ممکن نشد/)).toBeTruthy();
    /*
     * The previous page is cleared rather than left under a banner. Stale rows
     * beneath an error read as the current record — and "these are the events"
     * is the entire claim this surface makes.
     */
    expect(screen.queryByText("e01")).toBeNull();
  });
});

/**
 * **The deletion arm — the fourth source, and the one nothing pointed at.**
 *
 * The shape is transcribed from the producer rather than imagined. core/'s
 * `DELETION_FEED_ARM` (core/src/api/audit.ts) selects, in order:
 *
 *   'deletion', d.id, d.created_at, d.actor_id, **d.kind**, 'deletion',
 *   d.target_id, jsonb_build_object('reason', d.reason)
 *
 * — so `action` is the ledger's `kind` and `detail` has exactly one key. And
 * db/0085 closes that kind at the column:
 * `check (kind in ('call', 'person', 'member'))`, with
 * `reason text not null check (length(btrim(reason)) between 3 and 500)`.
 *
 * Both facts matter to this screen and neither was honoured. `kind` is a
 * CLOSED vocabulary, so it belongs in the translate-what-we-know map — it
 * was absent, and every deletion rendered the bare word `call` while
 * `audit.action.call` sat authored in both locales. And `reason` is the one
 * value on this page a PERSON wrote — 3 to 500 characters of, in a
 * Persian-first product, Persian — while every detail value on the screen
 * was being forced left-to-right into a monospace face.
 */
const DELETED_REASON = "درخواست خود مشتری برای پاک شدن جلسه‌های قدیمی";

const CAPTURED_DELETION: AuditEntry = {
  source: "deletion",
  id: "b1f2b0e2-7c4e-4f22-9d3a-0e6d5a4c1188",
  at: "2026-08-29T09:41:11.204Z",
  actor_id: ADMIN_ID,
  actor_name: "مدیر سازمان",
  action: "call",
  target_type: "deletion",
  target_id: "3f9a6c11-2b77-4a0e-8c55-9d1e2f3a4b5c",
  detail: { reason: DELETED_REASON },
} as unknown as AuditEntry;

describe("a deletion row", () => {
  it("reads its kind as the translated word, not as a code", async () => {
    audit.mockResolvedValue(page([CAPTURED_DELETION]));
    render(<AuditLogs />);

    /*
     * **The discriminating assertion for the whole fix.** «حذف رکورد» is
     * `audit.action.call`, and it can only render if `deletion` is in the
     * translatable map — which it was not. The second half matters as much:
     * the raw `call` must be GONE, or a screen that rendered both would pass
     * the first line while still showing the code.
     */
    expect(await screen.findByText("حذف رکورد")).toBeTruthy();
    expect(screen.queryByText("call")).toBeNull();
  });

  it("labels the reason instead of showing the key", async () => {
    audit.mockResolvedValue(page([CAPTURED_DELETION]));
    render(<AuditLogs />);
    await screen.findByText("حذف رکورد");

    expect(screen.getByText(/^دلیل$/)).toBeTruthy();   // audit.detail.reason
    expect(screen.queryByText("reason")).toBeNull();
  });

  it("lets the person's own sentence pick its own direction", async () => {
    audit.mockResolvedValue(page([CAPTURED_DELETION]));
    render(<AuditLogs />);

    /*
     * `dir="auto"` is the whole visible half of this in jsdom: the value
     * declares a direction derived from its CONTENT, which the code branch
     * never does (it is isolated left-to-right by the shared `.ltr`
     * utility). The other half — that it is no longer in a monospace face —
     * is a computed style, and jsdom computes none; the decision behind it
     * is asserted directly further down instead of through a class name.
     */
    const reason = await screen.findByText(DELETED_REASON);
    expect(reason.getAttribute("dir")).toBe("auto");
  });

  it("still dresses an identifier as an identifier — the control", async () => {
    /*
     * Without this, "the reason is not forced LTR" cannot tell the rule from
     * a change that simply stopped forcing anything. A uuid must still take
     * the code branch, and the code branch never carries a `dir` of its own.
     */
    audit.mockResolvedValue(CAPTURED);
    render(<AuditLogs />);
    const runId = await screen.findByText("7308f777-b016-4325-9a7a-3c9f9a28bae9");
    expect(runId.getAttribute("dir")).toBeNull();
  });

  it("does NOT translate a deletion kind this build has never heard of", async () => {
    /*
     * The negative control on the map itself. `kind` is closed at the column
     * TODAY; a deployment ahead of this bundle can widen it, and the answer
     * must be the code — never the nearest label that happens to exist. This
     * is the same rule the unknown-source test guards one column over.
     */
    audit.mockResolvedValue(
      page([{ ...CAPTURED_DELETION, action: "workflow" } as AuditEntry]),
    );
    render(<AuditLogs />);
    expect(await screen.findByText("workflow")).toBeTruthy();
    expect(screen.queryByText("حذف رکورد")).toBeNull();
    expect(screen.queryByText("حذف عضو")).toBeNull();
  });
});

describe("the value/code decision itself", () => {
  /*
   * Asserted directly, because the property it drives — a monospace face —
   * is a computed style and this runtime computes none. A render test can
   * see the direction and never the font, so the rule is pinned where it is
   * actually decided.
   */
  it("calls a person's sentence text, and everything opaque a code", () => {
    expect(auditDetailValue("reason", DELETED_REASON, "fa").code).toBe(false);
    expect(auditDetailValue("run_id", "7308f777-b016-4325-9a7a-3c9f9a28bae9", "fa").code).toBe(true);
    expect(auditDetailValue("model", "google/gemini-3.6-flash", "fa").code).toBe(true);
    expect(auditDetailValue("error", "upstream refused", "fa").code).toBe(true);
  });

  it("hands back what it FORMATTED in the reader's own dress", () => {
    /*
     * A date through `formatDate` already carries the reader's calendar and
     * digits; a count through `digits()` already carries the digits. Marking
     * either a code puts it in a Latin monospace stack forced left-to-right
     * — undoing, one line later, exactly the work the formatter just did.
     */
    const date = auditDetailValue("finished_at", "2026-08-13T11:08:52.062643+00:00", "fa");
    expect(date.code).toBe(false);
    expect(date.text).not.toMatch(/Invalid/);

    const count = auditDetailValue("tokens_in", 6335, "fa");
    expect(count.code).toBe(false);
    expect(count.text).toBe("۶۳۳۵");
  });

  it("treats a key it does not know as a code", () => {
    /*
     * The safe default, and the direction it errs in is deliberate:
     * rendering an unknown CODE in the document's direction can visually
     * reorder it into a different string, while rendering unknown prose
     * left-to-right merely looks wrong.
     */
    expect(auditDetailValue("vendor_ref", "vr-7", "fa").code).toBe(true);
    expect(auditDetailValue("fields", ["locale", "name"], "fa"))
      .toEqual({ text: '["locale","name"]', code: true });
  });
});
