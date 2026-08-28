/**
 * SETTINGS' section registry — a plain module, deliberately outside
 * SettingsPane.tsx so that nav.ts (consumed by the rail and the bottom
 * bar) can read it without dragging a client component and its
 * translation hooks into the navigation model.
 *
 * The `href` entries are the CROSS-HOMED surfaces: pages that live at
 * /management/* but wear the Settings pane (Skills, Allowed models).
 * Their breadcrumb says Settings, their menu is Settings' — so the rail
 * must light Settings there too, and it derives "which addresses are
 * Settings' territory" from THIS table (13½: the coverage list comes
 * from the producer), never from a hand-copied list beside the rail.
 */

export type SettingsGroup = "configuration" | "assistant" | "service" | "connections" | "compliance";

export interface SettingsSection {
  slug: string;
  group: SettingsGroup;
  /** an absolute href when the surface lives outside /settings */
  href?: string;
  /** the label comes from another namespace when the page is not ours */
  labelFrom?: "management";
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { slug: "general", group: "configuration" },
  { slug: "assistant", group: "configuration" },
  /* every make-something-for-me-unprompted switch, one screen (user
     directive, 2026-08-28) — beside Assistant, whose two toggles moved
     into it */
  { slug: "notifications", group: "configuration" },
  { slug: "security", group: "configuration" },
  { slug: "sso", group: "configuration" },
  /* the assistant's own configuration — the pages keep their addresses */
  { slug: "skills", group: "assistant", href: "/management/skills", labelFrom: "management" },
  { slug: "models", group: "assistant", href: "/management/models", labelFrom: "management" },
  { slug: "audit-logs", group: "compliance" },
];

const GROUP_ORDER_LIST: readonly SettingsGroup[] = [
  "configuration", "assistant", "service", "connections", "compliance",
];
export const GROUP_ORDER = GROUP_ORDER_LIST;
