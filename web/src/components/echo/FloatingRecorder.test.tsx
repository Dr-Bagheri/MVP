/**
 * The mini recorder's ONE home. It used to dock into the top bar's anchor and
 * fall back to
 * floating; the bar's centred search layer crosses that cluster, so the pill
 * now floats over the assistant column on every screen. The discriminating
 * assertions are the SHEET (`.glass`, not a plain surface — over the
 * assistant's own glass that is what makes it read as above rather than as a
 * patch cut into it) and the click's DESTINATION, which is the take's own
 * screen and not the meetings list.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/tasks";
const push = vi.fn();
vi.mock("@/i18n/routing", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/format", () => ({ formatClock: () => "0:26" }));

// the snapshot must be REFERENTIALLY stable between calls (like the real
// engine's cached snapshot) — a fresh object per call spins
// useSyncExternalStore into an infinite re-render
let snapshot: Record<string, unknown> = {
  phase: "recording",
  title: "Meeting 2",
  recordedMs: 26_000,
  returnPath: "/meetings/m1",
};
vi.mock("@/lib/recordingEngine", () => ({
  subscribeRecorder: () => () => undefined,
  recorderSnapshot: () => snapshot,
  finish: vi.fn(async () => undefined),
  pause: vi.fn(),
  resume: vi.fn(),
}));

import { FloatingRecorder } from "./FloatingRecorder";

beforeEach(() => {
  pathname = "/tasks";
  push.mockClear();
  snapshot = {
    phase: "recording",
    title: "Meeting 2",
    recordedMs: 26_000,
    returnPath: "/meetings/m1",
  };
});

describe("FloatingRecorder placement", () => {
  it("floats as its own glass sheet over the assistant column", () => {
    render(<FloatingRecorder />);
    const pill = screen.getByText("pause").closest("div")!;
    expect(pill.className).toContain("fixed");
    expect(pill.className).toContain("glass");
    // z-40 clears the assistant's z-30 — the bug was the pill UNDER something
    expect(pill.className).toContain("z-40");
    // and it is NOT inside the bar's retired anchor
    expect(pill.closest("#neurai-topbar-recorder")).toBeNull();
  });

  it("shows on every ordinary screen — there is no recorder page to defer to", () => {
    for (const p of ["/tasks", "/meetings", "/assistant", "/calls/abc"]) {
      pathname = p;
      const { unmount } = render(<FloatingRecorder />);
      expect(screen.queryByText("pause"), p).not.toBeNull();
      unmount();
    }
  });

  it("stands down on the meeting's own page — that screen draws the take", () => {
    pathname = "/meetings/m1";
    render(<FloatingRecorder />);
    expect(screen.queryByText("pause")).toBeNull();
  });

  it("renders nothing at all when no take is rolling", () => {
    snapshot = { phase: "idle", title: "", recordedMs: 0, returnPath: null };
    render(<FloatingRecorder />);
    expect(screen.queryByText("pause")).toBeNull();
    expect(screen.queryByText("finishShort")).toBeNull();
  });
});

describe("FloatingRecorder destination", () => {
  it("opens the RECORDING screen the take was started on", async () => {
    render(<FloatingRecorder />);
    await userEvent.click(screen.getByLabelText("pillOpen"));
    expect(push).toHaveBeenCalledWith("/meetings/m1");
  });

  it("falls back to the meetings list for a take with no screen of its own", async () => {
    snapshot = { ...snapshot, returnPath: null };
    render(<FloatingRecorder />);
    await userEvent.click(screen.getByLabelText("pillOpen"));
    expect(push).toHaveBeenCalledWith("/meetings");
  });
});
