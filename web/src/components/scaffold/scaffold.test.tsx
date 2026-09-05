import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindConfig from "../../../tailwind.config";
import { SCAFFOLD } from "./constants";

/**
 * M26 scaffold tests.
 *
 * Two kinds of claim here, deliberately separate:
 *
 * 1. **The constants and the Tailwind theme agree.** constants.ts is the ONE
 *    source of the blueprint's numbers and tailwind.config.ts derives from it;
 *    this test is what makes a hand edit to either side go red instead of
 *    silently forking the scale. (Verified red by mutating one side before
 *    trusting it — see the header of each assertion group.)
 *
 * 2. **Structure jsdom can actually see**: roles, labels, aria-current, label
 *    association. Class-list reading is deliberately minimal — the computed
 *    values are verified against the live render (rule 12: read the computed
 *    value, never the class list), which a jsdom test cannot do honestly.
 */

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/* MenuLayout's close/resize affordances name themselves via next-intl; the
   keys are asserted by the locale suites, not here */
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));

const { SectionMenu, MenuLayout } = await import("./SectionMenu");
const { FormPanel, FormRow, PanelFooter } = await import("./FormPanel");
const { PageContainer, PageHeader, Section } = await import("./Page");
const { SectionScroller } = await import("./SectionScroller");

/* eslint-disable @typescript-eslint/no-explicit-any */
const theme = (tailwindConfig as any).theme.extend;

describe("the Tailwind theme derives from the scaffold constants", () => {
  it("radii: control/panel/tile/modal", () => {
    expect(theme.borderRadius.md).toBe(`${SCAFFOLD.radius.control}px`);
    expect(theme.borderRadius.lg).toBe(`${SCAFFOLD.radius.panel}px`);
    expect(theme.borderRadius.DEFAULT).toBe(`${SCAFFOLD.radius.panel}px`);
    expect(theme.borderRadius.xl).toBe(`${SCAFFOLD.radius.tile}px`);
    expect(theme.borderRadius["2xl"]).toBe(`${SCAFFOLD.radius.modal}px`);
  });

  /*
   * Since the responsive-scaling directive (2026-08-18) the theme emits REM
   * derived from the blueprint's px (÷16), so every role tracks the
   * viewport-scaled root font-size. The assertion still pins DERIVATION —
   * a hand-typed value on either side goes red.
   */
  const rem = (px: number) => `${px / 16}rem`;

  it("type roles: pane title / menu item / detail / group label", () => {
    expect(theme.fontSize["pane-title"][0]).toBe(rem(SCAFFOLD.fontSize.paneTitle));
    expect(theme.fontSize["menu-item"][0]).toBe(rem(SCAFFOLD.fontSize.menuItem));
    expect(theme.fontSize.detail[0]).toBe(rem(SCAFFOLD.fontSize.detail));
    expect(theme.fontSize["group-label"][0]).toBe(rem(SCAFFOLD.fontSize.groupLabel));
  });

  it("keeps one optical, theme-owned line box for centered control labels", () => {
    expect(theme.lineHeight.control).toBe("1.25");
  });

  it("the PAGE RHYTHM is derived, not typed twice", () => {
    /*
     * The block these come from used to be a COMMENT in constants.ts while
     * every screen wrote its own numbers, which is how the platform ended up
     * with three different meanings for "the top of a page". Deriving them
     * makes a hand edit to either side red instead of a silent fork —
     * verified by changing one value and watching this fail.
     */
    const spacing = tailwindConfig.theme?.extend?.spacing as Record<string, string>;
    expect(spacing.page).toBe(`${SCAFFOLD.page.top / 16}rem`);
    expect(spacing["page-sm"]).toBe(`${SCAFFOLD.page.topSm / 16}rem`);
    expect(spacing["page-inline"]).toBe(`${SCAFFOLD.page.inline / 16}rem`);
    expect(spacing["page-inline-md"]).toBe(`${SCAFFOLD.page.inlineMd / 16}rem`);
    expect(spacing["page-bottom"]).toBe(`${SCAFFOLD.page.bottom / 16}rem`);
    expect(spacing["page-menu"]).toBe(`${SCAFFOLD.page.menuTop / 16}rem`);
  });

  it("a section body takes the space LEFT, and computes no ceiling", () => {
    /*
     * The cap used to be arithmetic — the viewport minus a reserve in rem
     * that stood for the title, the player and the section header. It was
     * measured on one window height and was wrong on a shorter one, which
     * put the whole page back into scroll mode. This asserts the mechanism
     * that replaced it: leftover space, no number.
     */
    const { container } = render(<SectionScroller>body</SectionScroller>);
    const box = container.querySelector("[data-section-scroll]")!;
    expect(box.className).toContain("flex-1");
    expect(box.className).toContain("min-h-0");
    expect(box.className).not.toMatch(/max-h-/);
  });

  it("the three page sizes are ordered, and each is a real theme entry", () => {
    /*
     * The RULE, not the numbers (user directive, 2026-09-02: "three sets of
     * page size — small, normal, big … set it into the theme rule for the
     * whole platform"). What must hold is the ordering and the fact that each
     * one resolves: a `max-w-content-small` that is not registered emits
     * nothing, and a page asking for the small column silently gets the full
     * viewport — the `text-on-accent` failure, one layer up.
     */
    /* TWO columns since 2026-09-03, not three: `big`/`wide` left with the
       page sizes (the widest was no bound at all, which is not a size). The
       ordering is still the assertion — a small column that is not smaller
       than the normal one is the token-that-emits-nothing failure, one layer
       up, and it would read as satisfied in every source. */
    expect(SCAFFOLD.contentMaxWidthSmall).toBeLessThan(SCAFFOLD.contentMaxWidth);
    const maxWidth = theme.maxWidth as Record<string, string>;
    expect(maxWidth["content-small"]).toBe(`${SCAFFOLD.contentMaxWidthSmall / 16}rem`);
    expect(maxWidth.content).toBe(`${SCAFFOLD.contentMaxWidth / 16}rem`);
    /* and the retired one is GONE, asserted rather than assumed: a token left
       behind is a third size waiting for someone to pick it */
    expect(maxWidth["content-wide"]).toBeUndefined();
  });

  it("keeps the menu heading and the page title on one line", () => {
    /*
     * The pair is a RELATIONSHIP, not two numbers: the menu heading sits
     * lower than the page title so the two share a line (user directive,
     * 2026-08-18). Asserting the gap means raising the page's top margin
     * cannot silently leave the menu heading behind — which is precisely
     * what a later "just add some space" edit would do.
     *
     * The gap is 2 rather than 12 since the arameet measurement: both
     * headings came down (24→16 and 17→14), and the offset between two
     * text sizes closes as the sizes do. The RULE did not change, which is
     * the point of asserting the relationship instead of the numbers.
     */
    expect(SCAFFOLD.page.top - SCAFFOLD.page.menuTop).toBe(2);
  });

  it("dimensions: menu, rail, content columns, controls, top bar", () => {
    expect(theme.width.menu).toBe(rem(SCAFFOLD.menuWidth));
    expect(theme.width.rail).toBe(rem(SCAFFOLD.railWidth));
    expect(theme.maxWidth.content).toBe(rem(SCAFFOLD.contentMaxWidth));
    expect(theme.height.control).toBe(rem(SCAFFOLD.controlHeight));
    expect(theme.minHeight.control).toBe(rem(SCAFFOLD.controlHeight));
    expect(theme.height.topbar).toBe(rem(SCAFFOLD.topBarHeight));
  });

  it("the page and section titles are SCAFFOLD roles, not Tailwind defaults", () => {
    /*
     * They used to ride `text-2xl`/`text-xl`, and this test pinned that
     * reliance. It was the wrong shape: the two most structural sizes in the
     * product were the only ones the blueprint did not own, so the
     * 2026-09-02 measurement could not move them without editing a
     * stylesheet by hand — which is the fork this whole file exists to make
     * impossible. They are derived entries now, asserted the same way every
     * other role is.
     */
    const fontSize = theme.fontSize as Record<string, [string, string]>;
    expect(fontSize["page-title"]?.[0]).toBe(`${SCAFFOLD.fontSize.pageTitle / 16}rem`);
    expect(fontSize["section-title"]?.[0]).toBe(`${SCAFFOLD.fontSize.sectionTitle / 16}rem`);
    /* the ORDER is the invariant worth pinning, not the pixel values — a
       page's name reads larger than a block's, which reads larger than the
       body, whatever the measurement moves them to */
    expect(SCAFFOLD.fontSize.pageTitle).toBeGreaterThan(SCAFFOLD.fontSize.sectionTitle);
    expect(SCAFFOLD.fontSize.sectionTitle).toBeGreaterThan(SCAFFOLD.fontSize.body);
  });
});

const GROUPS = [
  {
    key: "config",
    title: "پیکربندی",
    items: [
      { slug: "general", href: "/settings", label: "عمومی" },
      { slug: "security", href: "/settings/security", label: "امنیت", badge: "به‌زودی" },
    ],
  },
  {
    key: "compliance",
    title: "انطباق",
    items: [{ slug: "audit", href: "/settings/audit-logs", label: "گزارش‌های ممیزی" }],
  },
] as const;

describe("SectionMenu structure", () => {
  it("renders a labelled nav with the pane heading", () => {
    render(<SectionMenu navLabel="تنظیمات" heading="تنظیمات" groups={GROUPS} activeSlug="general" />);
    expect(screen.getByRole("navigation", { name: "تنظیمات" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "تنظیمات" })).toBeTruthy();
  });

  it("exactly the active item carries aria-current=page", () => {
    render(<SectionMenu navLabel="menu" heading="تنظیمات" groups={GROUPS} activeSlug="security" />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.length).toBe(1);
    expect(current[0]!.textContent).toContain("امنیت");
  });

  it("group labels render and hairlines sit only BETWEEN groups (n-1 of them)", () => {
    const { container } = render(
      <SectionMenu navLabel="menu" heading="تنظیمات" groups={GROUPS} activeSlug="general" />,
    );
    expect(screen.getByText("پیکربندی")).toBeTruthy();
    expect(screen.getByText("انطباق")).toBeTruthy();
    expect(container.querySelectorAll("hr").length).toBe(GROUPS.length - 1);
  });

  it("a badged item shows its chip — the not-yet-usable marker lives in the menu", () => {
    render(<SectionMenu navLabel="menu" heading="تنظیمات" groups={GROUPS} activeSlug="general" />);
    expect(screen.getByText("به‌زودی")).toBeTruthy();
  });
});

describe("THE SHELL SCROLL — one scroller, the content column", () => {
  /*
   * User directive (2026-08-28): "the sub menu should not move with scroll,
   * fix this for all platform … as you see in sana.ai the menu and sub menu
   * is fixed as well." From md up MenuLayout is exactly the height the shell
   * grants it and can never scroll itself; the menu column scrolls its own
   * overflow; the CONTENT column is the one scroller. jsdom computes no
   * layout, so these pin the CLASSES the behaviour hangs on — each verified
   * red by removing it — and the computed truth (scrollHeight, the menu's
   * bounding rect surviving a content scroll) is measured on the live render.
   *
   * There is deliberately NO repo-wide grep for "competing overflow-y-auto
   * scrollers": legitimate inner scrollers are everywhere (tables in their
   * own boxes, dialogs, dropdown panels, conversation threads), and no
   * textual pattern separates "a box scrolling its own overflow" from "a
   * second page scroller". A checker that manufactures false positives gets
   * muted within a week and is then worse than absent — the honest gap is
   * recorded here instead, and the viewport-ROOT guard (rhythm.guard.test.ts)
   * catches the graver shape: a surface declaring its own h-dvh document.
   */
  function renderLayout() {
    return render(
      <MenuLayout menu={<nav aria-label="بخش‌ها">منو</nav>}>
        <p>محتوا</p>
      </MenuLayout>,
    );
  }

  it("the row is viewport-bound from md up and never scrolls itself", () => {
    const { container } = renderLayout();
    const root = container.firstElementChild as HTMLElement;
    const classes = root.className.split(" ");
    expect(classes).toContain("md:h-full");
    expect(classes).toContain("md:overflow-hidden");
    /* below md the stacked mobile layout still flows as one page — the row
       must stay min-h-full there, not become a box that clips the phone */
    expect(classes).toContain("min-h-full");
  });

  it("the content region is THE scroller", () => {
    renderLayout();
    const content = screen.getByText("محتوا").parentElement as HTMLElement;
    const classes = content.className.split(" ");
    for (const cls of ["min-w-0", "flex-1", "md:min-h-0", "md:overflow-y-auto"]) {
      expect(classes).toContain(cls);
    }
  });

  it("the menu column scrolls itself — a long menu never pushes the page", () => {
    renderLayout();
    const menuWrap = screen.getByRole("navigation", { name: "بخش‌ها" })
      .parentElement as HTMLElement;
    const classes = menuWrap.className.split(" ");
    expect(classes).toContain("h-full");
    expect(classes).toContain("md:overflow-y-auto");
  });
});

describe("SectionScroller — a section body ends at the viewport", () => {
  /*
   * User directive (2026-08-29): a long summary or transcript must scroll
   * INSIDE its section instead of growing the page. jsdom computes no
   * layout, so what is honest here is the box's contract: the capped,
   * scrolling element is the one the caller's ref reaches, it carries the
   * theme's ONE height (never a literal of its own), and the marker a page
   * test greps for is really on it. The computed behaviour — that the frame
   * holds still while the body moves — is a live-render claim, and is
   * recorded as unmeasured in this batch's report rather than pretended
   * here.
   */
  it("is the scrolling box itself: the ref, the handlers and the marker land on one element", () => {
    const ref = { current: null as HTMLDivElement | null };
    const scrolled = vi.fn();
    const { container } = render(
      <SectionScroller scrollRef={ref} onScroll={scrolled}>
        <p>بدنهٔ بخش</p>
      </SectionScroller>,
    );
    const box = container.querySelector("[data-section-scroll]") as HTMLElement;
    expect(box).toBeTruthy();
    // the ref must reach the SCROLLER — a wrapper would break scrollIntoView
    // inside it and the record's jump-back, silently
    expect(ref.current).toBe(box);
    expect(box.textContent).toContain("بدنهٔ بخش");
    fireEvent.scroll(box);
    expect(scrolled).toHaveBeenCalled();
  });

  it("prints whole — the one place the cap is written is the one place it is lifted", () => {
    /*
     * On paper there is no viewport: a capped box would print its first
     * screenful and drop the rest, which on a meeting record is a document
     * that looks complete and is not. jsdom applies no media query, so what
     * is honest here is that the rule EXISTS and names this component's own
     * marker — a source read, deliberately, and stated as one.
     */
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const print = css.slice(css.indexOf("@media print"));
    const rule = print.slice(0, print.indexOf("\n}\n"));
    expect(rule).toContain("[data-section-scroll]");
    expect(rule).toContain("max-height: none !important");
  });

  it("never writes a height literal of its own", () => {
    /* the fork this component exists to prevent: `max-h-[calc(…)]` written
       at a call site — the shape that put the page back into scroll mode
       when its arithmetic missed by a few pixels. There is no ceiling to
       fork now, and this keeps one from growing back. */
    const { container } = render(<SectionScroller><p>x</p></SectionScroller>);
    const classes = (container.firstElementChild as HTMLElement).className.split(" ");
    expect(classes).toContain("overflow-y-auto");
    expect(classes.filter((c) => c.startsWith("max-h-"))).toEqual([]);
  });
});

describe("FormPanel anatomy", () => {
  it("FormRow with htmlFor renders a real <label> associated to the control", () => {
    render(
      <FormPanel>
        <FormRow label="نام سازمان" description="در همهٔ صفحه‌ها نمایش داده می‌شود." htmlFor="org-name">
          <input id="org-name" className="input" defaultValue="نورای" />
        </FormRow>
      </FormPanel>,
    );
    // EXACT name — a label that swallowed its hint would fail this (the
    // label-plus-hint accessible-name bug; this file's first draft had it)
    const input = screen.getByLabelText("نام سازمان", { exact: true }) as HTMLInputElement;
    expect(input.value).toBe("نورای");
    // the hint reaches the control as description, not as name
    expect(input.getAttribute("aria-describedby")).toBe("org-name-desc");
    expect(screen.getByText("در همهٔ صفحه‌ها نمایش داده می‌شود.").id).toBe("org-name-desc");
  });

  it("without htmlFor the label is text, not a <label> pointing at nothing", () => {
    const { container } = render(
      <FormPanel>
        <FormRow label="اعضا">
          <table />
        </FormRow>
      </FormPanel>,
    );
    // a <label> with no control is worse than none (the describedby lesson)
    expect(container.querySelector("label")).toBeNull();
    expect(screen.getByText("اعضا")).toBeTruthy();
  });

  it("PanelFooter renders inside the panel with its actions", () => {
    render(
      <FormPanel>
        <FormRow label="x">
          <input id="x" />
        </FormRow>
        <PanelFooter>
          <button className="btn-primary">ذخیرهٔ تغییرات</button>
        </PanelFooter>
      </FormPanel>,
    );
    expect(screen.getByRole("button", { name: "ذخیرهٔ تغییرات" })).toBeTruthy();
  });
});

describe("Page anatomy", () => {
  it("PageHeader: the ACTIONS, and nothing else", () => {
    /*
     * The title, the subtitle and the hairline are gone (user directive,
     * 2026-09-02). They were about 90px at the top of every screen restating
     * a name the top bar's breadcrumb already showed. Asserted as an ABSENCE
     * as well as a presence, because the version that still renders them
     * looks perfectly fine — it is only wrong next to the reference and next
     * to every other page.
     */
    render(
      <PageHeader title="تنظیمات سازمان" subtitle="پیکربندی عمومی" actions={<button>عمل</button>} />,
    );
    expect(screen.getByRole("button", { name: "عمل" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText("پیکربندی عمومی")).toBeNull();
  });

  it("PageHeader: renders NOTHING when a page has no actions", () => {
    /* an empty flex row still occupies its margin, which is a gap above
       every page that happens not to have a button */
    const { container } = render(<PageHeader title="بدون عمل" />);
    expect(container.firstChild).toBeNull();
  });

  it("Section: an h2 title and the content — and no description slot at all", () => {
    /*
     * R21 (user ruling 2026-09-05): "remove the guides or explanations from
     * under the titles and headers — just the name". Section used to take a
     * `description` and render it under the h2; the prop is GONE rather than
     * discouraged, so a new section cannot grow a paragraph under its title
     * without failing to typecheck. What this renders is the title and the
     * content, and nothing between them.
     */
    render(
      <PageContainer>
        <Section title="مشخصات سازمان">
          <p>محتوا</p>
        </Section>
      </PageContainer>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "مشخصات سازمان" });
    expect(heading).toBeTruthy();
    expect(screen.getByText("محتوا")).toBeTruthy();
    /* nothing sits between the heading and the content wrapper */
    expect(heading.nextElementSibling?.textContent).toBe("محتوا");
  });
});
