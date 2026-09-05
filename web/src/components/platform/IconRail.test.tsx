import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconRail } from "./IconRail";
import { resetRailCompactForTest } from "@/lib/railCompact";

vi.mock("next-intl", () => ({
  useLocale: () => "fa",
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/meetings",
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({ default: (props: { alt: string }) => <img alt={props.alt} /> }));
vi.mock("@/api/client", () => ({
  api: {
    me: async () => ({
      id: "u1", display_name: "سارا", display_name_en: null, username: null, email: "s@x.io",
      role: "member", org_name: "نورای", avatar_url: null,
    }),
  },
}));
vi.mock("@/lib/signOut", () => ({ signOutThisDevice: vi.fn() }));

afterEach(() => {
  cleanup();
  resetRailCompactForTest();
});

const rail = () => screen.getByRole("navigation", { name: "primaryNav" });
/* the person's card lands after `me` answers; awaiting it keeps the last
   state update inside the test rather than after it. By TITLE, because the
   compact rail drops the name from the row and keeps it on the link. */
const settled = () => screen.findByTitle("سارا");

/**
 * THE MENU IS THE WIDTH IT WAS LEFT AT, FROM THE FIRST FRAME (user report,
 * 2026-09-05: "in the closed version of the main menu when I change from one
 * section to another it comes out and closes again").
 *
 * The rail remounts on every navigation (the shell is rendered per page), so
 * every assertion about width here is made SYNCHRONOUSLY, right after
 * render, before anything is awaited. The version this replaces rendered the
 * menu open and closed it in an effect: it would pass every assertion made
 * after a `findBy…` and fail every one made here.
 */
describe("the rail's width", () => {
  it("opens COMPACT by default — glyphs only, and the way back present", async () => {
    render(<IconRail />);
    expect(rail()).toHaveClass("w-16");
    expect(screen.queryByText("meetings"), "a label rendered on the compact rail").toBeNull();
    expect(screen.getByRole("button", { name: "railExpand" })).toBeInTheDocument();
    await settled();
  });

  it("paints the REMEMBERED width on the first frame of a remount — no flash through the other state", async () => {
    render(<IconRail />);
    await userEvent.click(screen.getByRole("button", { name: "railExpand" }));
    expect(rail()).toHaveClass("w-60");
    expect(screen.getByText("meetings")).toBeInTheDocument();
    await settled();

    /* the navigation: the rail is torn down and mounted again */
    cleanup();
    render(<IconRail />);
    expect(rail(), "the remount passed through the default before reading the choice").toHaveClass("w-60");
    await settled();

    await userEvent.click(screen.getByRole("button", { name: "railCompact" }));
    cleanup();
    render(<IconRail />);
    expect(rail()).toHaveClass("w-16");
    await settled();
  });

  it("points the expand chevron at the CONTENT and the collapse chevron at the WALL — flipped for RTL", async () => {
    /*
     * The rail sits at the inline-start (the right edge in Persian). Opening
     * it grows it toward the content, so the expand arrow points inline-END —
     * `>` in English, `<` in Persian (user, 2026-09-05: "in fa version the
     * opening menu icon should be < instead of >"); the collapse arrow points
     * the other way. Asserted as the flip classes, which is what decides the
     * direction on a `dir="rtl"` document.
     */
    render(<IconRail />);
    const expand = screen.getByRole("button", { name: "railExpand" }).querySelector("svg")!;
    expect(expand).toHaveClass("rtl:-scale-x-100");
    expect(expand).not.toHaveClass("-scale-x-100");
    await userEvent.click(screen.getByRole("button", { name: "railExpand" }));
    const collapse = screen.getByRole("button", { name: "railCompact" }).querySelector("svg")!;
    expect(collapse).toHaveClass("-scale-x-100");
    expect(collapse).toHaveClass("rtl:scale-x-100");
    await settled();
  });
});
