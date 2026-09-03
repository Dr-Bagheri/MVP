/**
 * One place the wire's free-ish `icon`/`color` strings become something the
 * theme can render (M47). Three surfaces show an agent's mark — the browse
 * cards, the editor's picker, and the hub's overview panel — and each keeping
 * its own map is how the same agent ends up three different colours.
 *
 * Icons resolve into the platform's ONE registry (`@/components/icons`) —
 * never an emoji sea, never a text glyph doing icon work (the ＋/✕ lesson).
 * The picker OFFERS registry names, so anything a person chooses here is
 * stored verbatim and renders everywhere; the LEGACY spellings are what
 * db/0065 seeded (`sparkles`, `chart`, `clipboard`, …) and must keep
 * rendering forever, because the rows already exist.
 */
import type { IconName } from "@/components/icons";

const ICON_BY_WIRE: Record<string, IconName> = {
  /* what the picker stores — registry names, verbatim */
  sparkle: "sparkle", agent: "agent", pulse: "pulse", fileText: "fileText",
  tag: "tag", chip: "chip", gavel: "gavel", ask: "ask", search: "search",
  mail: "mail", calendar: "calendar", users: "users", globe: "globe", zap: "zap",
  /* what db/0065 seeded — mapped onto the nearest registry glyph */
  sparkles: "sparkle",   // the column default
  chart: "pulse",        // sales
  clipboard: "fileText", // customer support
  badge: "tag",          // hr
  shield: "chip",        // it support
  briefcase: "gavel",    // legal
  message: "ask",        // marketing
};

/** Any stored string renders; an unknown one falls back to the seed default
    rather than a blank tile — absence of a glyph would read as a broken card. */
export function agentIconName(wire: string): IconName {
  return ICON_BY_WIRE[wire] ?? "sparkle";
}

/** The compact set the editor offers. A subset on purpose: legacy spellings
    stay renderable above but are not offered twice under two names. */
export const AGENT_ICON_CHOICES: readonly IconName[] = [
  "sparkle", "agent", "pulse", "fileText", "tag", "chip", "gavel",
  "ask", "search", "mail", "calendar", "users", "globe", "zap",
];

/*
 * Colours are THEME PAIRS, not hex: the exact classes Chip's tone map uses,
 * so an agent tile and a status chip built from the same tone can never
 * disagree between themes. (The previous map said `bg-warning-soft` /
 * `bg-success-soft` — classes with no config entry, silently no background:
 * the --on-accent shape, markup reading as satisfied while the computed
 * value disagrees.)
 */
const COLOR_BY_WIRE: Record<string, string> = {
  violet: "bg-accent-soft text-accent", // the column default
  blue: "bg-info/15 text-info",
  orange: "bg-warning/15 text-warning",
  lime: "bg-success/15 text-success",
  green: "bg-success/15 text-success",  // db/0065 seeds hr/it with `green`
  slate: "bg-surface-2 text-fg-muted",  // db/0065 seeds legal/marketing/product
};

export function agentColorClasses(wire: string): string {
  return COLOR_BY_WIRE[wire] ?? COLOR_BY_WIRE.violet!;
}

/** What the editor offers — one entry per DISTINCT rendering (green would be
    a second name for lime's pair, and two names for one colour is drift). */
export const AGENT_COLOR_CHOICES = ["violet", "blue", "orange", "lime", "slate"] as const;

/** The level chip's tone, shared by the cards, the editor and the hub panel. */
export function agentLevelTone(level: string): "info" | "accent" {
  return level === "system" ? "info" : "accent";
}

/**
 * One tool's human sentence, from the message catalogue's `agents.tool`
 * object (read via `t.raw` at the call site — a per-key `t()` would return
 * the key path for a tool the catalogue has not met yet, and a key path is
 * not a sentence). Unknown names fall back to the name itself, spaced:
 * the vocabulary is served by core and may grow ahead of this file.
 */
export function toolDescription(copy: Record<string, unknown>, name: string): string {
  const sentence = copy[name];
  return typeof sentence === "string" ? sentence : name.replaceAll("_", " ");
}

/**
 * Shipped agents' copy, localized by HANDLE (the workflowName.ts shape).
 *
 * Simpler than the workflow resolver on purpose: a SYSTEM agent cannot be
 * renamed (core's PATCH refuses level system outright), so its name is
 * always product copy and there is no your-name-wins gate to build. Org and
 * user agents render exactly as their authors wrote them, in every locale.
 * A system handle the catalogue has not met falls back to the wire —
 * visible and untranslated beats invisible and broken.
 */
import { useTranslations } from "next-intl";

/*
 * TWO AGENTS, NOT EIGHT (user directive, 2026-09-03, db/0163). The eight that
 * were here — meetings, mail, prep, sales, interview, manager, recorder,
 * commitments — were JOBS rather than colleagues: near-identical read tools,
 * prompts differing mainly in which caution they recite, and no name a person
 * could say. Nobody asks what the meetings agent thought; they ask somebody.
 *
 * رؤیا ACTS (drafts the reply, prepares the brief, makes the task) and آوا
 * READS (what changed, what is slipping, what a week of meetings said). The
 * split is by VERB, which is the user's choice among the three offered.
 *
 * The names come through the CATALOGUE and not off the wire, for the reason
 * seededCopy.guard.test.ts exists: the database holds one spelling, and a
 * name served straight from it renders Persian to an English reader and
 * nothing goes red — the resolver falls back to the stored string on purpose.
 */
const SYSTEM_AGENT_KEYS: Readonly<Record<string, string>> = {
  roya: "sys_roya",
  ava: "sys_ava",
};

export function useAgentCopy(): (agent: {
  level: string; handle: string; name: string; description: string;
}) => { name: string; description: string } {
  const t = useTranslations("agents");
  return (agent) => {
    const key = agent.level === "system" ? SYSTEM_AGENT_KEYS[agent.handle] : undefined;
    if (!key) return { name: agent.name, description: agent.description };
    try {
      return { name: t(`${key}_name`), description: t(`${key}_desc`) };
    } catch {
      return { name: agent.name, description: agent.description };
    }
  };
}
