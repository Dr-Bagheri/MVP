/**
 * The mini recorder's slot in the top bar (user directive, 2026-08-23:
 * "keep it at top menu next to the calendar and time, at the last position
 * toward the center"). The recorder pill owns its state and controls; the
 * bar only offers it this anchor. Screens without the bar (the platform
 * console, auth) register nothing, and the pill falls back to floating —
 * a live mic must never be invisible.
 */
import { createAnchorStore } from "./anchorStore";

const store = createAnchorStore();

export const registerRecorderAnchor = store.register;
export const subscribeRecorderAnchor = store.subscribe;
export const getRecorderAnchorSnapshot = store.getSnapshot;
export const getServerRecorderAnchorSnapshot = store.getServerSnapshot;
