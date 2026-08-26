/**
 * The red stop-and-delete (user directive, 2026-08-23): it must CONFIRM —
 * the first press only arms it; the negative controls are the point (an
 * armed button that fires on the first press, or a "keep recording" that
 * still discards, would each destroy a meeting on a slip).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const discardRecording = vi.fn(async () => ({ deleted: true }));
const snapshot = {
  phase: "recording", callId: "c-1", title: "Meeting 2", recordedMs: 26_000,
  level: 0, wave: [], waveStartMs: 0, chapterMarks: [], quality: null,
  progress: { done: 0, pending: 0, failed: 0 }, error: null,
  captions: null, captionsDown: false, previews: [],
};
vi.mock("@/lib/recordingEngine", () => ({
  subscribeRecorder: () => () => undefined,
  recorderSnapshot: () => snapshot,
  discardRecording: () => discardRecording(),
  addChapterMark: vi.fn(),
  finish: vi.fn(async () => undefined),
  pause: vi.fn(),
  resume: vi.fn(),
  resetRecorder: vi.fn(),
  retryUploads: vi.fn(async () => undefined),
  startRecording: vi.fn(async () => undefined),
}));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/api/client", () => ({
  api: {
    /* the model dropdown's read (0099): this suite is about the discard
       flow, but a mock missing a method the component calls does not fake
       "no models" — it throws, and the failure arrives as whatever
       rendered last. The stub answers the empty case on purpose. */
    models: async () => ({ models: [], preferred_model: null, curated: false }),
  },
}));
vi.mock("./RecorderNotes", () => ({ RecorderNotes: () => null }));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/format", () => ({
  digits: (n: number) => String(n),
  formatClock: () => "0:26",
}));

import { Recorder } from "./Recorder";

beforeEach(() => {
  discardRecording.mockClear();
});

describe("stop-and-delete confirm flow", () => {
  it("the first press only ARMS — nothing is discarded", () => {
    render(<Recorder />);
    fireEvent.click(screen.getByText("discard"));
    expect(discardRecording).not.toHaveBeenCalled();
    // armed state: the confirm wording and the way back are both offered
    expect(screen.getByText("discardConfirm")).toBeInTheDocument();
    expect(screen.getByText("discardKeep")).toBeInTheDocument();
  });

  it("'keep recording' disarms — still nothing discarded", () => {
    render(<Recorder />);
    fireEvent.click(screen.getByText("discard"));
    fireEvent.click(screen.getByText("discardKeep"));
    expect(discardRecording).not.toHaveBeenCalled();
    expect(screen.queryByText("discardConfirm")).toBeNull();
    expect(screen.getByText("discard")).toBeInTheDocument();
  });

  it("the confirmed press discards, exactly once, on the red solid style", async () => {
    render(<Recorder />);
    fireEvent.click(screen.getByText("discard"));
    const confirm = screen.getByText("discardConfirm");
    expect(confirm.className).toContain("btn-danger");
    fireEvent.click(confirm);
    expect(discardRecording).toHaveBeenCalledTimes(1);
  });
});
