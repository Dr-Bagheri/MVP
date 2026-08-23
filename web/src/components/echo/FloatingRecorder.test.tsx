/**
 * The mini recorder's two homes (user directive, 2026-08-23): docked into
 * the top bar's anchor when a bar is present, floating otherwise. The
 * discriminating assertion is CONTAINMENT — the docked pill must render
 * inside the anchor element (a portal that silently fell back to the body
 * would keep every class-based check green while the bar slot stays empty).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/echo/records";
vi.mock("@/i18n/routing", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/format", () => ({ formatClock: () => "0:26" }));

// the snapshot must be REFERENTIALLY stable between calls (like the real
// engine's cached snapshot) — a fresh object per call spins
// useSyncExternalStore into an infinite re-render
let snapshot = { phase: "recording", title: "Meeting 2", recordedMs: 26_000 };
vi.mock("@/lib/recordingEngine", () => ({
  subscribeRecorder: () => () => undefined,
  recorderSnapshot: () => snapshot,
  finish: vi.fn(async () => undefined),
  pause: vi.fn(),
  resume: vi.fn(),
}));

import { FloatingRecorder } from "./FloatingRecorder";
import { registerRecorderAnchor } from "@/components/platform/recorderAnchor";

let releaseAnchor: (() => void) | null = null;

beforeEach(() => {
  pathname = "/echo/records";
  snapshot = { phase: "recording", title: "Meeting 2", recordedMs: 26_000 };
});

afterEach(() => {
  releaseAnchor?.();
  releaseAnchor = null;
});

function anchorInDom(): HTMLElement {
  const anchor = document.createElement("div");
  anchor.id = "neurai-topbar-recorder";
  document.body.appendChild(anchor);
  const unregister = registerRecorderAnchor(anchor);
  releaseAnchor = () => {
    unregister();
    anchor.remove();
  };
  return anchor;
}

describe("FloatingRecorder placement", () => {
  it("docks INTO the registered top-bar anchor — bar styling, not fixed", () => {
    const anchor = anchorInDom();
    render(<FloatingRecorder />);
    const pill = screen.getByText("pause").closest("div")!;
    expect(anchor.contains(pill)).toBe(true);
    expect(pill.className).toContain("h-9");
    expect(pill.className).not.toContain("fixed");
  });

  it("floats when no bar offered an anchor — a live mic is never invisible", () => {
    render(<FloatingRecorder />);
    const pill = screen.getByText("pause").closest("div")!;
    expect(pill.className).toContain("fixed");
    // and it is NOT inside some stale anchor id left in the document
    expect(pill.closest("#neurai-topbar-recorder")).toBeNull();
  });

  it("stands down on the recorder's own screens even while docked", () => {
    const anchor = anchorInDom();
    for (const p of ["/echo", "/echo/new-meeting", "/echo/record", "/echo/upload"]) {
      pathname = p;
      const { unmount } = render(<FloatingRecorder />);
      expect(screen.queryByText("pause"), p).toBeNull();
      expect(anchor.childElementCount, p).toBe(0);
      unmount();
    }
  });

  it("but /echo/records is the records LIST, not the recorder — the pill shows", () => {
    // pins the segment fix: startsWith("/echo/record") used to swallow this
    // page, and a live take was invisible exactly where people review takes
    pathname = "/echo/records";
    render(<FloatingRecorder />);
    expect(screen.queryByText("pause")).not.toBeNull();
  });

  it("renders nothing at all when no take is rolling", () => {
    anchorInDom();
    snapshot = { phase: "idle", title: "", recordedMs: 0 };
    render(<FloatingRecorder />);
    expect(screen.queryByText("pause")).toBeNull();
    expect(screen.queryByText("finish")).toBeNull();
  });
});
