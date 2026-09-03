import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/** the page behind the assistant — a real control to look for */
function Page() {
  return <button type="button">صفحه</button>;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
});

async function mount() {
  const view = render(<><Page /><AssistantSidebar /></>);
  /* the identity read gates everything, and a CLOSED sidebar renders nothing —
     so the thing to wait for is the DOOR, which is portalled into the top bar
     as soon as the component knows the person is a member */
  await waitFor(() => expect(document.querySelector("[data-assistant-door]")).not.toBeNull());
  return view;
}

describe("the assistant sidebar floats, and is shut until asked for", () => {
  it("is THERE when shut — a strip, not an absence — and holds no conversation", async () => {
    /*
     * WHAT "CLOSED" MEANS, settled in two corrections on one day.
     *
     * The first version collapsed to a rail AND had the shell reserve a column
     * for it, so opening re-flowed the page: the user asked for the pushing to
     * stop. I then removed the element entirely when shut, and that was the
     * over-correction — "i didnt mean closed means nothing is drawn, i want it
     * to be in a fixed position in the platform everywhere". So the assistant
     * is always on screen and always in the same place; closed narrows it to a
     * strip. Both halves are asserted here, because each alone would pass
     * against the version the other was written for.
     */
    const { container } = await mount();
    const aside = container.querySelector<HTMLElement>("[data-assistant-sidebar]")!;
    expect(aside).not.toBeNull();
    expect(aside.dataset.open).toBe("false");
    expect(aside.style.getPropertyValue("--assistant-w")).toBe("3rem");

    /* shut is a PLACE, not a conversation: no composer, nothing to read */
    expect(container.querySelector("textarea")).toBeNull();

    /* and the page is still its own — the strip sits beside it, never over it */
    const pageControl = screen.getByRole("button", { name: "صفحه" });
    expect(aside.contains(pageControl)).toBe(false);
  });

  it("opens on the ONE door — the control that makes the test above mean something", async () => {
    /*
     * "Nothing is covered" passes just as well against a component that never
     * renders at all, which is exactly what the assertion above would be
     * without this. It also guards the trap this change nearly shipped: the
     * door used to live on the collapsed rail from md up, so removing the rail
     * without moving the button would have left the assistant unopenable on a
     * desktop — a door that exists only on a phone.
     */
    const { container } = await mount();
    await userEvent.click(document.querySelector<HTMLElement>("[data-assistant-door]")!);

    const aside = container.querySelector<HTMLElement>("[data-assistant-sidebar]")!;
    expect(aside.dataset.open).toBe("true");
    expect(container.querySelector("textarea")).not.toBeNull();

    /* the page is still THERE and still outside it — floating over is not the
       same as replacing */
    const pageControl = screen.getByRole("button", { name: "صفحه" });
    expect(aside.contains(pageControl)).toBe(false);

    /* under the top bar, never a full-screen layer: a person must be able to
       see where they are while it is up */
    expect(aside.style.top).toBe(TOP);
    expect(aside.className).not.toContain("inset-0");
  });

  it("is the MENU's width, taken from the blueprint rather than typed", async () => {
    /*
     * The user asked for "the same size of the menu that we have". Asserted
     * against SCAFFOLD rather than against a string, because a literal here
     * would agree with the menu on the day it was written and drift the way a
     * hand-written 56 drifted from a top bar that grew to 62.
     */
    const { container } = await mount();
    const aside = container.querySelector<HTMLElement>("[data-assistant-sidebar]")!;
    /* the CONTROL that makes the width assertion mean something: shut and open
       must differ, or a broken read of the style would satisfy either */
    expect(aside.style.getPropertyValue("--assistant-w")).toBe("3rem");
    await userEvent.click(document.querySelector<HTMLElement>("[data-assistant-door]")!);
    expect(aside.style.getPropertyValue("--assistant-w"))
      .toBe(`${SCAFFOLD.menuWidth / 16}rem`);
  });

  it("reserves NO column — the shell is not pushed", () => {
    /*
     * The regression this exists for, and it is a source check on purpose:
     * the first version had the sidebar publish `--assistant-rail` and
     * PlatformShell pad its inline-end by it, so opening the assistant
     * re-flowed every page underneath. Both halves are gone; either coming
     * back is the defect, and neither is visible in a rendered jsdom tree.
     */
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/platform/PlatformShell.tsx"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(shell).not.toContain("--assistant-rail");

    const sidebar = readFileSync(
      resolve(process.cwd(), "src/components/platform/AssistantSidebar.tsx"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(sidebar).not.toContain("setProperty(\"--assistant-rail\"");
  });

  it("remembers the choice, and the remembered choice is the one that opens it", async () => {
    localStorage.setItem("neurai-assistant-sidebar", "1");
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
  });
});
