import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/fa/meetings" }));
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/api/client", () => ({
  api: {
    identityState: async () => ({ state: "member" }),
    models: async () => ({ models: [], preferred_model: null }),
    agentMessages: async () => [],
    deliverToolResult: async () => undefined,
    ask: () => (async function* () { /* nothing asked in this file */ })(),
  },
}));
vi.mock("@/lib/agentSurface", () => ({
  SURFACE_TOOLS: [],
  executeClientTool: async () => ({ ok: true }),
}));
/* a quiet voice loop: supported and started, so mounting produces no
   "microphone denied" toast that later assertions would have to step around */
vi.mock("@/lib/voiceLoop", () => ({
  voiceLoopSupported: () => true,
  startVoiceLoop: async () => ({
    stop() {}, endSession() {}, setSpeaking() {}, setMuted() {},
  }),
}));
vi.mock("@/lib/voice", () => ({
  speak: vi.fn(),
  speakQueued: vi.fn(),
  stopSpeaking: vi.fn(),
  subscribeSpeechPlayback: () => () => undefined,
}));

import { postToAssistant } from "@/lib/assistantBus";
import { AssistantSidebar } from "./AssistantSidebar";
import { SCAFFOLD } from "@/components/scaffold/constants";

/**
 * **The failure this platform has already shipped once.**
 *
 * An earlier assistant pane was a flex sibling of `main` and squeezed the page
 * to 40px at 375; the fix made it a `fixed inset-0` overlay that defaulted to
 * OPEN, so every box metric improved (main went full width, nothing
 * overflowed) while the app became unreachable behind an opaque layer. Both
 * states passed every measurement anyone took.
 *
 * So the assertions below are about REACHABILITY, not about boxes — jsdom
 * performs no layout, so what can be checked here is the set of decisions that
 * decide whether the page is covered: what renders on first visit, whether the
 * column is laid OVER the content or beside it, and how much space the shell is
 * told to leave. The pair matters more than either half: the second test opens
 * it deliberately and asserts the overlay DOES appear, so the first test can
 * fail for the right reason. Flip the default to open and it goes red.
 *
 * The 375-vs-1280 half of the hit test is answered structurally rather than by
 * measurement: below `md` the collapsed sidebar renders `hidden`, so at 375 on
 * first visit there is nothing on screen to hit-test around, and from `md` up
 * the shell is padded by the width the sidebar publishes rather than having the
 * column drawn over it.
 */

const TOP = `${SCAFFOLD.topBarHeight / 16}rem`;
const railVar = () => document.documentElement.style.getPropertyValue("--assistant-rail");

/** the page behind the assistant — a real control to look for */
function Page() {
  return <button type="button">صفحه</button>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--assistant-rail");
});
afterEach(() => {
  vi.clearAllMocks();
});

async function mount() {
  const view = render(<><Page /><AssistantSidebar /></>);
  // the identity read gates everything; nothing renders until it answers
  await waitFor(() => expect(document.querySelector("[data-assistant-sidebar]")).not.toBeNull());
  return view;
}

describe("the assistant sidebar does not cover the page", () => {
  it("is COLLAPSED on first visit, and what it draws is beside the page rather than over it", async () => {
    const { container } = await mount();
    const aside = container.querySelector<HTMLElement>("[data-assistant-sidebar]")!;

    expect(aside.dataset.open).toBe("false");
    /* no thread, no composer: the room is shut */
    expect(container.querySelector("textarea")).toBeNull();

    /* the page's own control is present and is NOT inside the assistant */
    const pageControl = screen.getByRole("button", { name: "صفحه" });
    expect(aside.contains(pageControl)).toBe(false);

    /* below md it renders NOTHING — the 375 half of the hit test, answered by
       construction rather than by a measurement jsdom cannot take */
    expect(aside.className).toContain("hidden");
    expect(aside.className).toContain("md:flex");

    /* and it is not a full-screen layer at any width: it begins under the top
       bar, at the bar's own height, and ends at the foot of the window */
    expect(aside.className).not.toContain("inset-0");
    expect(aside.style.top).toBe(TOP);

    /* the shell is told to leave exactly the width that is drawn — this is the
       difference between "the content is narrower" and "the content is
       covered", and it is the number PlatformShell pads by */
    expect(railVar()).toBe("3rem");
  });

  it("opens on the ONE door, and only then takes the room — the control", async () => {
    /*
     * Without this the test above cannot be trusted: "nothing is covered"
     * passes just as well against a component that never renders anything at
     * all. This is the same assertions' other side.
     */
    const { container } = await mount();
    await userEvent.click(screen.getByRole("button", { name: /دستیار/ }));

    const aside = container.querySelector<HTMLElement>("[data-assistant-sidebar]")!;
    expect(aside.dataset.open).toBe("true");
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(railVar()).toBe("22.5rem");
    /* still under the top bar even when open: below md this is a full-width
       overlay, and a person must be able to see where they are while it is up */
    expect(aside.style.top).toBe(TOP);
    expect(aside.className).not.toContain("inset-0");
  });

  it("remembers the choice, and the remembered choice is the one that opens it", async () => {
    localStorage.setItem("neurai-assistant-sidebar", "1");
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
    expect(railVar()).toBe("22.5rem");
  });
});

describe("the sidebar is a room, not a text box", () => {
  it("carries a message from an agent, with that agent's name on it", async () => {
    const { container } = await mount();
    await userEvent.click(screen.getByRole("button", { name: /دستیار/ }));

    act(() => {
      postToAssistant({ content: "پیش‌نویس پاسخ آماده است.", author: { name: "رویا", icon: "mail" } });
    });

    expect(await screen.findByText("پیش‌نویس پاسخ آماده است.")).toBeInTheDocument();
    expect(screen.getByText("رویا")).toBeInTheDocument();
    expect(container.querySelector('[data-icon="mail"]')).not.toBeNull();
  });

  it("says nothing about the author when there is none — the control", async () => {
    /*
     * The discriminating half. "The agent's name renders" passes against a
     * component that renders a byline on everything, which would put a label on
     * the assistant's own messages — a byline on a monologue.
     */
    await mount();
    await userEvent.click(screen.getByRole("button", { name: /دستیار/ }));

    act(() => { postToAssistant({ content: "بدون نویسنده" }); });

    expect(await screen.findByText("بدون نویسنده")).toBeInTheDocument();
    expect(screen.queryByText("رویا")).toBeNull();
    /* the assistant's own messages carry no mark of their own either — the
       author well is drawn only when an author is present */
    expect(document.querySelectorAll('[data-icon="sparkle"]').length).toBe(0);
  });

  it("counts what arrived while it was shut, and opening READS it rather than clearing it", async () => {
    /*
     * The defect this pins: opening the sidebar starts a fresh thread, which is
     * the 2026-08-26 ruling ("nothing should remain here as a history"). Applied
     * without exception it deletes exactly what the badge was advertising — the
     * person presses a "2", and the two messages are gone before they render.
     */
    await mount();

    act(() => {
      postToAssistant({ content: "جلسهٔ ۱۰:۳۰ آماده است.", author: { name: "آوا" } });
      postToAssistant({ content: "پیش‌نویس دوم", author: { name: "رویا" } });
    });

    /* the count, in the reader's own digits */
    expect(await screen.findByText("۲")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /دستیار/ }));
    expect(screen.getByText("جلسهٔ ۱۰:۳۰ آماده است.")).toBeInTheDocument();
    expect(screen.getByText("پیش‌نویس دوم")).toBeInTheDocument();
    /* and the badge is spent once it has been read */
    expect(screen.queryByText("۲")).toBeNull();
  });
});
