import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Org, User } from "@/api/types";

/**
 * Management · General's org form, after the user's order (2026-09-16: "put
 * the logo first row, then the org name, then email, then website, remove
 * the explanation and location").
 *
 * The order is asserted as DOCUMENT POSITION between the labelled controls,
 * not as a list of labels — a version that re-labelled the same rows passes a
 * label list and keeps the old order. The two removed rows are asserted as
 * ABSENCES, twice each: the label is gone AND the saved value is nowhere on
 * the screen, because a form that dropped the label and kept the input would
 * still render «AI-native company» somewhere a person could edit it.
 *
 * And the wire: the patch must not carry the two columns the form no longer
 * holds. A form that kept them in state and simply stopped drawing them
 * would send `description: null` the first time somebody saved the name —
 * clearing a column nobody touched.
 */

const me = vi.fn();
const org = vi.fn();
const updateOrg = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    org: () => org(),
    updateOrg: (patch: unknown) => updateOrg(patch),
    orgLogoUrl: () => "/org-logo.png",
    uploadOrgLogo: () => Promise.resolve(),
    clearOrgLogo: () => Promise.resolve(),
  },
}));

const { OrgFields } = await import("./OrgFields");

const ADMIN = { id: "u-1", role: "admin", status: "active" } as unknown as User;
const ORG = {
  id: "o-1",
  name: "شرکت نمونه",
  locale: "fa",
  public_email: "info@example.test",
  description: "AI-native company",
  website_url: "https://example.test",
  location: "tehran",
  has_logo: true,
} as unknown as Org;

beforeEach(() => {
  me.mockReset();
  org.mockReset();
  updateOrg.mockReset();
  me.mockResolvedValue(ADMIN);
  org.mockResolvedValue(ORG);
  updateOrg.mockImplementation(async (patch: Record<string, unknown>) => ({ ...ORG, ...patch }));
});

/** true when `a` comes before `b` in the document */
const before = (a: Element, b: Element) =>
  // eslint-disable-next-line no-bitwise
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("Management · General — the org form's rows", () => {
  it("runs logo → name → email → website → default language, and nothing else", async () => {
    render(<OrgFields />);
    await screen.findByDisplayValue("شرکت نمونه");

    const logo = screen.getByLabelText("نشان سازمان");
    const name = screen.getByLabelText("نام سازمان");
    const email = screen.getByLabelText("ایمیل");
    const website = screen.getByLabelText("وب‌سایت");
    const locale = screen.getByLabelText("زبان پیش‌فرض سازمان");
    expect(before(logo, name), "the logo is not the first row").toBe(true);
    expect(before(name, email), "the name is not before the email").toBe(true);
    expect(before(email, website), "the email is not before the website").toBe(true);
    expect(before(website, locale), "the website is not before the language").toBe(true);

    /* the two removed rows: label gone, AND the stored value nowhere */
    expect(screen.queryByLabelText("توضیح")).toBeNull();
    expect(screen.queryByLabelText("مکان")).toBeNull();
    expect(screen.queryByDisplayValue("AI-native company")).toBeNull();
    expect(screen.queryByDisplayValue("tehran")).toBeNull();
    /* the old label is gone too — «رایانامهٔ عمومی» was the email's name */
    expect(screen.queryByText("رایانامهٔ عمومی")).toBeNull();
  });

  it("the patch carries only what the form holds — never the two columns it dropped", async () => {
    render(<OrgFields />);
    const name = await screen.findByLabelText("نام سازمان");
    await userEvent.clear(name);
    await userEvent.type(name, "شرکت تازه");
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    });
    expect(updateOrg).toHaveBeenCalledTimes(1);
    /* the EXACT key set: a stray `description: null` here would clear a
       column nobody touched, and `toMatchObject` would not see it */
    expect(Object.keys(updateOrg.mock.calls[0]![0] as object)).toEqual(["name"]);
  });
});
