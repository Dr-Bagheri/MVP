import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * THE TRAIL NAMES THE PAGE ON A PHONE TOO (2026-09-08).
 *
 * R2 retired the page-title block because «the breadcrumb names the page», and
 * that held while a labelled rail stood beside it with the section lit. The
 * rail is `md:flex`; below it the bottom bar carries three destinations out of
 * nine and lights nothing for the rest. So on a phone /meetings rendered a bar
 * holding one bell over a page holding no title — the trail was not in the
 * document at all, because a one-crumb trail returned `null` for want of a
 * parent to point at.
 *
 * Each case below is written with the version that passes without the fix:
 * asserting "the trail renders" is satisfied by the md rendering, which is in
 * the DOM at every width, so every assertion here reads the `md:hidden`
 * element specifically.
 */

let pathname = "/meetings";
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => pathname,
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}));
vi.mock("./CrumbTitle", () => ({ useCrumbTitleValue: () => "Weekly sync" }));

const { Breadcrumbs } = await import("./Breadcrumbs");

/** the phone's rendering — the one element the desktop `<ol>` is not */
const compact = () => document.querySelector<HTMLElement>('nav > span[class~="md:hidden"]');

afterEach(cleanup);

describe("the compact trail", () => {
  it("names a ROOT section, which has no parent to point at", () => {
    pathname = "/meetings";
    render(<Breadcrumbs />);
    const el = compact();
    expect(el, "the phone's trail is not rendered at all").not.toBeNull();
    expect(el!.textContent).toContain("platform.meetings");
    /* and there is no back control invented for it: every rail entry is a
       root (2026-09-02), so "up" from here is nowhere */
    expect(el!.querySelector("a"), "a root section grew a parent link").toBeNull();
    expect(el!.querySelector("[aria-current='page']")).not.toBeNull();
  });

  it("shows the way back AND where you are, on a page that has both", () => {
    pathname = "/meetings/m-1";
    render(<Breadcrumbs />);
    const el = compact()!;
    /* the parent is the link — the back control in its most compact form */
    const back = el.querySelector("a")!;
    expect(back.textContent).toContain("platform.meetings");
    expect(back).toHaveAttribute("href", expect.stringContaining("/meetings"));
    /* the leaf is the page's own name and is NOT a link: it would navigate to
       where you already are, which is the rule the md rendering applies to its
       own last crumb */
    const leaf = el.querySelector("[aria-current='page']")!;
    expect(leaf.textContent).toBe("Weekly sync");
    expect(leaf.tagName).not.toBe("A");
  });

  it("stays silent on the hub", () => {
    /*
     * The one screen whose anatomy is settled: «Home» over the page
     * that says «Good morning» is chrome naming what the screen already says.
     * This is the case the fix could most easily have broken — the old guard
     * was `trail.length < 2`, which covered the hub AND every root section by
     * accident.
     */
    pathname = "/";
    const { container } = render(<Breadcrumbs />);
    expect(container.firstChild).toBeNull();
  });
});
