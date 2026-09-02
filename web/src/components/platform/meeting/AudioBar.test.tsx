import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));

const getCallAudio = vi.fn();
vi.mock("@/api/client", () => ({
  api: { getCallAudio: (...a: unknown[]) => getCallAudio(...a) },
}));

const { AudioBar } = await import("./Review");

/**
 * jsdom has no AudioContext and its canvas has no 2d context, so the
 * waveform DECODE and DRAW are both inert here — deliberately. What this file
 * pins is the CONTRACT around them: what the bar says about time it does not
 * know, and that the speed control actually reaches the element.
 */
beforeEach(() => {
  getCallAudio.mockReset();
  getCallAudio.mockResolvedValue({ parts: [{ idx: 0, offset_ms: 0, url: "blob:part-0" }] });
  /* fetch is what peaksOf calls first; failing it exercises the graceful
     branch rather than an unhandled rejection under the test */
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
});

describe("AudioBar", () => {
  it("renders an unknown total as a dash, never as zero", async () => {
    /*
     * "We do not know how long this is" and "it is empty" are different
     * facts, and 0:00 says the second. A null duration reaches the bar when
     * the worker has not yet recomputed it, which is a transient state on a
     * real recording — the one moment a person is most likely to be looking.
     */
    render(<AudioBar callId="c1" seekTo={null} locale="fa" durationMs={null} />);
    await screen.findByRole("slider");
    /* the readout is ONE span — position, slash, total — so it is matched
       whole: "۰:۰۰ / —", and the wrong version "۰:۰۰ / ۰:۰۰" is asserted
       absent by the same shape rather than by a lone dash that would also
       match any em-dash on the page */
    const readout = (el: Element | null) =>
      el !== null && el.classList.contains("badge-num") && el.tagName === "SPAN";
    const text = (re: RegExp) => (_: string, el: Element | null) =>
      readout(el) && re.test(el?.textContent ?? "");
    expect(screen.getByText(text(/۰:۰۰\s*\/\s*—/))).toBeTruthy();
    expect(screen.queryByText(text(/۰:۰۰\s*\/\s*۰:۰۰/))).toBeNull();
  });

  it("shows the wire's total beside the position", async () => {
    render(<AudioBar callId="c1" seekTo={null} locale="fa" durationMs={383_000} />);
    await screen.findByRole("slider");
    /* 6:23 in Persian digits — the reference's own example duration */
    expect(screen.getByText(/۶:۲۳/)).toBeTruthy();
  });

  it("cycles the speed and applies it to the media element", async () => {
    /*
     * The button changing its label is not the feature; playbackRate on the
     * <audio> is. A version that only updated the label would read as
     * working and play at ×1 forever — so the assertion is on the element.
     */
    const { container } = render(
      <AudioBar callId="c1" seekTo={null} locale="fa" durationMs={60_000} />,
    );
    await screen.findByRole("slider");
    const audio = container.querySelector("audio") as HTMLAudioElement;
    expect(audio.playbackRate).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "audioSpeed" }));
    expect(screen.getByText(/×۱\.۲۵|×۱٫۲۵|×1\.25/)).toBeTruthy();
    expect(audio.playbackRate).toBe(1.25);

    /* and it wraps: 1 → 1.25 → 1.5 → 2 → 1, never sticking at the top */
    fireEvent.click(screen.getByRole("button", { name: "audioSpeed" }));
    fireEvent.click(screen.getByRole("button", { name: "audioSpeed" }));
    fireEvent.click(screen.getByRole("button", { name: "audioSpeed" }));
    expect(audio.playbackRate).toBe(1);
  });

  it("says there is no audio when the record has none, rather than drawing an empty bar", async () => {
    getCallAudio.mockResolvedValue(null);
    render(<AudioBar callId="c1" seekTo={null} locale="fa" durationMs={60_000} />);
    expect(await screen.findByText("noAudio")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});
