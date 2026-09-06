import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/api/types";
import { MeetingAssistant } from "./MeetingAssistant";

/**
 * THE MEETING PANEL READS THE WHOLE STREAM (2026-09-06, the check-up).
 *
 * The panel consumed `session` and `text_delta` and nothing else. Two
 * consequences a person met: a run that FAILED before its first word left
 * the spinner turning forever (the stream closed cleanly, so the catch never
 * ran and nothing said the run had ended), and a colleague's answer in this
 * thread — an `agent_message` under M48 — was dropped on the floor while
 * the assistant page rendered it. The three cases here are the three frames
 * the old panel could not see; each was RED against it before this landed.
 */
vi.mock("@/lib/recordingEngine", () => ({
  recorderSnapshot: () => ({ phase: "idle", recordedMs: 0, title: "" }),
}));

let queue: AgentEvent[] = [];
let wake: (() => void) | null = null;
let ended = false;

function push(event: AgentEvent): void { queue.push(event); wake?.(); }
function end(): void { ended = true; wake?.(); }

async function* handDriven(): AsyncGenerator<AgentEvent> {
  for (;;) {
    while (queue.length > 0) yield queue.shift()!;
    if (ended) return;
    await new Promise<void>((resolve) => { wake = resolve; });
  }
}

vi.mock("@/api/client", () => ({
  api: { ask: () => handDriven() },
}));

const SPINNER = ".animate-spin";

function ask(): void {
  fireEvent.click(screen.getByRole("button", { name: "این جلسه درباره چه بود؟" }));
}

describe("MeetingAssistant reads the whole stream", () => {
  beforeEach(() => { queue = []; wake = null; ended = false; });

  it("a run that fails before its first word stops the spinner and says so", async () => {
    const { container } = render(<MeetingAssistant callId="call-1" title="جلسهٔ هفتگی" />);
    ask();
    await waitFor(() => expect(container.querySelector(SPINNER)).not.toBeNull());
    push({ type: "session", id: "s-1", created: true });
    push({ type: "done", runId: "r-1", failed: true, error: "model_refused" });
    end();
    await waitFor(() => expect(container.querySelector(SPINNER)).toBeNull());
    expect(screen.getByRole("alert").textContent).toBe("دستیار فعلاً نتوانست پاسخ دهد.");
  });

  it("a colleague's answer lands as her own turn, with her name", async () => {
    render(<MeetingAssistant callId="call-1" title="جلسهٔ هفتگی" />);
    ask();
    push({ type: "session", id: "s-2", created: true });
    push({ type: "text_delta", delta: "خلاصه از اکو." });
    push({ type: "agent_message", author: "roya", name: "رؤیا", text: "و این هم نظر من.", failed: false });
    push({ type: "done", runId: "r-2", failed: false });
    end();
    await waitFor(() => expect(screen.getByText("و این هم نظر من.")).toBeTruthy());
    const hers = screen.getByText("و این هم نظر من.").closest("p")!;
    expect(hers.textContent).toBe("رؤیا:و این هم نظر من.");
    /* the streamed answer is still its own paragraph, unprefixed */
    expect(screen.getByText("خلاصه از اکو.").closest("p")!.textContent).toBe("خلاصه از اکو.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a stream that closes without `done` is a failed run, not a thought that never ends", async () => {
    const { container } = render(<MeetingAssistant callId="call-1" title="جلسهٔ هفتگی" />);
    ask();
    push({ type: "session", id: "s-3", created: true });
    end();
    await waitFor(() => expect(container.querySelector(SPINNER)).toBeNull());
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("THE CONTROL: a run that answers and finishes shows its words and no alert", async () => {
    const { container } = render(<MeetingAssistant callId="call-1" title="جلسهٔ هفتگی" />);
    ask();
    push({ type: "session", id: "s-4", created: true });
    push({ type: "text_delta", delta: "سه تصمیم گرفته شد." });
    push({ type: "done", runId: "r-4", failed: false });
    end();
    await waitFor(() => expect(screen.getByText("سه تصمیم گرفته شد.")).toBeTruthy());
    expect(container.querySelector(SPINNER)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
