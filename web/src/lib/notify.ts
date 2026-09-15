/**
 * The platform notification bus (user directive, 2026-08-21: "all
 * notifications pop up from the orb's head … a small talk just to alarm the
 * user").
 *
 * One module-scoped bus: anything on the platform that wants to inform the
 * person calls notify(); `Toaster` renders the stack and the top-bar bell
 * keeps the recent history. No provider, no context — a notice is
 * fire-and-forget, and the two consumers must not depend on mounting order.
 *
 * The orb the stack used to pop from left on 2026-09-03 with the rest of the
 * dock's chrome; the notices did not move, only what they are anchored to.
 * On 2026-09-08 they moved for the first time: the stack left the assistant
 * entirely (see `components/platform/Toaster.tsx`) and rises from the middle
 * of the screen, because a message about the whole system was being drawn by
 * the assistant's own component and therefore inherited its corner, its
 * z-index and its mounting.
 *
 * FOUR KINDS, NOT TWO (2026-09-08). "info" and "warn" could not say the two
 * things the product says most often — *that worked* and *that failed* — so
 * every success was an "info" that looked like a hint and every failure was a
 * "warn" that looked like a caution. The kind is what picks the icon and its
 * tone in the toast, so a kind that cannot tell those apart is a toast that
 * cannot either.
 *
 *   success  it worked          green check
 *   info     for your awareness blue i
 *   warn     look at this       amber triangle
 *   error    it failed          red cross
 *
 * The two old names still mean what they meant, so no existing call site
 * changed meaning when the set grew.
 */

export type NoticeKind = "success" | "info" | "warn" | "error";

export interface PlatformNotice {
  id: string;
  text: string;
  kind: NoticeKind;
  at: number;
  /** how many times this exact sentence has been raised in one burst; 1 for
      almost every notice, and see REPEATS below for the ones it is not */
  count: number;
}

type Listener = (notice: PlatformNotice) => void;
type DismissListener = (id: string) => void;

const listeners = new Set<Listener>();
const dismissListeners = new Set<DismissListener>();
const history: PlatformNotice[] = [];
const HISTORY_CAP = 50;

let seq = 0;

/**
 * REPEATS COLLAPSE (user report, 2026-09-08: "fix issues where the same
 * message is used multiple time in the same time").
 *
 * One action on this platform is routinely several writes. Moving four cards
 * between columns is four PATCHes; setting six people on a project is six
 * calls; a dead connection fails all of them. Every one of those `.catch()`
 * arms says the same sentence, so a single outage drew the same words three
 * times over — and the stack caps at three, which meant one repeated
 * sentence could push out the *other* message a person actually needed.
 *
 * So a repeat is not a second notice. Within the window below, the same text
 * in the same kind is THE SAME NOTICE: its id is reused, its `count` goes up,
 * its clock restarts. Re-emitting it (rather than staying silent) is what
 * lets the stack refresh the card's timer — the fifth failure of a burst
 * should not vanish four seconds after the first.
 *
 * The window is longer than the longest card's life on purpose. If it were
 * shorter, a notice could still be on screen while a repeat of it counted as
 * new — which is the exact duplicate this exists to stop, arriving late.
 *
 * THE COUNT IS SHOWN rather than swallowed. Four refused writes collapsed
 * into one card that says nothing about being four is a screen quietly
 * deciding the person did not need to know how much failed.
 */
const REPEAT_WINDOW_MS = 8_000;

export function notify(text: string, kind: NoticeKind = "info"): PlatformNotice {
  const now = Date.now();
  const repeated = history.find(
    (row) => row.text === text && row.kind === kind && now - row.at < REPEAT_WINDOW_MS,
  );
  if (repeated !== undefined) {
    /*
     * A NEW OBJECT, not a mutated one, and this is load-bearing rather than
     * hygiene. `notifyHistory()` hands out a shallow copy of the array, so
     * every notice it has ever returned is the same object as the one in
     * here — bumping `count` in place would edit a record a caller is
     * already holding. React is the caller that makes it a bug: the stack
     * keeps notices in state, and a listener handed back the SAME reference
     * changes nothing it can see, so the count would go up and the card
     * would not.
     *
     * The ID is what is kept. That is the whole handle: it is how the stack
     * recognises the card already standing and restarts its clock instead of
     * pushing a second one.
     */
    const bumped: PlatformNotice = { ...repeated, at: now, count: repeated.count + 1 };
    /* to the FRONT of the history: the bell lists newest first, and a
       sentence that just recurred is the newest thing that happened */
    history.splice(history.indexOf(repeated), 1);
    history.unshift(bumped);
    for (const listener of listeners) listener(bumped);
    return bumped;
  }
  const notice: PlatformNotice = { id: `n-${now}-${seq++}`, text, kind, at: now, count: 1 };
  history.unshift(notice);
  if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
  for (const listener of listeners) listener(notice);
  return notice;
}

/* The three shorthands the call sites actually want. `notify(x, "error")`
   reads as a kind chosen from a list; `notifyError(x)` reads as the thing
   that happened — and the second is what a call site at the bottom of a
   failed save is trying to say. */
export const notifySuccess = (text: string): PlatformNotice => notify(text, "success");
export const notifyWarn = (text: string): PlatformNotice => notify(text, "warn");
export const notifyError = (text: string): PlatformNotice => notify(text, "error");

export function subscribeNotify(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Close one toast from anywhere — the X on the card, and any caller that
 * raised a notice for a condition that has since cleared.
 *
 * It does NOT touch the history: the bell's list is a record of what was
 * said, and closing the card you were shown is not a claim that it was never
 * said. The two lists disagreeing here is the point, not a bug.
 */
export function dismissNotice(id: string): void {
  for (const listener of dismissListeners) listener(id);
}

export function subscribeDismiss(listener: DismissListener): () => void {
  dismissListeners.add(listener);
  return () => dismissListeners.delete(listener);
}

/** newest first; a copy — callers must not be able to edit the record */
export function notifyHistory(): PlatformNotice[] {
  return [...history];
}

/** The bell's "clear" — empties the history. The bell re-reads on its own
 *  (it is the only renderer of the history); listeners are per-NOTICE and
 *  stay untouched — clearing the list is not unsubscribing from the future. */
export function clearNotifications(): void {
  history.length = 0;
}

/** test seam only — the bus is module state and tests share the module */
export function resetNotifications(): void {
  listeners.clear();
  dismissListeners.clear();
  history.length = 0;
}
