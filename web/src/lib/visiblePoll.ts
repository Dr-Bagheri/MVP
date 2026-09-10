/**
 * A POLL THAT SLEEPS WITH THE TAB (2026-09-10).
 *
 * Measured on production over three days: `GET /v1/invites` was asked 4,276
 * times — eleven times the next route — by one thirty-second interval in the
 * meeting-invitation gate, running in every open tab whether anybody was
 * looking at it or not. A hidden tab cannot show the dialog it is polling
 * for, so every one of those reads bought nothing.
 *
 * `run` fires every `everyMs` while the document is visible and not at all
 * while it is hidden. Coming back to a tab that has been hidden for longer
 * than the interval runs ONCE, at once — that is the moment a person would
 * notice a missing question — and a shorter absence runs nothing extra,
 * because a poll that fires on every tab switch is the thirty-second
 * interval wearing a different trigger. The browser already throttles hidden
 * intervals to about a minute; this stops them, and makes the catch-up
 * explicit rather than whenever the throttled timer happened to land.
 *
 * The caller's own first read (on mount) is not this module's: it starts the
 * clock from now and never runs `run` at zero.
 */
export function visiblePoll(run: () => void, everyMs: number, doc: Document = document): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = Date.now();

  const tick = () => {
    last = Date.now();
    run();
  };
  const arm = () => {
    if (timer === null) timer = setInterval(tick, everyMs);
  };
  const disarm = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") {
      disarm();
      return;
    }
    if (Date.now() - last >= everyMs) tick();
    arm();
  };

  if (doc.visibilityState !== "hidden") arm();
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    disarm();
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
