/**
 * The help guide's table of contents — one entry per section page.
 *
 * This lives outside the page file so the colocated test derives its
 * coverage from the producer's own list rather than hand-enumerating it
 * (rule 13½: a guard's coverage list is itself a seam). Adding a section
 * here without its `help.section.*`, `help.desc.*` and `help.s.*.stepN`
 * keys in BOTH catalogues fails that test — the step keys are computed at
 * render time, so `keys.test.ts` deliberately cannot see them.
 *
 * Rewritten 2026-08-28 (user directive): the guide now describes the
 * three-root platform — Assistant (with Workflows, Integrations and Agents
 * under its menu), Echo, Management — plus Settings & profile.
 */
export const HELP_SECTIONS = [
  { slug: "overview", group: "start", steps: 5 },
  { slug: "assistant", group: "parts", steps: 6 },
  { slug: "workflows", group: "parts", steps: 6 },
  { slug: "integrations", group: "parts", steps: 5 },
  { slug: "agents", group: "parts", steps: 5 },
  { slug: "echo", group: "parts", steps: 6 },
  { slug: "management", group: "parts", steps: 5 },
  { slug: "settings", group: "parts", steps: 6 },
] as const;

export type HelpSlug = (typeof HELP_SECTIONS)[number]["slug"];

export const HELP_GROUPS = ["start", "parts"] as const;
