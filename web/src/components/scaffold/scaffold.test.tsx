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

  it("the SECTION SCROLL's height is derived from the same block", () => {
    /* one number, one home: the height a section body ends at is
       `SCAFFOLD.page.sectionReserve`, and the theme emits it in the rem the
       rest of the chrome is measured in. A hand-typed calc on either side
       goes red here — verified by changing the constant and watching this
       fail. */
    expect(theme.maxHeight.section)
      .toBe(`calc(100dvh - ${rem(SCAFFOLD.page.sectionReserve)})`);
  });

  it("keeps the menu heading and the page title on one line", () => {
    /*
     * The pair is a RELATIONSHIP, not two numbers: a 17px pane title sits
     * 12px lower than a 24px page title to share its line (user directive,
     * 2026-08-18). Asserting the gap means raising the page's top margin
     * cannot silently leave the menu heading behind — which is precisely
     * what a later "just add some space" edit would do.
     */
    expect(SCAFFOLD.page.top - SCAFFOLD.page.menuTop).toBe(12);
  });

  it("dimensions: menu, rail, content columns, controls, top bar", () => {
    expect(theme.width.menu).toBe(rem(SCAFFOLD.menuWidth));
    expect(theme.width.rail).toBe(rem(SCAFFOLD.railWidth));
    expect(theme.maxWidth.content).toBe(rem(SCAFFOLD.contentMaxWidth));
    expect(theme.maxWidth["content-wide"]).toBe(rem(SCAFFOLD.contentMaxWidthWide));
    expect(theme.height.control).toBe(rem(SCAFFOLD.controlHeight));
    expect(theme.minHeight.control).toBe(rem(SCAFFOLD.controlHeight));
    expect(theme.height.topbar).toBe(rem(SCAFFOLD.topBarHeight));
  });

  it("the page/section title sizes ride Tailwind defaults — pinned so a future theme edit cannot silently shrink them", () => {
    // text-2xl = 24px and text-xl = 20px are DEFAULTS the blueprint relies on;
    // overriding fontSize['2xl'/'xl'] in the theme would change every page
    // title at once. This pins the reliance: if someone adds an override, one
    // of these goes red and the blueprint conversation happens first.
    expect(theme.fontSize["2xl"]).toBeUndefined();
    expect(theme.fontSize.xl).toBeUndefined();
    expect(SCAFFOLD.fontSize.pageTitle).toBe(24);
    expect(SCAFFOLD.fontSize.sectionTitle).toBe(20);
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

  it("takes its height from the theme, never a literal of its own", () => {
    /* the fork this component exists to prevent: `max-h-[calc(…)]` written
       at a call site. If the class ever becomes a literal here, the rhythm
       guard cannot see it (it polices the NAME) — so the name is pinned. */
    const { container } = render(<SectionScroller><p>x</p></SectionScroller>);
    const classes = (container.firstElementChild as HTMLElement).className.split(" ");
    expect(classes).toContain("max-h-section");
    expect(classes).toContain("overflow-y-auto");
    expect(classes.filter((c) => c.startsWith("max-h-["))).toEqual([]);
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
  it("PageHeader: h1 title, subtitle under it, actions when given", () => {
    render(
      <PageHeader title="تنظیمات سازمان" subtitle="پیکربندی عمومی" actions={<button>عمل</button>} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "تنظیمات سازمان" })).toBeTruthy();
    expect(screen.getByText("پیکربندی عمومی")).toBeTruthy();
    expect(screen.getByRole("button", { name: "عمل" })).toBeTruthy();
  });

  it("Section: h2 title + description; content renders", () => {
    render(
      <PageContainer>
        <Section title="مشخصات سازمان" description="نام و شناسه.">
          <p>محتوا</p>
        </Section>
      </PageContainer>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "مشخصات سازمان" })).toBeTruthy();
    expect(screen.getByText("نام و شناسه.")).toBeTruthy();
    expect(screen.getByText("محتوا")).toBeTruthy();
  });
});
