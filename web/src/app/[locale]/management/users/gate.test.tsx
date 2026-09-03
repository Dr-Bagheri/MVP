import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/api/types";

/**
 * The Management·Users role gate, verified **by making it fire**.
 *
 * This exists because the branch is otherwise unreachable: the Phase-A fixture
 * `me` is an admin, so the refusal panel could never render and would ship
 * having never been seen. Flipping the fixture by hand proves it once and
 * proves nothing tomorrow; a test proves it on every run.
 *
 * **The assertion that matters is the negative one.** "The panel appears" only
 * shows the gate drew something. "No privileged control rendered" is the claim
 * worth making, because it is the one that fails if a future edit moves a
 * button above the early return — which is exactly how a control leaks.
 *
 * `ManagementPane` is stubbed: it brings the shell (which fetches identity of
 * its own and renders the rail) and the section menu, and neither is under test
 * here. Stubbing it also keeps the assertions honest — a "Settings" link in the
 * rail would otherwise satisfy a naive "no admin controls" query, and the
 * section menu beside the content makes that MORE true, not less: it renders a
 * link to every Management surface on the very screen asserting that a member
 * sees no privileged control.
 */
vi.mock("@/components/platform/ManagementPane", () => ({
  ManagementPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const member: User = {
  id: "u-9", org_id: "o-1", username: "member", display_name: "عضو ساده",
  email: "member@example.test",
  avatar_url: null, role: "member", status: "active", locale: "fa",
  model_id: null, created_at: new Date().toISOString(),
};
const admin: User = { ...member, id: "u-1", role: "admin", display_name: "مدیر" };

const me = vi.fn();
const members = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    invitations: async () => [],
    members: () => members(),
    setUserStatus: vi.fn(),
    setUserRole: vi.fn(),
    // the tiles read stats, not rows — an unmocked call throws and the failure
    // surfaces as "table never rendered", which reads as a gate bug
    memberStats: async () => ({
      counts: { pending: 0, active: 2, disabled: 0, total: 2 },
      trend: { window_days: 30, activated: 0, disabled: 0, joined: 0, history_since: null },
    }),
  },
}));

const { default: UsersPage } = await import("./page");

describe("Management · Users role gate", () => {
  beforeEach(() => {
    me.mockReset();
    members.mockReset();
    members.mockResolvedValue([admin, member]);
  });

  it("shows the refusal to a member — and renders NO privileged control", async () => {
    me.mockResolvedValue(member);
    render(<UsersPage />);

    await screen.findByText(/این بخش در اختیار مدیر سازمان است/);

    // the assertion that actually guards a leak
    expect(screen.queryByRole("combobox")).toBeNull();          // role dropdown
    expect(screen.queryByRole("table")).toBeNull();             // member table
    expect(screen.queryByRole("textbox")).toBeNull();           // member search
    expect(screen.queryByRole("button", { name: /تأیید|رد/ })).toBeNull(); // accept/reject
  });

  it("does not request the member list at all when refused", async () => {
    me.mockResolvedValue(member);
    render(<UsersPage />);
    await screen.findByText(/این بخش در اختیار مدیر سازمان است/);
    /*
     * Not a performance point. A member who saw an EMPTY member list would read
     * it as "this organization has no people" — a claim about the org built out
     * of a fact about their own permissions. Asking for nothing is what makes
     * that misreading impossible.
     */
    expect(members).not.toHaveBeenCalled();
  });

  it("renders the surface for an admin — proving the gate is not simply always closed", async () => {
    me.mockResolvedValue(admin);
    render(<UsersPage />);
    await waitFor(() => expect(members).toHaveBeenCalled());
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.queryByText(/این بخش در اختیار مدیر سازمان است/)).toBeNull();
  });
});

describe("Management · Users — loading is not empty", () => {
  beforeEach(() => {
    me.mockReset();
    members.mockReset();
  });

  /*
   * audit finding, 2026-09-02: `rows` starts as [] and the table was gated on
   * `listed.length === 0`, so for the whole time the members request was in
   * flight the page said «عضوی با این نام پیدا نشد» — an empty state wearing
   * loading's clothes — and then a table dropped in under it. The fetch is
   * held OPEN here on purpose (the temporal-vacuum trap: an assertion that
   * also holds in a state you did not mean passes there and stops looking),
   * so the in-flight state is the one being measured; the empty sentence is
   * asserted only after an empty answer has actually arrived. Against the
   * old ternary the first assertion fails — that is the red this test owes.
   */
  it("draws the table's skeleton frame while the list is in flight, and the empty sentence only after an empty answer", async () => {
    let answer!: (rows: User[]) => void;
    members.mockReturnValue(new Promise<User[]>((resolve) => { answer = resolve; }));
    me.mockResolvedValue(admin);
    render(<UsersPage />);

    // anchored on the request being OPEN — never on a duration
    await waitFor(() => expect(members).toHaveBeenCalled());
    expect(screen.queryByText("هنوز عضوی در این سازمان نیست.")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();

    /* the sentence changed on 2026-09-03: `noMatches` («عضوی با این نام پیدا
       نشد») named a SEARCH this screen has not had since 2026-08-26, so an
       org whose members were all pending read as a failed lookup. A refused
       read now has a sentence of its own too — see the failure case below. */
    answer([]);
    await screen.findByText("هنوز عضوی در این سازمان نیست.");
    // the frame yields to the sentence: a table under "nobody matches" is two answers
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says the read FAILED rather than that the organization is empty", async () => {
    /*
     * THE THIRD NOTHING (2026-09-03). `load()` had a `finally` and no
     * `catch`, so a refused or dropped request left `rows` at [] and the
     * table told an admin their organization has nobody in it — the wrong
     * kind of nothing, and the one that cannot be acted on. It also escaped
     * every `void load()` as an unhandled rejection.
     *
     * The two sentences must be DIFFERENT, which is the whole assertion:
     * against the old code the empty sentence renders here too, so a test
     * that only checked "some sentence appears" would pass against the bug.
     */
    members.mockRejectedValue(new Error("refused"));
    me.mockResolvedValue(admin);
    render(<UsersPage />);

    await screen.findByText("فهرست اعضا بارگیری نشد — دوباره تلاش کنید.");
    expect(screen.queryByText("هنوز عضوی در این سازمان نیست.")).toBeNull();
  });
});
