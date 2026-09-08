import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Item 7 — the live meeting's second brain, from the page's side.
 *
 * Every assertion here is about NOT BEING ANNOYING, which is the whole
 * client-side design: the server decides what is relevant, and this decides
 * how often it may be asked and how often the same answer may be shown.
 *
 * The tests that carry the file are the ones where nothing must happen —
 * a colleague's screen, a meeting with no take rolling, a window that has
 * not moved, a card already dismissed. A version that asks every render and
 * re-shows every hit passes every positive assertion and is unusable.
 */

const recallDecisions = vi.fn();

vi.mock("@/api/client", () => ({
  api: { recallDecisions: (...a: unknown[]) => recallDecisions(...a) },
}));

const { useLiveRecall } = await import("./liveRecall");

const decision = (over: Record<string, unknown> = {}) => ({
  id: "d-1", kind: "decision", body: "قرارداد با شرکت الف امضا می‌شود",
  status: "standing", meeting_id: "m-9", meeting_title: "جلسهٔ مرداد",
  decided_at: "2026-08-15T09:00:00.000Z", owner_id: null, due_on: null,
  shared: 3, ...over,
});

/** a harness that renders the hook and lets a test drive its inputs */
function Harness({ text, enabled }: { text: string; enabled: boolean }) {
  const recall = useLiveRecall("m-now", text, enabled);
  return (
    <div>
      <ul>{recall.cards.map((c) => <li key={c.id} data-id={c.id}>{c.body}</li>)}</ul>
      <button type="button" onClick={() => recall.dismiss("d-1")}>dismiss</button>
    </div>
  );
}

/* the throttle is a clock, so the clock is the test's to move.
   LONGER THAN THE 700-CHARACTER WINDOW ON PURPOSE: the first version repeated
   twenty times, which is 340 characters, so the tail-slice had nothing to cut
   and the test that asserts it could not fail. */
const LONG = "قرارداد شرکت الف ".repeat(60);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  recallDecisions.mockReset();
  recallDecisions.mockResolvedValue([decision()]);
});
afterEach(() => { vi.useRealTimers(); });

describe("what the room already decided", () => {
  it("asks once the window has enough new words, and shows what came back", async () => {
    render(<Harness text={LONG} enabled />);
    await waitFor(() => expect(recallDecisions).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/قرارداد با شرکت الف/)).toBeInTheDocument();
    /* the tail, not the whole transcript: a full meeting matches everything
       eventually, and recall becomes a list of every decision ever taken */
    const sent = String(recallDecisions.mock.calls[0]![1]);
    expect(sent.length).toBeLessThanOrEqual(700);
    /* .trim() first: the hook trims before it slices, and asserting against
       the untrimmed constant fails by one space — my assertion, not the code */
    expect(LONG.trim().endsWith(sent)).toBe(true);
  });

  it("asks NOTHING for a colleague", async () => {
    /* not a permission — the server would answer them. It is about
       interruption: a card on ten screens is a broadcast, and a wrong one is
       a public wrong statement somebody has to correct out loud. */
    render(<Harness text={LONG} enabled={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(recallDecisions).not.toHaveBeenCalled();
  });

  it("asks nothing while the window has not moved", async () => {
    const { rerender } = render(<Harness text={LONG} enabled />);
    await waitFor(() => expect(recallDecisions).toHaveBeenCalledTimes(1));
    /* twelve seconds pass and nobody has said anything new: the same words
       cannot produce a new answer, and asking anyway is a request per tick
       for the length of the meeting */
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    rerender(<Harness text={`${LONG} `} enabled />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(recallDecisions).toHaveBeenCalledTimes(1);
  });

  it("asks nothing again until the throttle has passed, however much is said", async () => {
    const { rerender } = render(<Harness text={LONG} enabled />);
    await waitFor(() => expect(recallDecisions).toHaveBeenCalledTimes(1));
    /* plenty of new words, no time: the other half of the pair, and the one
       a talkative meeting would otherwise defeat */
    rerender(<Harness text={LONG + LONG} enabled />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(recallDecisions).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    rerender(<Harness text={`${LONG}${LONG} پروژهٔ دیتابیس صوتی`} enabled />);
    await waitFor(() => expect(recallDecisions).toHaveBeenCalledTimes(2));
  });

  it("never shows the same decision twice", async () => {
    const { rerender } = render(<Harness text={LONG} enabled />);
    await waitFor(() => expect(screen.getAllByText(/قرارداد با شرکت الف/)).toHaveLength(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    rerender(<Harness text={`${LONG} ${LONG}`} enabled />);
    await waitFor(() => expect(recallDecisions).toHaveBeenCalledTimes(2));
    /* the server keeps matching it — the room is still on the subject — and
       the second appearance of a card somebody has read is what teaches them
       to stop reading them */
    await waitFor(() => expect(screen.getAllByText(/قرارداد با شرکت الف/)).toHaveLength(1));
  });

  it("takes a dismissed card off the screen, and show-once keeps it off", async () => {
    /* the guarantee is SHOW-ONCE, not the dismissal: an id reaches `seen` the
       moment it is drawn, so dismissing only has to handle the screen. That
       is asserted here rather than assumed, because the two used to be two
       lines and one of them could never fail. */
    const { rerender } = render(<Harness text={LONG} enabled />);
    await screen.findByText(/قرارداد با شرکت الف/);
    await userEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(screen.queryByText(/قرارداد با شرکت الف/)).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    rerender(<Harness text={`${LONG} ${LONG}`} enabled />);
    await waitFor(() => expect(recallDecisions).toHaveBeenCalledTimes(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByText(/قرارداد با شرکت الف/)).toBeNull();
  });

  it("says nothing when the read fails", async () => {
    /* recall is a courtesy. A red line on the stage about a background read
       nobody asked for is worse than the silence it replaces. */
    recallDecisions.mockRejectedValue(new Error("upstream"));
    render(<Harness text={LONG} enabled />);
    await waitFor(() => expect(recallDecisions).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("keeps at most three on screen", async () => {
    recallDecisions.mockResolvedValue([
      decision({ id: "d-1", body: "یک" }), decision({ id: "d-2", body: "دو" }),
      decision({ id: "d-3", body: "سه" }), decision({ id: "d-4", body: "چهار" }),
    ]);
    render(<Harness text={LONG} enabled />);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
