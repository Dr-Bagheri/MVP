import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@/api/types";

/**
 * THE PROFILE IS FOUR SUB-PAGES NOW, in the order the user named them
 * (directive, 2026-09-04: "add a sub menu on top for it with order like this:
 * Identity, Preferences, Assistant & data, Change password").
 *
 * Two properties, and the second is the one that rots. ORDER is the directive
 * itself, so it is asserted as a sequence rather than as four presences — a
 * set of four labels in any arrangement satisfies "they are all there", and
 * the arrangement is what was asked for. And each section renders ITS OWN
 * content and NOT its neighbours', because the failure mode of a tabbed page
 * built from a long scroll is that every panel still renders and only the
 * heading changes, which looks perfectly correct on the first tab.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/profile",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}));

const ME: User = {
  id: "u-1", org_id: "o-1", username: "sara", display_name: "سارا",
  display_name_en: "Sara", email: "sara@example.test", avatar_url: null,
  role: "member", status: "active", locale: "fa", model_id: null,
  created_at: new Date().toISOString(),
};

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      me: async () => ME,
      models: async () => ({ models: [], preferred_model: null, tool_capability_filtered: false }),
      updateProfile: vi.fn(),
      setPreferredModel: vi.fn(),
      setLocale: vi.fn(),
      meetings: async () => [],
      taskBoard: async () => ({ columns: [], topics: [], tasks: [] }),
    },
  };
});

const { default: ProfilePage } = await import("./[[...section]]/page");

/** mount one section — awaited, because `use(params)` suspends */
async function open(section?: string) {
  await act(async () => {
    render(<ProfilePage params={Promise.resolve(section ? { section: [section] } : {})} />);
  });
  await screen.findByRole("navigation");
}

const IDENTITY = "هویت";
const PREFERENCES = "ترجیح‌ها";
const ASSISTANT = "دستیار و داده‌ها";
const PASSWORD = "تغییر گذرواژه";

describe("the profile's section menu", () => {
  it("lists the four sections in the order they were asked for", async () => {
    await open();
    const nav = screen.getByRole("navigation");
    const labels = within(nav).getAllByRole("link").map((a) => a.textContent?.trim());
    expect(labels).toEqual([IDENTITY, PREFERENCES, ASSISTANT, PASSWORD]);
  });

  it("points each item at its own address", async () => {
    await open();
    const nav = screen.getByRole("navigation");
    const hrefs = within(nav).getAllByRole("link").map((a) => a.getAttribute("href"));
    /* Identity is the bare route: /profile and /profile/identity would be two
       addresses for one screen, and only one of them can be the one the avatar
       menu links to */
    expect(hrefs).toEqual(["/profile", "/profile/preferences", "/profile/assistant", "/profile/password"]);
  });
});

describe("each section renders its own content, and only its own", () => {
  it("identity: the name form and the way out", async () => {
    await open();
    expect(screen.getByDisplayValue("سارا"), "the identity form is missing").toBeTruthy();
    expect(screen.getByRole("button", { name: "خروج از حساب" })).toBeTruthy();
    /* the neighbours must be ABSENT, not merely further down: a version that
       renders all four panels and changes only the heading passes every
       positive assertion in this file */
    expect(screen.queryByLabelText(/^زبان/), "preferences leaked onto identity").toBeNull();
  });

  it("identity has no «نشست» heading over that button", async () => {
    /*
     * User directive: "remove the session section, just put a big sign out
     * button." Asserted as an absence because the removed version renders
     * perfectly — a heading, a panel and a label around a button that already
     * said what it does.
     */
    await open();
    expect(screen.queryByText("نشست")).toBeNull();
  });

  it("preferences: the three choices, and not the name form", async () => {
    await open("preferences");
    expect(screen.getByLabelText(/^زبان/)).toBeTruthy();
    expect(screen.queryByDisplayValue("سارا"), "the identity form leaked").toBeNull();
    expect(screen.queryByRole("button", { name: "خروج از حساب" })).toBeNull();
  });

  it("password: its own form alone", async () => {
    await open("password");
    expect(screen.queryByDisplayValue("سارا")).toBeNull();
    expect(screen.queryByLabelText(/^زبان/)).toBeNull();
  });

  it("an address nobody wrote lands on Identity rather than on nothing", async () => {
    /* the control for `sectionFor`: without the fallback this renders a page
       with a toolbar and no content, which reads as a broken screen rather
       than as a bad URL */
    await open("not-a-section");
    expect(screen.getByDisplayValue("سارا")).toBeTruthy();
  });
});
