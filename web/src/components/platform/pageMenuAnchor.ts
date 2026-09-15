/**
 * The top bar's START slot, below `lg`: one page-owned menu button.
 *
 * The same seam as `presenceAnchor` — a shell offers an element, a page places
 * one control inside it — for the other end of the bar. It exists because the
 * hamburger that opens Home's conversations column had to move UP a row (user
 * directive, 2026-09-09: "move the hamburger to the above row in mobile"): it
 * was rendering as its own strip under the bar, which spent a whole row of a
 * phone screen on one 28px square while the bar beside it had empty space at
 * exactly that end.
 *
 * A store rather than a prop, for the reason the presence cradle is one: the
 * page and the bar are not in a parent/child line — `TopBar` is the shell's,
 * the button is Home's, and threading it through the shell would put a Home
 * concern in every route's layout.
 */
import { createAnchorStore } from "./anchorStore";

const store = createAnchorStore();

export const registerPageMenuAnchor = store.register;
export const subscribePageMenuAnchor = store.subscribe;
export const getPageMenuAnchorSnapshot = store.getSnapshot;
export const getServerPageMenuAnchorSnapshot = store.getServerSnapshot;
