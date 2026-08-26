import type { Config } from "tailwindcss";
import { SCAFFOLD } from "./src/components/scaffold/constants";

/**
 * NeurAI design system — tokens only here; every color is a CSS variable so
 * light/dark switch without a second Tailwind theme (see globals.css).
 *
 * Sizes and shape DERIVE from the M26 scaffold constants (the approved
 * blueprint's numbers) — scaffold.test.tsx asserts this file and constants.ts
 * agree, so neither can be hand-edited into a fork of the other.
 */
/**
 * Blueprint px → rem (÷16). The scaffold's numbers stay recorded in px — the
 * form the approved blueprint uses — but the THEME emits rem so every role
 * tracks the root font-size, which globals.css now scales with the viewport
 * (user directive, 2026-08-18: the platform must not fall apart across
 * monitor sizes). One 4K monitor and one 13" laptop render the same
 * PROPORTIONS; px-emitting entries would keep the menus and titles frozen
 * while the text around them scaled.
 */
const rem = (px: number) => `${px / 16}rem`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        /*
         * REGISTERED, not just declared in globals.css. A CSS variable with no
         * entry here produces a class that emits nothing — `text-on-accent`
         * shipped exactly that way once: markup read as fixed, computed value
         * unchanged, contrast measurably WORSE than the bug it replaced. If a
         * token is added to globals.css, it is added here in the same commit.
         */
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        "fg-muted": "rgb(var(--fg-muted) / <alpha-value>)",
        "fg-subtle": "rgb(var(--fg-subtle) / <alpha-value>)",
        primary: "rgb(var(--primary) / <alpha-value>)",
        "on-primary": "rgb(var(--on-primary) / <alpha-value>)",
        secondary: "rgb(var(--secondary) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        sidebar: "rgb(var(--sidebar) / <alpha-value>)",
        "sidebar-fg": "rgb(var(--sidebar-fg) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "on-accent": "rgb(var(--on-accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        "on-danger": "rgb(var(--on-danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        /* the record button's own red — softer than danger, which has to
           stay loud because it marks destructive choices */
        record: "rgb(var(--record) / <alpha-value>)",
      },
      /*
       * M26 shape: controls 6 / panels 8 / tiles 12 / modals 16. The class
       * NAMES existing code already wears keep their meaning (.input and .btn
       * wear rounded-md, cards wear rounded-lg) — the VALUES tightened to the
       * approved Supabase-anatomy scale. md < lg still holds (6 < 8).
       */
      borderRadius: {
        sm: "4px",
        DEFAULT: `${SCAFFOLD.radius.panel}px`,
        md: `${SCAFFOLD.radius.control}px`,
        lg: `${SCAFFOLD.radius.panel}px`,
        xl: `${SCAFFOLD.radius.tile}px`,
        "2xl": `${SCAFFOLD.radius.modal}px`,
      },
      fontSize: {
        "pane-title": [rem(SCAFFOLD.fontSize.paneTitle), "1.6"],
        "menu-item": [rem(SCAFFOLD.fontSize.menuItem), "1.7"],
        detail: [rem(SCAFFOLD.fontSize.detail), "1.7"],
        "group-label": [rem(SCAFFOLD.fontSize.groupLabel), "1.5"],
      },
      /* One optical line box for text inside controls. This is a theme token,
         not an AvatarMenu exception: centered controls need the same glyph
         metrics in both light and dark themes. */
      lineHeight: {
        control: "1.25",
      },
      width: {
        menu: rem(SCAFFOLD.menuWidth),
        rail: rem(SCAFFOLD.railWidth),
      },
      maxWidth: {
        content: rem(SCAFFOLD.contentMaxWidth),
        "content-wide": rem(SCAFFOLD.contentMaxWidthWide),
      },
      height: {
        control: rem(SCAFFOLD.controlHeight),
        topbar: rem(SCAFFOLD.topBarHeight),
      },
      minHeight: {
        control: rem(SCAFFOLD.controlHeight),
      },
      boxShadow: {
        // soft depth: two-layer, never heavy
        card: "0 1px 2px rgb(2 6 23 / 0.04), 0 4px 12px rgb(2 6 23 / 0.06)",
        pop: "0 2px 6px rgb(2 6 23 / 0.08), 0 12px 32px rgb(2 6 23 / 0.12)",
      },
      fontFamily: {
        sans: ["var(--font-vazirmatn)", "system-ui", "sans-serif"],
      },
      transitionDuration: { DEFAULT: "200ms" },
    },
  },
  plugins: [],
};

export default config;
