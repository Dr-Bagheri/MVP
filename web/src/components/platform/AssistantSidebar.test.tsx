import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resetPushToTalkForTest } from "@/lib/pushToTalk";
import { installFakeResizeObserver } from "@/test/resizeObserver";
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
/* every toast the panel raised. PARTIAL mock: components inside this tree read
   other things from the module, and replacing it whole would break them for a
   spy on one function. */
const notified = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notify", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/notify")>(),
  notify: (text: string, kind?: string) => notified(text, kind),
}));
/* the identity read, per test: the default is a member, and two cases below
   answer slowly or answer "stranger" */
const identity = vi.hoisted(() => vi.fn(async (): Promise<{ state: string }> => ({ state: "member" })));
/* the stored conversations the header's menu lists; empty for every case that
   is not about the header */
const sessions = vi.hoisted(() => vi.fn((): unknown[] => []));
/**
 * The thread read, and the refusal class it can fail with.
 *
 * `BffError` is EXPORTED BY THE MOCK because the component now tells a 404
 * apart from every other failure, and `instanceof` against a mock that omits
 * the class throws inside the catch — a component that handles the case
 * correctly would fail here for a reason that is about the mock. The class is
 * built once and shared, so an instance thrown below really is an instance of
 * the thing the component imports.
 */
const Bff = vi.hoisted(() => class BffError extends Error {
  constructor(readonly status: number, readonly kind?: string) { super(`bff ${status}`); }
});
const thread = vi.hoisted(() => vi.fn(
  async (_id: string): Promise<{ messages: unknown[]; floor: string[] }> => ({ messages: [], floor: [] }),
));
vi.mock("@/api/client", () => ({
  BffError: Bff,
  api: {
    identityState: () => identity(),
    models: async () => ({ models: [], preferred_model: null }),
    agentThread: (id: string) => thread(id),
    /* the header's switcher reads this — on OPEN only, so every other case in
       this file never touches it (see the header describe at the foot) */
    agentSessions: async () => sessions(),
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
   Its start and its stop are SPIES because the recording rule is about the
   ears — a test that could not see them could only assert the half that must
   NOT happen, and "nothing happened" passes against a component that ignores
   the recording altogether. */
const loopStarted = vi.hoisted(() => vi.fn());
const loopStopped = vi.hoisted(() => vi.fn());
vi.mock("@/lib/voiceLoop", () => ({
  voiceLoopSupported: () => true,
  startVoiceLoop: async () => {
    loopStarted();
    return {
      stop() { loopStopped(); },
      endSession() {}, setSpeaking() {}, setMuted() {}, openSession() {},
    };
  },
}));

/*
 * The browser's dictation engine, stubbed — jsdom has none, and the hook reads
 * its absence as `unsupported`, which would make the push-to-talk case pass
 * for the wrong reason (nothing started because nothing COULD).
 */
const started = vi.fn();
const stopped = vi.fn();
class FakeRecognition {
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: unknown = null;
  onerror: unknown = null;
  onend: (() => void) | null = null;
  start() { started(); }
  stop() { stopped(); this.onend?.(); }
  abort() {}
}
(globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
vi.mock("@/lib/voice", () => ({
  speak: vi.fn(),
  speakQueued: vi.fn(),
  stopSpeaking: vi.fn(),
  subscribeSpeechPlayback: () => () => undefined,
}));

import { AssistantSidebar } from "./AssistantSidebar";
import { SCAFFOLD } from "@/components/scaffold/constants";
import { announceRecordingLive } from "@/lib/assistantBus";
import { assistantSnapshot, resetAssistantSession } from "@/lib/assistantSession";
import {
  liveConversation, resetLiveConversationForTest, setLiveConversation,
} from "@/lib/liveConversation";

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
  /* the DOOR is portalled into the top bar; waiting for it keeps every effect
     of the mount inside the test (the strip itself no longer waits for the
     identity read — see the last describe) */
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
    /* FROM lg, not md (2026-09-15): between md and lg the open panel floats
       over the page, and the shell steps aside only by the closed strip —
       measured on a 768 tablet before the change, the reservation left the
       page 415px of 768. Both halves asserted, since either alone passes
       against a shell that reserves the wrong thing at one of the widths. */
    expect(shell).toContain('lg:pe-[var(--assistant-rail)]');
    expect(shell).toContain('md:pe-assistant');
    expect(shell).not.toContain('md:pe-[var(--assistant-rail)]');

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
   * HOLD THE HOTKEY, THE COMPOSER'S MIC LISTENS.
   *
   * The bug this exists for (user report, 2026-09-04: "the hotkey for mic is
   * not working") had two lives. First it called the wake-word loop's
   * `beginLoop`, whose first line refused anybody with the ears switched off —
   * which is exactly the person a hold-to-talk key is for, so it was a no-op
   * with the ears off and, since the loop was already running, equally inert
   * with them on. **A feature that does nothing in both states is the one
   * shape a manual check never catches**: whichever state you try, nothing was
   * supposed to visibly change.
   *
   * Then the directive settled which mic it had meant all along — the one
   * beside the composer on the assistant page — so the key drives DICTATION on
   * both surfaces now, and the panel has that mic for the first time.
   *
   * Asserted through `SpeechRecognition.start`, which is the browser API the
   * dictation hook reaches for. A stub, not the real engine: jsdom has none,
   * and its absence is what the hook reports as `unsupported`.
   */
  it("starts dictation on the hotkey — the same mic the button presses", async () => {
    /* RESET FIRST, then write. `resetPushToTalkForTest` clears storage as well
       as memory — that is what makes it a real reset — so calling it after the
       write erased the very key under test, and the case failed reporting that
       the mic never opened. */
    resetPushToTalkForTest();
    localStorage.setItem("neurai-push-to-talk", "F9");
    started.mockClear();
    stopped.mockClear();

    await mount();
    expect(started, "nothing should be listening before the key").not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "F9" }));
    });
    await waitFor(() => expect(started).toHaveBeenCalled());

    /* and RELEASING stops it — the half that makes it push-to-talk rather
       than a toggle with extra steps, and the half whose absence leaves a
       microphone open after the finger comes off */
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "F9" }));
    });
    await waitFor(() => expect(stopped).toHaveBeenCalled());
  });

  it("THE CONTROL: another key does nothing", async () => {
    /*
     * Without this, the case above passes against a handler that opens the mic
     * on ANY keystroke — a worse bug than the one being fixed, and one nobody
     * would notice until a microphone opened while they typed.
     */
    resetPushToTalkForTest();
    localStorage.setItem("neurai-push-to-talk", "F9");
    started.mockClear();

    await mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "F8" }));
    });
    expect(started).not.toHaveBeenCalled();
  });

  it("the panel offers the mic as a BUTTON too, not only as a hidden key", async () => {
    /* a hotkey whose effect no visible control offers is a feature only its
       author can find — and this panel had no mic at all before the directive
       asked for the page's one here */
    /* OPENED first: a shut panel renders no composer, so a query against the
       closed state would report "no mic" about a control that is simply not on
       screen yet — the kind of red that sends somebody to fix working code */
    localStorage.setItem("neurai-assistant-sidebar", "1");
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
    expect(container.querySelector('[data-icon="mic"]')).not.toBeNull();
  });
});

describe("the strip is structure, not a reward for the identity read (2026-09-05)", () => {
  it("is on screen BEFORE the identity read answers", () => {
    /*
     * User report: "when I reload the page the AI assistant sidebar comes
     * with delay — the skeleton structure of the whole platform must have the
     * AI sidebar as always present". The read never answers here, and the
     * strip must be there anyway, the way the rail and the top bar are.
     */
    identity.mockImplementationOnce(() => new Promise(() => { /* never */ }));
    const { container } = render(<><Page /><AssistantSidebar /></>);
    expect(container.querySelector("[data-assistant-sidebar]"), "the strip waited for the network").not.toBeNull();
    expect(document.documentElement.style.getPropertyValue("--assistant-rail"), "the page was not asked to step aside").toBe("3rem");
  });

  it("leaves when the answer is 'not a member' — the control", async () => {
    identity.mockResolvedValueOnce({ state: "anonymous" });
    const { container } = render(<><Page /><AssistantSidebar /></>);
    await waitFor(() => expect(container.querySelector("[data-assistant-sidebar]")).toBeNull());
    expect(document.documentElement.style.getPropertyValue("--assistant-rail")).toBe("0px");
  });
});

/**
 * THE PANEL'S THREAD FOLLOWS WHAT LANDS IN IT (user report, 2026-09-06: "when
 * agents or echo reply to you in the side bar … it goes down that you need to
 * scroll down to see it").
 *
 * This panel's follow used to be an unconditional `scrollIntoView` on the
 * message list: it snatched a reader who had scrolled up, and it never ran
 * for the consent card, which is not a message. Keyed on geometry (lib/
 * threadFollow) it follows every size change while the reader is pinned and
 * none after they scroll up — and the card, being inside the observed
 * wrapper, is followed like anything else. jsdom has no ResizeObserver, so a
 * fake is installed and the test says when something changed size.
 */
describe("the panel's thread follows what lands in it", () => {
  it("the consent card is inside what the follow observes; pinned it follows, scrolled up it does not", async () => {
    const ro = installFakeResizeObserver();
    try {
      pathname.mockReturnValue("/fa/meetings");
      claims.length = 0;
      const { container } = await mount();
      await userEvent.click(document.querySelector<HTMLElement>("[data-assistant-door]")!);
      const aside = container.querySelector<HTMLElement>("[data-assistant-sidebar]")!;
      const box = aside.querySelector<HTMLElement>('[class*="overflow-y-auto"]')!;
      expect(box, "the panel's thread box").not.toBeNull();
      expect(ro.observed()).toContain(box);

      const writes: number[] = [];
      let top = 0;
      Object.defineProperty(box, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(box, "clientHeight", { value: 300, configurable: true });
      Object.defineProperty(box, "scrollTop", {
        configurable: true, get: () => top, set: (value: number) => { top = value; writes.push(value); },
      });

      /* the run hands THIS surface a write to perform — the store's own call,
         which the runner turns into the card before anything executes */
      await waitFor(() => expect(claims.length).toBeGreaterThan(0));
      const surface = claims[claims.length - 1] as {
        handleClientTool: (event: unknown) => Promise<void>;
      };
      expect(typeof surface.handleClientTool).toBe("function");
      let answered: Promise<void> | null = null;
      act(() => {
        answered = surface.handleClientTool({
          type: "client_tool_call", id: "ct-s-1", tool: "archive_task", label: "بایگانی تسک",
          args: { task_id: "t-1", title: "دکتر" }, effect: "write", requires_consent: true,
        });
      });
      const decline = await screen.findByRole("button", { name: "نه" });
      expect(screen.getByText(/بایگانی تسک/).textContent).toContain("دکتر");
      /* an archive is a write the standing yes may cover, so the card offers it
         (the control for the next case, where the button must be absent) */
      expect(screen.getByRole("button", { name: "برای این نشست" })).toBeTruthy();

      const inside = ro.observed().filter((node) => node !== box && box.contains(node));
      expect(inside.length, "one content wrapper is observed").toBe(1);
      expect(inside[0]!.contains(decline), "the card is inside the observed content").toBe(true);

      // the card's arrival is a size change; pinned, the box goes to its bottom
      ro.fire();
      expect(writes).toEqual([1000]);

      // THE CONTROL: the reader scrolled up to re-read; a later size change leaves them there
      top = 100;
      fireEvent.scroll(box);
      ro.fire();
      expect(writes).toEqual([1000]);

      // «نه» answers the run; the card leaves and nothing was performed
      await userEvent.click(decline);
      await expect(answered!).resolves.toBeUndefined();
      await waitFor(() => expect(screen.queryByRole("button", { name: "نه" })).toBeNull());
    } finally {
      ro.uninstall();
    }
  });
});

/**
 * THE CARD OFFERS THE STANDING YES ONLY WHERE IT WOULD STAND (user ruling,
 * 2026-09-06 afternoon: "yes, exclude them"). For a message to a colleague
 * the yes would cover nothing (lib/consentGrant.ts NEVER_COVERED), so the
 * button is not drawn — a person offered «برای این نشست» on a card the grant
 * ignores has been asked a question whose answer changes nothing. The archive
 * case above is the control: there the button IS drawn.
 */
describe("the card offers the standing yes only where it would stand", () => {
  it("a message to a colleague gets «اجازه می‌دهم» and «نه», and no session button", async () => {
    pathname.mockReturnValue("/fa/meetings");
    claims.length = 0;
    await mount();
    await userEvent.click(document.querySelector<HTMLElement>("[data-assistant-door]")!);
    await waitFor(() => expect(claims.length).toBeGreaterThan(0));
    const surface = claims[claims.length - 1] as { handleClientTool: (event: unknown) => Promise<void> };
    let answered: Promise<void> | null = null;
    act(() => {
      answered = surface.handleClientTool({
        type: "client_tool_call", id: "ct-s-2", tool: "send_member_message", label: "پیام به همکار",
        args: { member: "sina", message: "سلام" }, effect: "write", requires_consent: true,
      });
    });
    const decline = await screen.findByRole("button", { name: "نه" });
    expect(screen.getByRole("button", { name: "اجازه می‌دهم" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "برای این نشست" }), "a session button on a card the grant never covers").toBeNull();
    await userEvent.click(decline);
    await expect(answered!).resolves.toBeUndefined();
  });
});

/**
 * A ROLLING TAKE TAKES THE EARS, NOT THE COLUMN (user directive, 2026-09-07:
 * "when i start the meeting online and enter the room the ai assistant side
 * bar get close, it should always be at this side of the page should anyone
 * needs it").
 *
 * The 2026-08-21 rule shut the assistant when a recording started, and its own
 * words were "the orb get close" — an orb being a layer that covered the page.
 * The docked column covers nothing, and an online meeting now starts its take
 * on ARRIVAL, so the shutter fired every time somebody walked into a room.
 *
 * The pair is the test. "It stays open" alone is satisfied by a component that
 * never hears the recording at all, which would put the assistant's microphone
 * and its voice inside the take — the two things the rule is actually for.
 */
describe("a recording takes the ears and leaves the column (2026-09-07)", () => {
  it("keeps the panel open while a take is live, and still goes deaf", async () => {
    localStorage.setItem("neurai-assistant-sidebar", "1");
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
    /* the ears must be UP before the take, or "they went down" is a fact about
       a loop that never started */
    await waitFor(() => expect(loopStarted).toHaveBeenCalled());
    loopStopped.mockClear();

    await act(async () => { announceRecordingLive(true); });

    const aside = container.querySelector<HTMLElement>("[data-assistant-sidebar]")!;
    expect(aside.dataset.open, "the take closed the column").toBe("true");
    expect(container.querySelector("textarea")).not.toBeNull();
    /* and the half that must go with the recording */
    expect(loopStopped, "the assistant kept listening into the take").toHaveBeenCalled();
  });
});

/**
 * THE HEADER NAMES THE CONVERSATION AND OPENS THE OTHERS.
 *
 * Three assertions for three changes, and the switching one is the load-bearing
 * half: the sidebar could always ADOPT a stored conversation, and until this
 * menu existed nothing inside the sidebar could ask it to.
 */
describe("the assistant's header (2026-09-08)", () => {
  it("switches to a stored conversation, collapses rather than closes, and lights no lamp", async () => {
    sessions.mockReturnValue([
      { id: "s-1", title: "قرارداد", last_message_at: "2026-09-08T09:00:00Z",
        archived_at: null, created_at: "2026-09-08T08:00:00Z", message_count: 4 },
      { id: "s-2", title: null, last_message_at: "2026-09-07T09:00:00Z",
        archived_at: null, created_at: "2026-09-07T08:00:00Z", message_count: 2 },
    ]);
    localStorage.setItem("neurai-assistant-sidebar", "1");
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());

    /* THE DOT. It was `bg-accent` on a 8px circle in the header — a status
       light that stood for no status. Scoped to the header, so the composer's
       own accent is not what makes this pass. */
    const header = container.querySelector<HTMLElement>("[data-assistant-sidebar] .border-b")!;
    expect(header.querySelector(".bg-accent"), "the header still lights a lamp").toBeNull();

    /* THE BUTTON. `close` was a cross on a column that never leaves the
       screen; the glyph is asserted by NAME because a re-drawn cross would
       still be a cross. */
    const collapse = screen.getByRole("button", { name: "جمع‌کردن دستیار" });
    expect(collapse.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("collapseEnd");

    /* THE SWITCH. The trigger carries the room's name until a conversation is
       adopted, and lists what is stored — the untitled one under the history
       table's own words. */
    await userEvent.click(screen.getByRole("button", { name: "تغییر گفت‌وگو" }));
    await screen.findByRole("menuitem", { name: "قرارداد" });
    expect(screen.getByRole("menuitem", { name: /گفت‌وگوی جدید ۱/ })).not.toBeNull();

    await userEvent.click(screen.getByRole("menuitem", { name: "قرارداد" }));
    /* adopted: the store holds it, and the trigger now says which one */
    await waitFor(() => expect(assistantSnapshot().sessionId).toBe("s-1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "تغییر گفت‌وگو" }).textContent)
      .toContain("قرارداد"));
  });
});

/**
 * A CONVERSATION THAT IS GONE IS NOT A CONVERSATION THAT FAILED
 * (user report, 2026-09-15: «i get this error, check it» — the toast on the
 * meetings page).
 *
 * The handoff pointer lives in `sessionStorage` and outlives the session that
 * minted it, so a conversation its owner archived — or one belonging to an
 * identity this tab no longer has — leaves an id that answers 404 forever.
 * The restore effect re-asks on every navigation, so one dead id produced one
 * «این یکی کامل نشد.» per page change, at somebody who had not opened the
 * assistant at all. Production: thirty-seven reads of a single id in a day,
 * every one a 404.
 *
 * THE PAIR IS THE TEST. "No toast on a 404" alone passes against a panel that
 * stopped reporting failures altogether, which is the worse bug — so the
 * control drives the OTHER failure through the same path and demands the
 * toast, and demands the pointer SURVIVE, because a transport failure is the
 * kind worth retrying on the next navigation.
 */
describe("a dead conversation pointer is dropped, not reported (2026-09-15)", () => {
  beforeEach(() => {
    /* the store first: resetting it clears the pointer, so seeding before
       this would seed a pointer the reset then removes */
    resetAssistantSession();
    resetLiveConversationForTest();
    /* the default implementation, restored by hand: `clearAllMocks` clears
       what a mock RECORDED and leaves what it was told to DO, so one test's
       rejection would be the next test's answer */
    thread.mockImplementation(async () => ({ messages: [], floor: [] }));
  });

  it("drops a 404 pointer in silence, and leaves the panel usable", async () => {
    setLiveConversation("s-gone");
    thread.mockRejectedValue(new Bff(404));

    await mount();

    /* it really did ask for the stored one — without this the rest is true of
       a panel that never restores anything */
    await waitFor(() => expect(thread).toHaveBeenCalledWith("s-gone"));
    await waitFor(() => expect(liveConversation(), "the dead id is still handed on").toBeNull());
    expect(notified, "a conversation that is gone was reported as a failure").not.toHaveBeenCalled();
    /* and the panel is on a FRESH conversation rather than half-holding a
       dead one */
    expect(assistantSnapshot().sessionId).toBeNull();
  });

  it("THE CONTROL: any other failure still speaks, and keeps the pointer", async () => {
    setLiveConversation("s-live");
    thread.mockRejectedValue(new Error("the network went away"));

    await mount();

    await waitFor(() => expect(notified).toHaveBeenCalledWith("این یکی کامل نشد.", "warn"));
    expect(liveConversation(), "a retryable failure threw the conversation away").toBe("s-live");
  });
});
