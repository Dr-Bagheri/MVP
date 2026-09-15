import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      el !== null && el.classList.contains("tabular-nums") && el.tagName === "SPAN";
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

  /*
   * ONE LINE, ALWAYS — and the FIRST version of this test was green over the
   * bug (user reported it twice, 2026-09-08).
   *
   * It asserted `whitespace-nowrap` on the readout, which was present and
   * did nothing: the readout also carried `.badge-num`, and that class is
   * `display: inline-grid` in globals.css, so its three children were laid
   * out as three implicit ROWS. Nothing was wrapping — it was stacking — and
   * a class assertion could not tell, because the rule that broke it lives
   * in a stylesheet two files away.
   *
   * So this asserts the CAUSE by name. `.badge-num` on a multi-child element
   * is the defect; its absence is the fix, and re-adding it turns this red.
   */
  it("keeps the position, the slash and the total on one line", async () => {
    render(<AudioBar callId="c1" seekTo={null} locale="fa" durationMs={383_000} />);
    await screen.findByRole("slider");
    const readout = screen.getByText(/۶:۲۳/).closest("span.tabular-nums")!;
    expect(readout).not.toBeNull();
    /* three children — so a grid would stack them, which is what happened */
    expect(readout.childNodes.length).toBeGreaterThan(1);
    expect(readout.className).not.toContain("badge-num");
    expect(readout.className).toContain("whitespace-nowrap");
  });

  /*
   * THE SPEED KEY HOLDS ITS WIDTH.
   *
   * Its label is ×1, ×1.25, ×1.5 or ×2 — four widths — so an auto-sized key
   * moved itself, the save button beside it and the waveform's right edge on
   * every press. A fixed width is the whole fix, and it is asserted as one
   * class rather than as a pixel because jsdom does not lay out.
   */
  it("gives the speed key a width that does not change with its label", async () => {
    render(<AudioBar callId="c1" seekTo={null} locale="fa" durationMs={60_000} />);
    await screen.findByRole("slider");
    const key = screen.getByRole("button", { name: "audioSpeed" });
    const width = key.className;
    expect(width).toMatch(/\bw-\[\d+px\]/);
    fireEvent.click(key);
    /* the label changed and the geometry did not — the control, without
       which "it has a width" passes on a key that re-sizes anyway */
    expect(screen.getByText(/×۱\.۲۵|×۱٫۲۵|×1\.25/)).toBeTruthy();
    expect(key.className).toBe(width);
  });

  /*
   * SAVING THE RECORDING.
   *
   * Through a BLOB, because `<a download>` is ignored cross-origin and these
   * are signed URLs on another host — the browser would navigate to the audio
   * instead of saving it. So the assertion is on the anchor the handler
   * builds: it must carry a `download` NAME, and the name must be the
   * recording's, never the call's uuid.
   */
  it("saves every part through a blob, named after the recording", async () => {
    getCallAudio.mockResolvedValue({
      parts: [
        { idx: 0, offset_ms: 0, url: "https://storage.example/a/one.webm?token=x" },
        { idx: 1, offset_ms: 1000, url: "https://storage.example/a/two.webm?token=x" },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["x"], { type: "audio/webm" }),
      arrayBuffer: async () => new ArrayBuffer(8),
    })));
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:saved", revokeObjectURL: () => undefined });
    const saved: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      saved.push(this.download);
    };
    try {
      render(
        <AudioBar callId="c-uuid" seekTo={null} locale="fa" durationMs={60_000} title="جلسهٔ فروش" />,
      );
      await screen.findByRole("slider");
      fireEvent.click(screen.getByRole("button", { name: "audioDownload" }));
      await waitFor(() => expect(saved).toHaveLength(2));
      /* the TITLE, numbered because a recording that ran long is several
         files and one name for both would overwrite the first */
      expect(saved).toEqual(["جلسهٔ فروش-1.webm", "جلسهٔ فروش-2.webm"]);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  it("falls back to the call's id when the recording has no title", async () => {
    /* the control for the assertion above: a version that always used the id
       satisfies "there is a download name" and loses the whole point of it */
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["x"], { type: "audio/webm" }),
      arrayBuffer: async () => new ArrayBuffer(8),
    })));
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:saved", revokeObjectURL: () => undefined });
    const saved: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      saved.push(this.download);
    };
    try {
      render(<AudioBar callId="c-uuid" seekTo={null} locale="fa" durationMs={60_000} />);
      await screen.findByRole("slider");
      fireEvent.click(screen.getByRole("button", { name: "audioDownload" }));
      /* ONE part, so no number: a lone file numbered «-1» reads as the first
         of several that never arrive */
      await waitFor(() => expect(saved).toEqual(["c-uuid.webm"]));
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  it("says there is no audio when the record has none, rather than drawing an empty bar", async () => {
    getCallAudio.mockResolvedValue(null);
    render(<AudioBar callId="c1" seekTo={null} locale="fa" durationMs={60_000} />);
    expect(await screen.findByText("noAudio")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});
