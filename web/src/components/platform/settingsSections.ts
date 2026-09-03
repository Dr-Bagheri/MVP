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
  labelFrom?: "management" | "platform";
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { slug: "general", group: "configuration" },
  { slug: "assistant", group: "configuration" },
  /* every make-something-for-me-unprompted switch, one screen (user
     directive, 2026-08-28) — beside Assistant, whose two toggles moved
     into it */
  { slug: "notifications", group: "configuration" },
  { slug: "security", group: "configuration" },
  /* SIGN-IN METHODS LEFT THIS MENU (user directive, 2026-09-02: "remove
     sign-in methods from the settings"). The page still resolves at its own
     address — what a menu offers and what the router serves are different
     questions, and only the first one was asked, exactly as with Skills. */
  /* INTEGRATIONS LEFT THIS MENU (user directive, 2026-09-03: "i need the
     integrations to come to the menu from the setting under the agents").
     [SUPERSEDES the 2026-09-02 directive that put it here. Left visible
     rather than deleted: the reason it came — a connection is org
     configuration — is a real argument, and the record of a decision
     changing is worth more than a file that reads as though it was always
     this way. What decided it the other way is that an agent without its
     connections can do nothing, so the two belong within one glance.]
     Its page keeps its address; only the door moved. */
  /* the assistant's own configuration — the pages keep their addresses.
     SKILLS LEFT THIS MENU (user directive, same round). Its page still
     resolves at /management/skills, exactly as every other row this menu
     has dropped: what a menu offers and what the router serves are
     different questions, and only the first one was asked. */
  { slug: "models", group: "assistant", href: "/management/models", labelFrom: "management" },
  { slug: "audit-logs", group: "compliance" },
];

const GROUP_ORDER_LIST: readonly SettingsGroup[] = [
  "configuration", "assistant", "service", "connections", "compliance",
];
export const GROUP_ORDER = GROUP_ORDER_LIST;
