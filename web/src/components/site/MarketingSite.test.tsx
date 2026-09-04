import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * THE COMPANY'S FRONT PAGE (2026-09-05).
 *
 * Two rules the user was explicit about, and both are the kind that a screen
 * looks fine while breaking:
 *
 *   1. NO call to action in the middle of anything. The generated draft was
 *      asked for this three times and complied; the risk is the next person
 *      who adds "Get started" under the closing line because the page feels
 *      like it wants one.
 *   2. The only door is the login in the top bar, and it is LOCAL — this
 *      app's own sign-in, through the locale-aware Link. The draft pointed it
 *      at `#login` while the header carried `id="login"`, so the one control
 *      on the site scrolled to the element it was already inside.
 *
 * Asserted as a COUNT and an href rather than "is the link there", because
 * both defects leave a link that is present and does nothing useful.
 */
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? `/fa${href}` : "#"} {...rest}>{children}</a>
  ),
}));
/* the canvas is a decoration and jsdom has no 2d context — the page's
   content is the subject, and a real canvas here would only throw */
vi.mock("./AmbientNetwork", () => ({ AmbientNetwork: () => null }));

/* jsdom ships no `matchMedia`, and the reveal asks it whether the reader
   wants less movement. Answering NO is the harder case on purpose: it leaves
   the IntersectionObserver path in play rather than short-circuiting every
   section to visible, so these assertions run against the animated page the
   reader actually gets. */
window.matchMedia = ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => undefined, removeEventListener: () => undefined,
  addListener: () => undefined, removeListener: () => undefined,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

/* …and no IntersectionObserver either. This one reveals IMMEDIATELY, which
   is what makes the content assertable — the real observer's timing is the
   browser's business and was verified there. */
class ImmediateObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver);
  }
  disconnect() { /* nothing to release */ }
  unobserve() { /* nothing to release */ }
  takeRecords() { return []; }
}
window.IntersectionObserver = ImmediateObserver as unknown as typeof IntersectionObserver;

import { MarketingSite } from "./MarketingSite";

describe("the front page's one door", () => {
  it("carries the login as a LOCAL link, and nothing else that navigates", () => {
    render(<MarketingSite />);

    const login = screen.getByRole("link", { name: "ورود" });
    expect(login).toHaveAttribute("href", "/fa/sign-in");

    /*
     * THE LOAD-BEARING ASSERTION. Every other link on the page is an in-page
     * anchor; a second destination would be a second door, and the whole
     * directive is that there is one. Checked by counting rather than by
     * naming, so a link added next month fails here instead of shipping.
     */
    const external = screen.getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => !h.startsWith("#"));
    expect(external).toEqual(["/fa/sign-in"]);
  });

  it("has NO buttons at all — the directive, made checkable", () => {
    /*
     * "There is no big Enter the Platform button in the middle of the hero …
     * do not put one in the middle of any section either." A count of zero is
     * the only form of that rule a test can hold: any threshold above zero
     * invites the one button somebody thinks is different.
     */
    render(<MarketingSite />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("states the four figures as static text, with their conditions", () => {
    /*
     * The old site rendered these as `0%` and `0` because nobody filled them
     * in — a placeholder that reads as a claim. The two that change every
     * release carry their measurement date, because a bare count on a public
     * page is wrong within a month and nobody is watching.
     */
    render(<MarketingSite />);
    for (const value of ["2.1%", "2,394", "190"]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    /* EXACTLY TWO carry a date, and that is the whole rule: the counts rot
       every release and need one; the 2.1% is fixed by its recording and the
       0 is a design invariant, so a date on either would be noise pretending
       to be rigour. `getAllByText` rather than `getByText` because the first
       version of this line found two and failed for the arity rather than
       for the fact. */
    expect(screen.getAllByText(/سنجش شهریور ۱۴۰۵/)).toHaveLength(2);
  });

  it("names OUR agents in the handoff, not invented ones", () => {
    /* the draft wrote @Arman and @Dena. Naming agents this product does not
       have is a fabrication about our own platform, on our own front page. */
    render(<MarketingSite />);
    expect(screen.getByText("@roya")).toBeInTheDocument();
    expect(screen.getByText("@ava")).toBeInTheDocument();
  });

  it("keeps the front page PUBLIC in the middleware's own list", () => {
    /*
     * A front page behind the auth gate is a door with a door in front of it,
     * and the failure is invisible from this suite: the component renders
     * perfectly either way. So the fact is read from the middleware's source,
     * where it lives.
     */
    /* read from the suite's own working directory rather than through
       `import.meta.url`: vitest resolves that to a non-file scheme here, and
       the first version of this line failed for that rather than for the
       fact it is about */
    const src = readFileSync("src/middleware.ts", "utf8");
    expect(src).toMatch(/const OPEN = \[[^\]]*"\/home"/);
    /* and the rule that sends a signed-out visitor to it: the ROOT goes to
       the front page, anything deeper still goes to sign-in */
    expect(src).toContain('rest === "/" ? `/${locale}/home` : `/${locale}/sign-in`');
  });
});
