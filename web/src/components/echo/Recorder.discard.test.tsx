/**
 * STOP asks (user directive, 2026-08-26): pressing stop on a rolling take
 * opens one dialog with TWO answers — save it, or delete it.
 *
 * The suite walks the whole matrix rather than the happy path, because
 * every wrong wiring here destroys a meeting or fabricates one: stop alone
 * must do neither; dismissal must do neither; save must not delete; delete
 * must not save. Asserting only "delete deletes" would pass against a
 * dialog whose save button also discarded.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const discardRecording = vi.fn(async () => ({ deleted: true }));
const finish = vi.fn(async () => undefined);
const snapshot = {
  phase: "recording", callId: "c-1", title: "Meeting 2", recordedMs: 26_000,
  level: 0, wave: [], waveStartMs: 0, chapterMarks: [], quality: null,
  progress: { done: 0, pending: 0, failed: 0 }, error: null,
  captions: null, captionRows: [], liveSpeakers: [], captionsDown: false, previews: [],
};
vi.mock("@/lib/recordingEngine", () => ({
  BOOST_GAIN: 2,
  subscribeRecorder: () => () => undefined,
  recorderSnapshot: () => snapshot,
  discardRecording: () => discardRecording(),
  addChapterMark: vi.fn(),
  finish: () => finish(),
  pause: vi.fn(),
  resume: vi.fn(),
  resetRecorder: vi.fn(),
  retryUploads: vi.fn(async () => undefined),
  startRecording: vi.fn(async () => undefined),
}));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/api/client", () => ({
  api: {
    /* the model dropdown's read (0099): this suite is about the stop
       flow, but a mock missing a method the component calls does not fake
       "no models" — it throws, and the failure arrives as whatever
       rendered last. The stub answers the empty case on purpose. */
    models: async () => ({ models: [], preferred_model: null, curated: false }),
  },
}));
vi.mock("./RecorderNotes", () => ({ RecorderNotes: () => null, AgendaPanel: () => null }));
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
  modelLabel: (id: string) => id,
}));

import { Recorder } from "./Recorder";

beforeEach(() => {
  discardRecording.mockClear();
  finish.mockClear();
});

/** the transport's middle button while a take rolls */
const stopButton = () => screen.getByRole("button", { name: "stopButton" });

describe("the stop dialog", () => {
  it("stop alone neither saves nor deletes — it ASKS", () => {
    render(<Recorder />);
    fireEvent.click(stopButton());
    expect(discardRecording).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    // both answers are offered, in one box
    expect(screen.getByText("stopSave")).toBeInTheDocument();
    expect(screen.getByText("stopDelete")).toBeInTheDocument();
  });

  it("'keep recording' is a dismissal — neither answer runs", () => {
    render(<Recorder />);
    fireEvent.click(stopButton());
    fireEvent.click(screen.getByText("stopKeep"));
    expect(discardRecording).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(screen.queryByText("stopSave")).toBeNull();
  });

  it("DELETE discards exactly once, and does not finish", () => {
    render(<Recorder />);
    fireEvent.click(stopButton());
    const del = screen.getByText("stopDelete");
    // the destructive answer wears the destructive style
    expect(del.className).toContain("btn-danger");
    fireEvent.click(del);
    expect(discardRecording).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });

  it("SAVE finishes exactly once, and does not discard", () => {
    // the other half of the pair: a save button wired to discard would
    // pass every test above and lose the meeting it promised to keep
    render(<Recorder />);
    fireEvent.click(stopButton());
    fireEvent.click(screen.getByText("stopSave"));
    expect(finish).toHaveBeenCalledTimes(1);
    expect(discardRecording).not.toHaveBeenCalled();
  });
});
