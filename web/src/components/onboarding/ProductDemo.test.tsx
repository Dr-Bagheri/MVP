import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProductDemo } from "./ProductDemo";
import { PRODUCT_DEMOS, productDemoMedia } from "@/lib/productDemos";

let reduced = false;
let play: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  reduced = false;
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("product films", () => {
  it("ships a real MP4, JPEG and timed captions for every lesson in both languages", () => {
    for (const theme of ["light", "dark"] as const) for (const locale of ["fa", "en"]) for (const lesson of PRODUCT_DEMOS) {
      const media = productDemoMedia(lesson, locale, theme);
      const file = (url: string) => resolve(process.cwd(), "public", url.slice(1));
      const mp4 = readFileSync(file(media.src));
      // File-format signatures, not an assertion against the registry itself.
      expect(mp4.subarray(4, 8).toString()).toBe("ftyp");
      expect(mp4.length).toBeGreaterThan(10000);
      expect(readFileSync(file(media.poster)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(readFileSync(file(media.captions), "utf8")).toContain("00:04.800 --> 00:10.000");
    }
    expect(existsSync(resolve(process.cwd(), "public/demo/en/not-a-lesson.mp4"))).toBe(false);
  });

  it("autoplays silently with NO player chrome, advances only on completion, and lets a person choose a clip", () => {
    const { container } = render(<ProductDemo />);
    const video = container.querySelector("video")!;
    expect(play).toHaveBeenCalled();
    expect(video.muted).toBe(true);
    /* the film just plays (2026-09-16): no scrubber, no pause, no mute key */
    expect(video.controls).toBe(false);
    /* the carousel does not loop a clip — `ended` is what carries it to the next one */
    expect(video.loop).toBe(false);
    fireEvent.pause(video);
    expect(video.getAttribute("src")).toBe("/demo/fa/meeting.mp4");
    fireEvent.ended(video);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/demo/fa/ask.mp4");
    fireEvent.click(screen.getByRole("button", { name: "کارها" }));
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/demo/fa/tasks.mp4");
    /* the film's one sentence and nothing under it — the «ten-second samples ·
       fictional data · silent» caption left with its key, so this is asserted
       as a count rather than as a text that no version could render */
    expect(container.querySelectorAll("section > p")).toHaveLength(1);
  });

  it("a fixed lesson LOOPS — with no key to restart it, a film that stops on its last frame reads as broken", () => {
    const { container } = render(<ProductDemo lesson="tasks" />);
    const video = container.querySelector("video")!;
    expect(video.loop).toBe(true);
    expect(video.controls).toBe(false);
    /* and there is no clip chooser under a film that was chosen for it */
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("reduced motion keeps the poster and the chosen lesson without autoplay or auto-advance", () => {
    reduced = true;
    const { container } = render(<ProductDemo />);
    const video = container.querySelector("video")!;
    expect(video.getAttribute("poster")).toBe("/demo/fa/meeting.jpg");
    expect(play).not.toHaveBeenCalled();
    fireEvent.ended(video);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/demo/fa/meeting.mp4");
    fireEvent.click(screen.getByRole("button", { name: "اتصال‌ها" }));
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/demo/fa/connect.mp4");
    expect(play).not.toHaveBeenCalled();
  });

  it("reports a failed load without blocking the page and allows a fresh attempt", () => {
    const { container } = render(<ProductDemo lesson="team" autoPlay={false} />);
    const video = container.querySelector("video")!;
    fireEvent.error(video);
    expect(screen.getByRole("status")).toHaveTextContent("ویدیو بارگیری نشد");
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره برای پخش" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("video")).not.toBe(video);
    expect(play).not.toHaveBeenCalled();
  });
});
