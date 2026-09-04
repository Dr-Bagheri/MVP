import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resetVoicePrefsForTest } from "@/lib/voicePrefs";
import { resetPushToTalkForTest } from "@/lib/pushToTalk";
import { resolve } from "node:path";

/* mutable, so one case can put the panel on a surface it must stay off. The
   default is what every other test in this file assumed. */
const pathname = vi.fn(() => "/fa/meetings");
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

/**
 * Every surface that asked the store for the run's hands.
 *
 * Wrapped rather than observed through an outcome, and the reason is worth
 * keeping: this began as its own file asserting that a hidden panel performed
 * no client tool. It passed alone and failed beside a sibling suite — the
 * store is module state and vitest gives two files the same instance, so
 * ANOTHER file's visible sidebar had registered into the store this one was
 * inspecting. The subject is "did mounting THIS panel claim the hands", and
 * only a file that owns every mount of it can ask that. Hence: here.
 */
const claims: unknown[] = [];
vi.mock("@/lib/assistantSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistantSession")>();
  return {
    ...actual,
    registerAssistantSurface: (surface: Parameters<typeof actual.registerAssistantSurface>[0]) => {
      claims.push(surface);
      return actual.registerAssistantSurface(surface);
    },
  };
});
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
    /* the roster `@handle` resolves against (0166). It is read on mount and
       rendered nowhere, so this file needs it only to exist — but it needs to
       EXIST: an absent method threw inside a promise, and four assertions
       about the panel's geometry failed reporting nothing about geometry. */
    agents: async () => [],
  },
}));
vi.mock("@/lib/agentSurface", () => ({
  SURFACE_TOOLS: [],
  executeClientTool: async () => ({ ok: true }),
}));
/* a quiet voice loop: supported and started, so mounting produces no
   "microphone denied" toast that later assertions would have to step around.
   `started`/`sessions` are what the push-to-talk case reads — the mic opening
   and the session opening are two different facts and it needs both. */
const started = vi.fn();
const sessions = vi.fn();
vi.mock("@/lib/voiceLoop", () => ({
  voiceLoopSupported: () => true,
  startVoiceLoop: async () => {
    started();
    return {
      stop() {}, endSession() {}, setSpeaking() {}, setMuted() {},
      openSession() { sessions(); },
    };
  },
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

  it("is a SHARE of the screen, taken from the blueprint rather than typed", async () => {
    /*
     * It was the menu's width for a day ("the same size of the menu that we
     * have"), and the user then ruled it a share instead: "give 30% of the
     * screen to the ai assistant side bar" (2026-09-03). That is a different
     * kind of answer and worth the distinction — a menu is as wide as its
     * longest label, and the assistant is as wide as the room a conversation
     * deserves — so the number it reads has moved to its own entry in SCAFFOLD
     * rather than borrowing the menu's.
     *
     * Still asserted against the blueprint and not against a string: a literal
     * here would agree on the day it was written and drift the way a
     * hand-written 56 drifted from a top bar that grew to 62.
     */
    const { container } = await mount();
    const aside = container.querySelector<HTMLElement>("[data-assistant-sidebar]")!;
    /* the CONTROL that makes the width assertion mean something: shut and open
       must differ, or a broken read of the style would satisfy either */
    expect(aside.style.getPropertyValue("--assistant-w")).toBe("3rem");
    await userEvent.click(document.querySelector<HTMLElement>("[data-assistant-door]")!);
    expect(aside.style.getPropertyValue("--assistant-w"))
      .toBe(`max(${SCAFFOLD.assistantPanelMin / 16}rem, ${SCAFFOLD.assistantPanelPct}vw)`);
    /* and the floor is a floor, not decoration: 30% of a 1024px laptop is
       307px, and below about 20rem the composer, its control row and a
       readable answer stop fitting at once */
    expect(SCAFFOLD.assistantPanelMin).toBeGreaterThanOrEqual(320);
  });

  it("reserves the page's column, and NEVER the row's — the top bar reaches the corner", () => {
    /*
     * THE REGRESSION THIS EXISTS FOR, and it has been wrong in three
     * different directions on one day, which is why it is pinned in source:
     * none of it is visible in a rendered jsdom tree.
     *
     *  1. the shell padded the whole ROW, so the TOP BAR was inset too and a
     *     column of dead window sat above the assistant — "the top menu is not
     *     going to the end of the page and there is gap on the corner";
     *  2. the reservation was removed altogether, and the page then centred in
     *     the whole window while a 248px panel covered one side of it;
     *  3. it came back as a CONSTANT 48, which keeps the layout still but
     *     leaves the page centred against a strip that is not there when the
     *     panel is open.
     *
     * What is true now: the sidebar publishes its ACTUAL width, `main` is the
     * only reader, and the row carries no padding at all.
     */
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/platform/PlatformShell.tsx"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");

    /* the row is clean — this is the corner-gap half */
    const row = shell.slice(shell.indexOf('"flex h-dvh'), shell.indexOf('"flex h-dvh') + 120);
    expect(row).not.toContain("pe-");

    /* and `main` steps aside by the published width — the centring half */
    expect(shell).toContain('md:pe-[var(--assistant-rail)]');

    /* the producer's side: somebody has to write what main reads */
    const sidebar = readFileSync(
      resolve(process.cwd(), "src/components/platform/AssistantSidebar.tsx"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(sidebar).toContain('setProperty("--assistant-rail"');
  });

  it("remembers the choice, and the remembered choice is the one that opens it", async () => {
    localStorage.setItem("neurai-assistant-sidebar", "1");
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
  });

  it("does not claim the run's hands on a surface it is not on", async () => {
    /*
     * The panel returns null on /assistant — the page IS the assistant there.
     * But a component that renders nothing still runs its effects, and React
     * runs effects parent-last: the shell's hidden panel would register AFTER
     * the page it wraps and take the hands out of its window.
     *
     * That is not cosmetic. `askConsent` on a hidden panel sets state that
     * renders no card, so the promise the tool runner awaits never settles and
     * the run hangs until the 120-second timeout — "stuck in thinking mode",
     * by a new road.
     */
    pathname.mockReturnValue("/fa/assistant");
    claims.length = 0;
    render(<AssistantSidebar />);
    /* the identity read is async and `visible` is false until it lands, so an
       immediate assertion would be measuring a panel that had not finished
       mounting rather than one that decided to stay out */
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    expect(document.querySelector("[data-assistant-door]"), "hidden on /assistant").toBeNull();
    expect(claims, "a panel nobody can see must not answer for the run").toEqual([]);
  });

  it("THE CONTROL: on a surface it IS on, it takes them", async () => {
    /*
     * Without this, the case above passes against a panel that never registers
     * at all — and a sidebar that can never perform a client tool is a worse
     * bug than the one being prevented. Only a case that SHOULD claim them can
     * tell "correctly silent" from "wired to nothing".
     */
    pathname.mockReturnValue("/fa/meetings");
    claims.length = 0;
    await mount();
    await waitFor(() => expect(claims.length).toBeGreaterThan(0));
  });

  /**
   * PUSH TO TALK OPENS THE MIC WITH THE EARS SWITCHED OFF.
   *
   * The bug this exists for (user report, 2026-09-04: "the hotkey for mic is
   * not working"): the key called `beginLoop`, whose first line was `if
   * (!earsRef.current) return`. Push-to-talk is FOR the person who keeps the
   * mic off — that is what a key you hold is — so it refused exactly the
   * people it was built for. With the ears ON the loop was already running and
   * the key was equally inert, so the feature was a no-op in BOTH states,
   * which is the one shape a manual check never catches: whichever state you
   * try, nothing was supposed to visibly change.
   *
   * The session half is asserted beside it because "the mic opened" is not the
   * feature. Idle means only the wake word acts, so a mic opened without a
   * session throws away everything said into it — a hotkey that listens and
   * discards, which from the outside is indistinguishable from one that does
   * nothing at all.
   */
  it("opens the mic AND the session on the hotkey, with the ears switched off", async () => {
    /*
     * The stores are MODULE state and cache their first read, so writing
     * storage is not enough: a previous case in this file has already
     * hydrated `voicePrefs` with the ears on, and the preference under test
     * would never be seen. Clearing storage without this looks like a reset
     * and is not one.
     */
    /* RESET FIRST, then write. `resetPushToTalkForTest` clears storage as
       well as memory — that is what makes it a real reset — so calling it
       after the write erased the very key under test, and the case failed
       reporting that the mic never opened. */
    resetVoicePrefsForTest();
    resetPushToTalkForTest();
    localStorage.setItem("neurai-voice-ears", "0");
    localStorage.setItem("neurai-push-to-talk", "F9");
    started.mockClear();
    sessions.mockClear();

    await mount();
    /* the ears are off, so nothing has opened the mic on its own — without
       this the assertion below could be satisfied by the ordinary loop */
    expect(started, "the ears are off; nothing should be listening yet").not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "F9" }));
    });
    await waitFor(() => expect(started).toHaveBeenCalled());
    await waitFor(() => expect(sessions, "the hold is the wake word").toHaveBeenCalled());
  });

  it("THE CONTROL: another key does nothing", async () => {
    /*
     * Without this, the case above passes against a handler that opens the mic
     * on ANY keystroke — which is a worse bug than the one being fixed, and
     * one nobody would notice until a microphone opened while they typed.
     */
    /*
     * The stores are MODULE state and cache their first read, so writing
     * storage is not enough: a previous case in this file has already
     * hydrated `voicePrefs` with the ears on, and the preference under test
     * would never be seen. Clearing storage without this looks like a reset
     * and is not one.
     */
    /* RESET FIRST, then write. `resetPushToTalkForTest` clears storage as
       well as memory — that is what makes it a real reset — so calling it
       after the write erased the very key under test, and the case failed
       reporting that the mic never opened. */
    resetVoicePrefsForTest();
    resetPushToTalkForTest();
    localStorage.setItem("neurai-voice-ears", "0");
    localStorage.setItem("neurai-push-to-talk", "F9");
    started.mockClear();

    await mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "F8" }));
    });
    expect(started).not.toHaveBeenCalled();
  });
});
