import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Org, User } from "@/api/types";

/**
 * The org form — and the assertions are about the PATCH, not the pixels.
 *
 * Every interesting failure here is silent. A form that sends a field nobody
 * edited reports success and quietly overwrites someone else's change; a form
 * that sends an unchanged value writes an audit line for an update that
 * changed nothing; a form that treats an empty input as "clear this" blanks a
 * field the first time anyone presses save without touching it. None of those
 * look wrong on screen — which is why what is asserted is the exact shape of
 * the object handed to `updateOrg`.
 */

const ORG: Org = {
  id: "0d000000-0000-4000-8000-00000000000d",
  name: "شرکت نمونه",
  status: "active",
  locale: "fa",
  allowed_models: ["google/gemini-3.6-pro"],
  created_at: "2026-01-01T00:00:00.000Z",
};

const admin: User = {
  id: "u-1", org_id: ORG.id, username: "admin", email: "admin@example.test",
  display_name: "مدیر سازمان", avatar_url: null, role: "admin", status: "active",
  locale: "fa", model_id: null, created_at: "2026-01-01T00:00:00.000Z",
};
const member: User = { ...admin, id: "u-9", role: "member", display_name: "عضو ساده" };

const me = vi.fn();
const org = vi.fn();
const updateOrg = vi.fn();
vi.mock("@/api/client", () => ({
  api: { me: () => me(), org: () => org(), updateOrg: (patch: unknown) => updateOrg(patch) },
}));

const { OrgFields } = await import("./OrgFields");

const saveButton = () => screen.getByRole("button", { name: /ذخیرهٔ تغییرات/ });

beforeEach(() => {
  me.mockReset();
  org.mockReset();
  updateOrg.mockReset();
  me.mockResolvedValue(admin);
  org.mockResolvedValue(ORG);
  updateOrg.mockImplementation(async (patch: Partial<Org>) => ({ ...ORG, ...patch }));
});

describe("the patch carries only what changed", () => {
  it("sends the edited field and NOT the untouched one", async () => {
    render(<OrgFields />);
    const input = await screen.findByDisplayValue("شرکت نمونه");

    await userEvent.clear(input);
    await userEvent.type(input, "شرکت تازه");
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateOrg).toHaveBeenCalled());
    /*
     * `toEqual` on the whole object, not `toMatchObject`: the claim is that
     * `locale` is ABSENT, and a partial match would pass with it present.
     * Sending an unchanged `locale` is how a stale page overwrites a change
     * somebody else made while this form sat open.
     */
    expect(updateOrg).toHaveBeenCalledWith({ name: "شرکت تازه" });
  });

  it("sends nothing at all when a value is typed and reverted", async () => {
    render(<OrgFields />);
    const input = await screen.findByDisplayValue("شرکت نمونه");

    await userEvent.type(input, "x");
    await userEvent.type(input, "{backspace}");

    /*
     * The property a `touched` set cannot provide. Touched-ness would mark
     * this field edited and send an identical value — a write that changes
     * nothing and still lands in the audit trail as an org update.
     */
    expect(saveButton()).toBeDisabled();
    expect(updateOrg).not.toHaveBeenCalled();
  });

  it("does not treat trailing whitespace as an edit", async () => {
    render(<OrgFields />);
    const input = await screen.findByDisplayValue("شرکت نمونه");

    await userEvent.type(input, "   ");

    /*
     * Compared in the SERVER's terms: core trims before storing, so an
     * untrimmed comparison would call this an edit and produce a save that
     * reports success while nothing moves. Same class as comparing a username
     * case-sensitively against a column that lower-cases it.
     */
    expect(saveButton()).toBeDisabled();
  });

  it("offers nothing to save on a freshly loaded form", async () => {
    render(<OrgFields />);
    await screen.findByDisplayValue("شرکت نمونه");
    // core answers an empty patch with 400 — a quiet button beats an error
    // shown to someone who changed their mind back
    expect(saveButton()).toBeDisabled();
  });

  it("re-disables after a successful save, because the baseline moved", async () => {
    render(<OrgFields />);
    const input = await screen.findByDisplayValue("شرکت نمونه");
    await userEvent.clear(input);
    await userEvent.type(input, "شرکت تازه");
    await userEvent.click(saveButton());

    expect(await screen.findByText(/ذخیره شد/)).toBeTruthy();
    /*
     * The saved row becomes the new comparison baseline. Without that, the
     * form still thinks it differs from the original and a second click sends
     * the same patch again.
     */
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(updateOrg).toHaveBeenCalledTimes(1);
  });
});

/**
 * A locale this build does not offer.
 *
 * `PATCH /v1/admin/org` validates by SHAPE — `/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/`
 * — so `fa-IR` is a legal stored value that core will accept today, through
 * its own endpoint, from any admin. The dev row happens to hold a bare `fa`
 * (B1 captured it), which is why no fixture I wrote would ever have contained
 * this case: I would have written the value that makes the bug impossible.
 *
 * The control offers `fa` and `en`. A `<select>` whose value matches no option
 * does not render that value — it shows nothing, or the first option — so the
 * screen can claim a locale the organization does not have.
 */
const WIDE_LOCALE: Org = { ...ORG, locale: "fa-IR" };

describe("a stored locale this build does not offer", () => {
  it("never rewrites it as a side effect of editing something else", async () => {
    /*
     * **B1's proposed property, and it catches the whole class regardless of
     * which control is chosen:** load, change something unrelated, save — the
     * stored locale must come through byte-identical.
     *
     * This is also the assertion that CORRECTED me. I told B1 the rename would
     * silently normalise `fa-IR` to `fa`. It does not: the comparison is
     * between the locale STATE (initialised from the loaded row) and the
     * loaded row, not between the displayed option and the stored value — so
     * an untouched locale produces no patch key at all. The difference-based
     * patch was already protecting against the data loss I predicted. What
     * remains is a display defect, which is the next test.
     */
    org.mockResolvedValue(WIDE_LOCALE);
    render(<OrgFields />);
    const input = await screen.findByDisplayValue("شرکت نمونه");

    await userEvent.clear(input);
    await userEvent.type(input, "شرکت تازه");
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateOrg).toHaveBeenCalled());
    expect(updateOrg).toHaveBeenCalledWith({ name: "شرکت تازه" });
    // said twice on purpose: absent is the claim, and a partial match would
    // pass with `locale` present
    expect(updateOrg.mock.calls[0]![0]).not.toHaveProperty("locale");
  });

  it("shows the stored value rather than a locale the org does not have", async () => {
    org.mockResolvedValue(WIDE_LOCALE);
    render(<OrgFields />);
    await screen.findByDisplayValue("شرکت نمونه");

    /*
     * The honest rendering: an unrecognised locale appears as itself. A select
     * that silently substitutes is the actual defect — it tells an admin their
     * organization is set to Persian when it is set to `fa-IR`, and there is
     * nothing on screen to suggest otherwise.
     */
    const select = screen.getByRole("combobox");
    expect((select as HTMLSelectElement).value).toBe("fa-IR");
    expect(screen.getByRole("option", { name: "fa-IR" })).toBeTruthy();
  });

  it("still lets an admin move it to an offered locale deliberately", async () => {
    org.mockResolvedValue(WIDE_LOCALE);
    render(<OrgFields />);
    await screen.findByDisplayValue("شرکت نمونه");

    await userEvent.selectOptions(screen.getByRole("combobox"), "en");
    await userEvent.click(saveButton());

    // preserved by default, changed only on an explicit choice
    await waitFor(() => expect(updateOrg).toHaveBeenCalledWith({ locale: "en" }));
  });
});

describe("an empty name is refused before it is sent", () => {
  it("disables save rather than letting core reject it", async () => {
    render(<OrgFields />);
    const input = await screen.findByDisplayValue("شرکت نمونه");
    await userEvent.clear(input);

    /*
     * An org must have a name — core refuses an empty one. Clearing the field
     * is NOT a clear operation here: these columns are NOT NULL and core
     * updates them with `coalesce`, so null already means "leave alone" and
     * there is nothing to clear. This is the exact opposite of the profile
     * form, where null clears because those columns are nullable.
     */
    expect(saveButton()).toBeDisabled();
    expect(updateOrg).not.toHaveBeenCalled();
  });
});

describe("the write is admin-only, the read is not", () => {
  it("shows a member the values with no controls", async () => {
    me.mockResolvedValue(member);
    render(<OrgFields />);

    /*
     * The values are NOT hidden. Core serves the org read to any active member
     * at `/v1/org` precisely so the shell can show the name — withholding it
     * here would deny something they may see in order to express a restriction
     * on something else.
     */
    expect(await screen.findByText("شرکت نمونه")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gives an admin the controls — proving the gate is not simply always closed", async () => {
    render(<OrgFields />);
    expect(await screen.findByDisplayValue("شرکت نمونه")).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});

describe("what this form deliberately does not offer", () => {
  it("has no control for organization status", async () => {
    render(<OrgFields />);
    await screen.findByDisplayValue("شرکت نمونه");
    /*
     * `status` is on `OrgRecord` and is read-only by core's own comment. Org
     * status is vendor-only at the database guard (D27): an admin who
     * suspended their own organization could not un-suspend it, so the
     * transition that removes the actor's power to reverse it does not get a
     * control here. A negative assertion because the failure mode is someone
     * later "completing" the form from the type.
     */
    expect(screen.queryByText(/وضعیت/)).toBeNull();
    // exactly one select on this form: the locale picker
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("does not duplicate the model allow-list", async () => {
    render(<OrgFields />);
    await screen.findByDisplayValue("شرکت نمونه");
    /*
     * `PATCH /v1/admin/org` accepts `allowed_models` and this form could send
     * it — but curation lives at Management · Models, and two homes for one
     * setting is two states that eventually disagree. The org fixture has a
     * model in its list; none of it should render here.
     */
    expect(screen.queryByText(/google\/gemini/)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
