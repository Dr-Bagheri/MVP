/**
 * The dock owns the assistant; the shell only offers it a visual anchor.
 * Keeping this as a tiny external store lets PresenceDock survive route/shell
 * changes without moving voice, conversation or unread state into TopBar.
 * (Implementation extracted to anchorStore.ts when the mini recorder needed
 * the same shape; the exported names here are unchanged.)
 */
import { createAnchorStore } from "./anchorStore";

const store = createAnchorStore();

export const registerPresenceAnchor = store.register;
export const subscribePresenceAnchor = store.subscribe;
export const getPresenceAnchorSnapshot = store.getSnapshot;
export const getServerPresenceAnchorSnapshot = store.getServerSnapshot;
