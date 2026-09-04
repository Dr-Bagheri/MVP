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
 * REWRITTEN 2026-09-04 (user directive: "update the help we have in help
 * section — for each section make a new help because we changed it a lot,
 * remove the old one").
 *
 * The guide had gone stale in the way documentation always does: it described
 * a three-root platform (Assistant, Echo, Management) that no longer exists.
 * Echo is gone as a surface, meetings and tasks became first-class sections,
 * and projects and chat are new. So the list below is the RAIL, in the rail's
 * own order — which is the property that keeps this honest: a section
 * somebody can navigate to and cannot read about is a gap, and a section here
 * with nowhere to go is a page describing a product we do not ship.
 *
 * The order matters for a second reason: this is also the reading order for
 * somebody new, and it runs from the shell they are looking at, through the
 * work they came to do, out to the things they configure once.
 */
export const HELP_SECTIONS = [
  { slug: "overview", group: "start", steps: 5 },
  { slug: "assistant", group: "parts", steps: 6 },
  { slug: "meetings", group: "parts", steps: 6 },
  { slug: "tasks", group: "parts", steps: 6 },
  { slug: "projects", group: "parts", steps: 5 },
  { slug: "chat", group: "parts", steps: 5 },
  { slug: "workflows", group: "parts", steps: 6 },
  { slug: "integrations", group: "parts", steps: 5 },
  { slug: "agents", group: "parts", steps: 5 },
  { slug: "management", group: "parts", steps: 5 },
  { slug: "settings", group: "parts", steps: 6 },
] as const;

export type HelpSlug = (typeof HELP_SECTIONS)[number]["slug"];

export const HELP_GROUPS = ["start", "parts"] as const;
