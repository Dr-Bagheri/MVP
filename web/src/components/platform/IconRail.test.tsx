import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconRail } from "./IconRail";
import { NAV_PRIMARY, NAV_UTILITY } from "./nav";

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

afterEach(cleanup);

const rail = () => screen.getByRole("navigation", { name: "primaryNav" });
/* the person's card lands after `me` answers; awaiting it keeps the last
   state update inside the test rather than after it */
const settled = () => screen.findByTitle("سارا");

/**
 * THE RAIL HAS ONE WIDTH AND EVERY ENTRY HAS ITS WORD.
 *
 * The tests this file replaces were all about the OTHER state: a 248px labelled
 * menu, a 64px compact one, a stored choice, and the first-frame width on every
 * remount. None of that can be wrong any more, because there is nothing to
 * choose — which is the change, and is why the assertions below are about the
 * word under each glyph instead.
 */
describe("the category rail", () => {
  it("names every destination in words, not only in tooltips", async () => {
    render(<IconRail />);
    /* the labels are the whole point of this rail — an icon-only column is a
       memory test, and the 248px version that carried these same nine words
       is what it replaced. Asserted through the NAV MODEL rather than a
       hand-written list, so a destination added to nav.ts is covered by
       existing. */
    for (const nav of [...NAV_PRIMARY, ...NAV_UTILITY]) {
      expect(screen.getByRole("link", { name: nav.key }), nav.key).toBeInTheDocument();
      /* and the word is RENDERED, not just announced: `getByRole` is satisfied
         by the aria-label alone, which is exactly the icon-only rail this
         replaced */
      expect(screen.getAllByText(nav.key).length, `${nav.key} has no visible label`)
        .toBeGreaterThan(0);
    }
    await settled();
  });

  it("has ONE width and no control that changes it", async () => {
    render(<IconRail />);
    expect(rail()).toHaveClass("w-rail");
    /* asserted as an ABSENCE, because the version that still carries the
       toggle renders perfectly — it is only wrong beside a rail that has one
       state to be in */
    expect(screen.queryByRole("button", { name: "railExpand" })).toBeNull();
    expect(screen.queryByRole("button", { name: "railCompact" })).toBeNull();
    await settled();
  });

  it("lights the section the person is standing in, and only that one", async () => {
    render(<IconRail />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("meetings");
    await settled();
  });

  it("carries Home as a destination, and no separate assistant button", async () => {
    /*
     * The green «دستیار» CTA is gone because HOME is the assistant now
     * (2026-09-08). Both halves are asserted: a rail that simply lost the
     * button would pass the second line and leave the product with no door
     * to the conversation at all.
     */
    render(<IconRail />);
    const home = screen.getByRole("link", { name: "home" });
    expect(home).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "assistant" })).toBeNull();
    await settled();
  });

  it("puts the person at the foot, as a door to their own page", async () => {
    render(<IconRail />);
    const person = await settled();
    expect(person).toHaveAttribute("href", "/profile");
    /* sign-out is NOT here: the avatar menu in the top bar carries it at every
       width, and a second control inside a 72px cell is a click target that
       means two things depending on the pixel */
    expect(screen.queryByRole("button", { name: "signOut" })).toBeNull();
  });
});

/**
 * R23 — THE RAIL WEARS THE CHROME (then, on the rendered screen).
 *
 * The rail was an opaque `bg-surface` column with a `border-e` hairline down
 * its inline-end. The first pass took both and left it transparent — which
 * removed the seam and the chrome together, and is the version this test was
 * rewritten against.
 *
 * Asserted as the TRIPLE, because each part alone passes against a version
 * that is still wrong: the sheet without the seam check is the bordered look
 * wearing glass; the seam check without the sheet is a column that has
 * dissolved into the page; and both without `w-rail` are satisfied by a rail
 * that lost its column altogether.
 *
 * The sheet is named as the class TopBar uses, not as a colour — the two meet
 * at the window's corner, and "the same as the top header" is only guaranteed
 * while there is one spelling of it.
 */
describe("R23: the rail wears the top bar's sheet, and no seam", () => {
  it("keeps its width, carries the chrome, and draws neither edge nor opaque ground", async () => {
    render(<IconRail />);
    const classes = rail().className.split(/\s+/);
    expect(classes, "the rail lost its column").toContain("w-rail");
    expect(classes, "the rail is not wearing the chrome the top bar wears").toContain("glass-chrome");
    for (const seam of ["border-e", "border-border", "bg-surface"]) {
      expect(classes, `the rail still carries ${seam}`).not.toContain(seam);
    }
    await settled();
  });

  it("rounds the app's top-START corner, and only that one", async () => {
    /*
     * "make the corner of the rail and the top header corner rounded"
     * (2026-09-08). The app's top edge is TWO elements — this column's
     * top-start corner and the bar's top-end one — so the pair is asserted in
     * the two files, and the ABSENCE here is what stops the fix being a blanket
     * `rounded-2xl` that also rounds the corner where the rail meets the bar.
     *
     * Logical, never physical: `rounded-ss` is the reading-start side, so it is
     * the left corner in English and the right one in Persian. `rounded-tl`
     * would look correct in one locale and put the curve on the wrong end of
     * the window in the other — the mistake this repo has already paid for in
     * a padding, an eye button and a context menu.
     */
    render(<IconRail />);
    const classes = rail().className.split(/\s+/);
    expect(classes, "the rail's outer corner is square").toContain("rounded-ss-2xl");
    for (const wrong of ["rounded-2xl", "rounded-tl-2xl", "rounded-se-2xl"]) {
      expect(classes, `the rail carries ${wrong}`).not.toContain(wrong);
    }
    await settled();
  });
});

/**
 * THE FOOT KEEPS ITS PLACE WHILE THE IDENTITY IS READ (user report,
 * 2026-09-08: "every time I refresh, the help comes a little late and I see
 * the settings icon jumping").
 *
 * Settings and Help are held at the bottom of a `flex-1` column by `mt-auto`,
 * so anything that appears BELOW them moves them. The person's card is that
 * anything: it used to render only once `api.me()` answered, which took ~62px
 * out of the column half a second into every page load and pulled both
 * destinations up.
 *
 * jsdom has no layout, so the assertion is the mechanism rather than the
 * pixels: the space is kept by the CARD'S OWN BOX — the shared geometry string,
 * around the same 36px circle, with the same 4px of padding — which is why the
 * two cannot be different heights. Measured on the rendered page separately.
 *
 * WHERE THE 4px LIVES CHANGED, and this test was
 * written against the version before it. It asserted that the two class strings
 * were IDENTICAL, which held while `p-1` sat on the shared wrapper — and that
 * placement cost the hit area: the profile `Link` inside then wore nothing but
 * the 36px avatar, so the click target, the focus ring and the hover fill all
 * shrank to 36, under the platform's 44px floor, on the one control in a 64px
 * column. The padding is now on whatever FILLS the box: the wrapper for the
 * placeholder (it has nothing else), the `Link` for the real card.
 *
 * So the property is no longer "one string" but the thing that string was
 * standing in for: both branches reserve 4 + 36 + 4. Asserted as three facts —
 * the shared geometry, the 36px mark, and exactly one `p-1` per branch on the
 * element that is actually pressed. An exact-equality assertion would now be
 * asking for the 36px target back.
 */
describe("the rail's foot", () => {
  it("holds the card's own box until the person arrives", async () => {
    render(<IconRail />);
    /* SYNCHRONOUS, like every width assertion above: this is the frame a
       person sees on every refresh, and the identity lands after it */
    const holding = screen.getByTestId("rail-foot-loading");
    expect(holding.getAttribute("aria-hidden"), "the placeholder is furniture").toBe("true");
    /* BOTH read before the await. React reuses the wrapper `div` across the two
       branches, so `holding` is the SAME node afterwards wearing the card's
       class and holding the card's child — reading it later would compare the
       loaded state with itself. */
    const kept = holding.className.split(" ");
    const keptMark = holding.firstElementChild!.className;

    const link = await settled();
    const card = link.parentElement!;
    expect(screen.queryByTestId("rail-foot-loading"), "the placeholder outlived the read").toBeNull();

    /* ONE geometry string, worn by both boxes — centring, corner and the column
       centre cannot be tuned for one state and not the other */
    expect(kept.filter((c) => c !== "p-1")).toEqual(card.className.split(" "));

    /* the 4px is in BOTH branches, which is what makes them 44 and 44 rather
       than 44 and 36 — and in the loaded one it is on the element a person
       presses, so the target, the ring and the hover fill are all 44 */
    expect(kept, "the placeholder has nothing inside to carry the padding").toContain("p-1");
    expect(card.className.split(" "), "the wrapper must not pad the real card")
      .not.toContain("p-1");
    expect(link.className.split(" "), "the pressed element carries the 4px").toContain("p-1");

    /* and the same 36px mark inside each, so the two boxes hold one shape */
    expect(keptMark, "the held place is a 36px skeleton").toContain("h-9 w-9");
    expect(link.firstElementChild!.className, "Avatar size=\"md\" is the 36px mark")
      .toContain("h-9 w-9");
  });
});
