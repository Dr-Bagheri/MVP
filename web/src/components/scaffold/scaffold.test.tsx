import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

const { SectionMenu } = await import("./SectionMenu");
const { FormPanel, FormRow, PanelFooter } = await import("./FormPanel");
const { PageContainer, PageHeader, Section } = await import("./Page");

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
