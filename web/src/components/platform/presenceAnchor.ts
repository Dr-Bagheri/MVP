/**
 * The assistant owns itself; the shell only offers it a visual anchor.
 * Keeping this as a tiny external store lets `AssistantSidebar` survive
 * route/shell changes without moving voice, conversation or unread state into
 * TopBar. (Implementation extracted to anchorStore.ts when the mini recorder
 * needed the same shape; the exported names here are unchanged.)
 *
 * What portals through it changed on 2026-09-03 — the orb became the sidebar's
 * trigger, and the slot is now hidden from `md` up, where the sidebar's own
 * collapsed rail carries the door. The store did not change with it: the seam
 * is "a component places one element inside the bar", whichever element that is.
 */
import { createAnchorStore } from "./anchorStore";

const store = createAnchorStore();

export const registerPresenceAnchor = store.register;
export const subscribePresenceAnchor = store.subscribe;
export const getPresenceAnchorSnapshot = store.getSnapshot;
export const getServerPresenceAnchorSnapshot = store.getServerSnapshot;
