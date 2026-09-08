import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A SPEAKER IS AN ACCOUNT, ON THE ROW (user directive, 2026-09-08: "for each
 * speaker put the ability to be connected to each user so when we are
 * choosing the speakers in the overview it does not need me to say this
 * account is which speaker").
 *
 * `person.app_user_id` is the join that lets a meeting name a voice without
 * asking anybody anything — and it used to live in a dialog behind the row's
 * ⋯ menu, which is why not one of this deployment's rows had it set. These
 * tests hold the two halves that make it useful: it is EDITABLE where the
 * table is read, and a member SEES it without being offered a control the
 * server would refuse.
 */

const directory = vi.fn();
const members = vi.fn();
const updatePerson = vi.fn();
const me = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    directory: () => directory(),
    members: () => members(),
    updatePerson: (...a: unknown[]) => updatePerson(...a),
    me: () => me(),
  },
}));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/lib/refreshBus", () => ({ useRefreshEpoch: () => 0 }));
vi.mock("next-intl", () => ({
  useLocale: () => "fa",
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    (vals ? `${key}:${Object.values(vals).join(",")}` : key),
}));

const { SpeakersDirectory } = await import("./SpeakersDirectory");

/* one person the platform has learned, one it has not — the production mix */
const PEOPLE = [
  {
    id: "p-sina", display_name: "سینا سپاسی", title: "", team: null,
    app_user_id: "u-sina", linked_member_name: "Sina Sep",
    suggested_app_user_id: null, suggested_member_name: null,
  },
  {
    id: "p-amir", display_name: "امیررضا باقری", title: "", team: null,
    app_user_id: null, linked_member_name: null,
    suggested_app_user_id: "u-amir", suggested_member_name: "امیررضا باقری",
  },
];

const MEMBERS = [
  { id: "u-sina", display_name: "Sina Sep", display_name_en: null, username: "sina", email: "s@x.io", role: "member", status: "active" },
  { id: "u-amir", display_name: "امیررضا باقری", display_name_en: null, username: null, email: "a@x.io", role: "owner", status: "active" },
];

beforeEach(() => {
  directory.mockReset(); directory.mockResolvedValue(PEOPLE);
  members.mockReset(); members.mockResolvedValue(MEMBERS);
  updatePerson.mockReset(); updatePerson.mockResolvedValue(undefined);
  me.mockReset(); me.mockResolvedValue({ role: "owner" });
});
afterEach(cleanup);

/** the row's account control, one per person */
const accountPickers = () => screen.findAllByRole("button", { name: /colMember/ });

describe("the account a speaker is", () => {
  it("says who each person is on the platform, from the row", async () => {
    render(<SpeakersDirectory />);
    const pickers = await accountPickers();
    expect(pickers).toHaveLength(2);
    /* the linked one reads the colleague's name; the unlinked one says which
       nothing it is, rather than showing a blank cell */
    expect(pickers[0]).toHaveTextContent("Sina Sep");
    expect(pickers[1]).toHaveTextContent("identifyNobody");
  });

  it("MARKS the server's guess and does not apply it", async () => {
    /*
     * `suggested_app_user_id` is an exact fold of the two names, computed by
     * the server. A picker that pre-selected it would attach a colleague's
     * identity to a voice on a name match — and a common Persian surname is
     * exactly how that goes wrong. It is a label, and the value stays empty.
     */
    render(<SpeakersDirectory />);
    const pickers = await accountPickers();
    await userEvent.click(pickers[1]!);
    expect(await screen.findByRole("option", { name: /identifySuggested/ })).toBeInTheDocument();
    expect(pickers[1]).not.toHaveTextContent("identifySuggested");
    expect(updatePerson).not.toHaveBeenCalled();
  });

  it("writes the pairing, and writes an explicit null to undo it", async () => {
    render(<SpeakersDirectory />);
    const pickers = await accountPickers();

    await userEvent.click(pickers[1]!);
    await userEvent.click(await screen.findByRole("option", { name: /identifySuggested/ }));
    await waitFor(() => expect(updatePerson).toHaveBeenCalledWith("p-amir", { app_user_id: "u-amir" }));

    /* «عضو نیست» is an ANSWER — an omitted field would leave the old link
       standing, which is the one thing "not a member after all" must not do */
    await userEvent.click((await accountPickers())[0]!);
    await userEvent.click(await screen.findByRole("option", { name: "identifyNobody" }));
    await waitFor(() => expect(updatePerson).toHaveBeenCalledWith("p-sina", { app_user_id: null }));
  });

  it("shows a member the name and offers them no control", async () => {
    /* the server's wall is requireAdmin; a select here would be a promise
       that 403s on press, and the members list it needs is admin-only too */
    me.mockResolvedValue({ role: "member" });
    render(<SpeakersDirectory />);
    expect(await screen.findByText("Sina Sep")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /colMember/ })).toBeNull();
    expect(members).not.toHaveBeenCalled();
  });
});

describe("the ＋ that now lives in the toolbar", () => {
  it("opens the add row when the page's button says so, and only then", async () => {
    /* the button is the toolbar's (R3) and the row is the table's; the signal
       is a counter because two presses are two openings */
    const { rerender } = render(<SpeakersDirectory addSignal={0} />);
    await accountPickers();
    expect(screen.queryByPlaceholderText("namePlaceholder"), "the mount opened the row").toBeNull();

    rerender(<SpeakersDirectory addSignal={1} />);
    expect(await screen.findByPlaceholderText("namePlaceholder")).toBeInTheDocument();
  });

  it("tells the page whether this person may add anybody", async () => {
    const canAdd = vi.fn();
    render(<SpeakersDirectory onCanAdd={canAdd} />);
    await waitFor(() => expect(canAdd).toHaveBeenLastCalledWith(true));

    cleanup();
    canAdd.mockClear();
    me.mockResolvedValue({ role: "member" });
    render(<SpeakersDirectory onCanAdd={canAdd} />);
    await waitFor(() => expect(directory).toHaveBeenCalled());
    expect(canAdd).not.toHaveBeenCalledWith(true);
  });
});
