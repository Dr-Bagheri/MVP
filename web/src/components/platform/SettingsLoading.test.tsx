import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditPage, Org, User } from "@/api/types";

/**
 * THE FRAME BEFORE THE DATA — the four Settings/Management surfaces of this
 * pass (user directive, 2026-09-03: "the skeleton should apply for all sub
 * pages in management and settings as well").
 *
 * **Every case here HOLDS THE FETCH OPEN**, and that is the whole design of
 * the file rather than a flourish. The state under test exists only while a
 * request is in flight, so an assertion made after `await findBy…` is an
 * assertion about the ANSWERED page — and it passes identically against a
 * component that rendered nothing at all for the second before it, which is
 * the defect. The temporal vacuum: a condition that also holds in a state you
 * did not mean is satisfied there and stops looking.
 *
 * So each case pauses the promise, measures, then resolves it and measures
 * again. **The second half is the control**: "claims nothing while loading" is
 * also true of a component that never claims anything, and only the resolved
 * assertion can tell those apart.
 *
 * WHICH OF THESE WERE SEEN RED, stated exactly, because "verified red" is a
 * claim about specific lines and rounding it up is how the phrase stops
 * meaning anything. Four were, each against the version of its component that
 * shipped this morning, and each failure named the right defect:
 *   · the org panel — «نام سازمان» never appeared (`if (!org) return null`);
 *   · the org failure sentence — never appeared (no `.catch` existed at all);
 *   · sign-in methods — "Found multiple elements with the text: فعال", the
 *     `?? true` default painting BOTH providers before anyone had asked;
 *   · the audit feed — "Unable to find role=table" while loading.
 * The remaining two — the sessions none-recorded control and the sessions
 * table's frame — PASSED against the old code and are pins, not proofs:
 * `loading` on DataTable was already wired there, and what was wrong on that
 * screen was only what a FAILED read said.
 */

/** A promise somebody else decides when to settle. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ORG: Org = {
  id: "0d000000-0000-4000-8000-00000000000d",
  name: "شرکت نمونه",
  status: "active",
  locale: "fa",
  allowed_models: [],
  created_at: "2026-01-01T00:00:00.000Z",
};

const admin: User = {
  id: "u-1", org_id: ORG.id, username: "admin", email: "admin@example.test",
  display_name: "مدیر سازمان", avatar_url: null, role: "admin", status: "active",
  locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
};

const me = vi.fn();
const org = vi.fn();
const authMethods = vi.fn();
const audit = vi.fn();
const mySessions = vi.fn();
const orgSessions = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    org: () => org(),
    updateOrg: vi.fn(),
    orgLogoUrl: () => "/org-logo.png",
    uploadOrgLogo: vi.fn(),
    clearOrgLogo: vi.fn(),
    authMethods: () => authMethods(),
    setAuthMethod: vi.fn(),
    audit: (query?: unknown) => audit(query),
    mySessions: () => mySessions(),
    orgSessions: () => orgSessions(),
    endMySession: vi.fn(),
    endMemberSession: vi.fn(),
  },
  BffError: class extends Error {},
}));
vi.mock("@/lib/notify", () => ({ notify: () => {} }));
vi.mock("@/lib/signOut", () => ({ signOutThisDevice: async () => {} }));

const { OrgFields } = await import("./OrgFields");
const { SignInMethods } = await import("./SignInMethods");
const { AuditLogs } = await import("./AuditLogs");
const { SecuritySettings } = await import("./SecuritySettings");

beforeEach(() => {
  me.mockReset();
  org.mockReset();
  authMethods.mockReset();
  audit.mockReset();
  mySessions.mockReset();
  orgSessions.mockReset();
  me.mockResolvedValue(admin);
});
afterEach(cleanup);

describe("Management · General — the org form", () => {
  it("draws the panel's rows while the org row is still on the wire", async () => {
    const row = deferred<Org>();
    org.mockReturnValue(row.promise);
    render(<OrgFields />);

    /*
     * The labels come from the message catalogue and never depended on the
     * network, so they are the frame. Before this pass the component was
     * `if (!org) return null` — the heading above it rendered, then a gap,
     * then a seven-row panel dropped in.
     */
    expect(await screen.findByText("نام سازمان")).toBeTruthy();
    expect(screen.getByText("نشان سازمان")).toBeTruthy();
    /* and it is a PLACEHOLDER, not a form: nothing to type into and nothing
       to press, because there is no value yet to edit or to save */
    expect(screen.queryByRole("textbox")).toBeNull();

    /* the control — the same frame, now holding the row it reserved space
       for. Without it, "no textbox while loading" would also describe a
       component that never renders a form at all. */
    await act(async () => { row.resolve(ORG); });
    expect(await screen.findByDisplayValue("شرکت نمونه")).toBeTruthy();
    expect(screen.getByText("نام سازمان")).toBeTruthy();
  });

  it("says the org could not be read rather than waiting for ever", async () => {
    /*
     * `api.org()` carried no `.catch` at all, so a failed read left the
     * component on `if (!org) return null` permanently: no form, no sentence,
     * nothing to retry — the loading defect's own far end. A failure is an
     * answer, and it gets said.
     */
    org.mockRejectedValue(new Error("nope"));
    render(<OrgFields />);

    expect(await screen.findByText("تنظیمات سازمان خوانده نشد.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("Settings · Sign-in methods", () => {
  it("claims neither Active nor Off before the methods read answers", async () => {
    const methods = deferred<{ provider: string; enabled: boolean }[]>();
    authMethods.mockReturnValue(methods.promise);
    render(<SignInMethods />);

    /* the rows are structure — two providers, named from the catalogue */
    expect(await screen.findByText("Google")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    /*
     * **The discriminating pair.** Each row read its state as
     * `row?.enabled ?? true`, so both providers were painted «فعال» before
     * anyone had asked the server — a default wearing an answer's costume. A
     * provider that was off read as on until the fetch landed, and a switch
     * pressed in that window sends the opposite of what the person read.
     */
    /* `queryAllBy…`, because the claim is "none of them": `queryByText`
       THROWS on more than one match, which is a red for the right reason by
       accident rather than by design — and the shipped version matched twice */
    expect(screen.queryAllByText("فعال")).toHaveLength(0);
    expect(screen.queryAllByText("خاموش")).toHaveLength(0);

    /* the control: once the server answers, the row says what the SERVER
       said — including the state the old default could never show */
    await act(async () => {
      methods.resolve([
        { provider: "google", enabled: false },
        { provider: "github", enabled: true },
      ]);
    });
    expect(await screen.findByText("خاموش")).toBeTruthy();
    expect(screen.getByText("فعال")).toBeTruthy();
  });
});

describe("Settings · Audit logs", () => {
  it("renders the table's own frame while the feed is in flight", async () => {
    const feed = deferred<AuditPage>();
    audit.mockReturnValue(feed.promise);
    render(<AuditLogs />);

    /*
     * The header row, the column widths and the borders are structure. The
     * placeholder used to be a hand-rolled Card of six four-bar rows standing
     * in for an unboxed five-column table, so the page moved twice: once when
     * the placeholder appeared and again when a differently-shaped table
     * replaced it.
     */
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByText("کنشگر")).toBeTruthy();
    /*
     * And it says nothing about the record while nobody has looked. Both of
     * these are ANSWERS — one that this organization has never done anything,
     * one that the server has nothing older — and neither is ours to make yet.
     */
    expect(screen.queryByText("هنوز رویدادی ثبت نشده است.")).toBeNull();
    expect(screen.queryByText("به ابتدای سوابق رسیدید.")).toBeNull();

    /* the control: the empty sentence is not simply gone — it arrives the
       moment the answer says so */
    await act(async () => { feed.resolve({ entries: [], next_cursor: null }); });
    expect(await screen.findByText("هنوز رویدادی ثبت نشده است.")).toBeTruthy();
  });
});

describe("Settings · Security — this person's own devices", () => {
  /* the org-wide read is refused for a member (db/0135), which is what puts
     the caller's own devices on screen */
  beforeEach(() => { orgSessions.mockRejectedValue(new Error("forbidden")); });

  it("tells a failed read apart from having no sessions", async () => {
    /*
     * `.catch(() => setSessions([]))` rendered «نشستی ثبت نشده است» — a
     * sentence that cannot be true, since the person reading it is signed in
     * on the device they are reading it on.
     */
    mySessions.mockRejectedValue(new Error("offline"));
    render(<SecuritySettings />);

    expect(await screen.findByText("نشست‌های شما خوانده نشد.")).toBeTruthy();
    expect(screen.queryByText("نشستی ثبت نشده است.")).toBeNull();
  });

  it("still says none-recorded when the read succeeds and there are none", async () => {
    /* the control on the sentence itself: it did not simply disappear */
    mySessions.mockResolvedValue({ sessions: [], current: null });
    render(<SecuritySettings />);

    expect(await screen.findByText("نشستی ثبت نشده است.")).toBeTruthy();
    expect(screen.queryByText("نشست‌های شما خوانده نشد.")).toBeNull();
  });

  it("holds the table's frame while the sessions are still on the wire", async () => {
    const own = deferred<{ sessions: never[]; current: null }>();
    mySessions.mockReturnValue(own.promise);
    render(<SecuritySettings />);

    /* neither answer yet, and neither sentence — the table stands with
       skeleton rows in it */
    expect(await screen.findByText("نشست‌های فعال")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByText("نشستی ثبت نشده است.")).toBeNull();
    expect(screen.queryByText("نشست‌های شما خوانده نشد.")).toBeNull();

    await act(async () => { own.resolve({ sessions: [], current: null }); });
    expect(await screen.findByText("نشستی ثبت نشده است.")).toBeTruthy();
  });
});
