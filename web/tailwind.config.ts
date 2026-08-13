import type { Config } from "tailwindcss";

/**
 * Echo design system — tokens only here; every value is a CSS variable so
 * light/dark switch without a second Tailwind theme (see globals.css).
 * Style direction: "Soft UI Evolution" (ui-ux-pro-max, mandated) — subtle
 * depth, clear contrast, WCAG AA+.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        "fg-muted": "rgb(var(--fg-muted) / <alpha-value>)",
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
        info: "rgb(var(--info) / <alpha-value>)",
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "10px",
        md: "12px",
        lg: "16px",
        xl: "20px",
      },
      boxShadow: {
        // soft-UI depth: two-layer, never heavy
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
