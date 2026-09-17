import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, MeetingRecord } from "@/api/types";
import type { RecorderSnapshot } from "@/lib/recordingEngine";
import type { RecalledDecision } from "@/api/types";
import { meetingFixture } from "@/test/fixtures";

/**
 * The meeting page's contract facts, after the 2026-09-08 simplification
 * ("we dont need the before during after now … I just want a recording
 * screen with a spectogram showing its recording, and a button to finish"):
 *
 *  1. THERE IS NO STEPPER. The view is DERIVED from the record, so the
 *     screen cannot disagree with the pipeline and nobody can put the page
 *     into a state the record does not support. Asserted as an ABSENCE —
 *     the version that still renders three steps looks perfectly fine on
 *     its own and is only wrong against the sentence that removed them.
 *  2. THE LADDER MAPPING: the processing view's four steps are the
 *     call-status ladder wearing the reference's labels, asserted per step.
 *  3. A READY record shows the review panels, not the processing card.
 *     "failed" is named a failure, never progress.
 *  4. An unrecorded microphone meeting IS the live screen and starts its
 *     take by ARRIVING — with the meeting's own title, on the microphone.
 *  5. The live screen is a scope, a clock and one button: no whiteboard, no
 *     presentation, no video room, no rail of cards.
 *  6. The UPLOAD lane never opens a microphone, and the file the wizard
 *     handed over is sent HERE, under the processing card.
 *  7. Starting and ending are the HOST'S; a colleague is moved to the
 *     record when the host finishes.
 */
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));
/* what the page told the TRAIL, recorded rather than swallowed: with the name
   gone from the page itself (2026-09-17), the trail is where a reader learns
   which meeting they are on — so a test that only asserts the absence would
   pass against a page that had lost the title altogether. `vi.hoisted`
   because `vi.mock`'s factory is lifted above every top-level const. */
const { crumbTitles } = vi.hoisted(() => ({ crumbTitles: [] as Array<string | undefined> }));
vi.mock("@/components/platform/CrumbTitle", () => ({
  useCrumbTitle: (title?: string) => { crumbTitles.push(title); },
}));

const startSpy = vi.fn(async (_opts: unknown) => undefined);
/*
 * THE SNAPSHOT IS THE PRODUCER'S SHAPE, not a hand-picked subset of it
 * (2026-09-08). It was seven fields for as long as the page read seven; the
 * live transcript reads `captionRows`, `captions` and `liveSpeakers`, and a
 * fixture missing them did not fail as "the panel has no rows" — it THREW
 * inside the panel and reported as nine unrelated tests losing their start
 * spy. Typed as `RecorderSnapshot`, so the next field the engine grows is a
 * typecheck here rather than a mystery in whatever renders it first.
 *
 * `useSyncExternalStore` REQUIRES a stable reference — a getter that builds a
 * fresh object every call re-renders forever (the real engine's snapshot is a
 * module-level constant between changes for the same reason).
 */
const idleEngine = (): RecorderSnapshot => ({
  phase: "idle", callId: null, title: "", returnPath: null,
  recordedMs: 0, level: 0, wave: [],
  waveStartMs: 0, chapterMarks: [], quality: null,
  progress: { done: 0, pending: 0, failed: 0 }, error: null,
  captions: null, captionRows: [], liveSpeakers: [], captionsDown: false,
  previews: [], shared: false,
});
let ENGINE_SNAPSHOT: RecorderSnapshot = idleEngine();
const engineIsRecording = (callId: string) => {
  ENGINE_SNAPSHOT = {
    ...idleEngine(),
    phase: "recording", callId, recordedMs: 12_000, level: 0.4,
    wave: [0.2, 0.5, 0.3],
    captions: { finals: "", interim: "" },
  };
};
/**
 * THE SUBSCRIPTION IS REAL: a snapshot changed mid-test must move the
 * screen, because the on-air light is about a phase that arrives AFTER the
 * page is on screen. With a dead subscription the only reachable states are
 * the ones the page was born in.
 */
let pushEngine: (() => void) | null = null;
const finishSpy = vi.fn(async () => undefined);
/* pause/resume are the ENGINE's, so the page's control is asserted by what
   it CALLS — a spy here, rather than a phase this file sets by hand, which
   would pass against a button wired to nothing */
const pauseSpy = vi.fn(() => { ENGINE_SNAPSHOT = { ...ENGINE_SNAPSHOT, phase: "paused" }; pushEngine?.(); });
const resumeSpy = vi.fn(() => { ENGINE_SNAPSHOT = { ...ENGINE_SNAPSHOT, phase: "recording" }; pushEngine?.(); });
vi.mock("@/lib/recordingEngine", () => ({
  startRecording: (opts: unknown) => startSpy(opts),
  finish: () => finishSpy(),
  pause: () => pauseSpy(),
  resume: () => resumeSpy(),
  recorderSnapshot: () => ENGINE_SNAPSHOT,
  subscribeRecorder: (fn: () => void) => {
    pushEngine = fn;
    return () => { pushEngine = null; };
  },
}));

/* THE FILE THE WIZARD SENT AFTER US (2026-09-08). `takeUpload` answers once,
   the way the real module does, so a remount cannot upload twice. */
let PENDING: File | null = null;
/* the refusal reaches the NOTIFICATION BUS, not a paragraph on the page
   (the platform's every-outcome-goes-to-the-bus rule, applied here
   2026-09-08). The rule under test is unchanged — a refused file is NAMED
   and the meeting stays reachable — so only the channel moved. */
const notifyErrorSpy = vi.fn((_msg: string) => undefined);
vi.mock("@/lib/notify", () => ({
  notify: vi.fn(),
  notifyWarn: vi.fn(),
  notifyError: (msg: string) => notifyErrorSpy(msg),
}));
vi.mock("@/lib/pendingUpload", () => ({
  takeUpload: () => { const f = PENDING; PENDING = null; return f; },
}));
/** the upload the page performs — held open when a test needs the in-flight state */
let UPLOAD_GATE: Promise<{ ok: true; callId: string }> | null = null;
const uploadSpy = vi.fn(async (_file: File) =>
  UPLOAD_GATE ?? ({ ok: true as const, callId: "c-up" }));
vi.mock("@/lib/uploadFile", () => ({
  uploadAudioFile: (file: File) => uploadSpy(file),
}));

/*
 * The shared fixture (see src/test/fixtures.ts for why it is not written out
 * twice), with ONE default of this suite's own: the reader is the HOST.
 *
 * db/0202 made starting and ending a recording the host's alone, so a suite
 * whose default viewer is a stranger would exercise the refusal in every
 * case and the product in none. A test about somebody ELSE's meeting passes
 * `created_by` and reads as what it is.
 */
const meeting = (over: Partial<MeetingRecord> = {}): MeetingRecord =>
  meetingFixture({ created_by: "u-me", mode: "in_person", ...over });

/** every meeting whose id is stamped as attended (db/0202) */
const attended: string[] = [];

function call(over: Partial<Call>): Call {
  return {
    id: "c-1", title: "جلسهٔ محصول", status: "linking", source: "live",
    scope: "private", language: "fa", started_at: "2026-08-31T09:00:00.000Z",
    updated_at: "2026-08-31T09:30:00.000Z", duration_ms: 60_000, owner_id: "u-1",
    archived_at: null, deleted_at: null, purge_after: null,
    current_summary_id: null, transcript_timing: "full",
    ...over,
  } as Call;
}

let MEETING: MeetingRecord = meeting({});
let CALL: Call | null = null;
/** every PATCH body the page sent */
const patched: Record<string, unknown>[] = [];
/** every call id handed to finishCall */
const finished: string[] = [];
/*
 * ITEM 7's RECALL READ, as a SPY rather than a stub that answers nothing.
 *
 * The hook swallows every failure by design (a courtesy that failed is not
 * news), so an `api` without this function is silent in exactly the way a
 * feature nobody mounted is silent. The spy is what lets a test tell the two
 * apart — see "LIVE RECALL IS MOUNTED" below.
 */
let RECALL: RecalledDecision[] = [];
const recallSpy = vi.fn(async (_meetingId: string, _window: string) => RECALL);

/* the REAL BffError: the screen branches on `instanceof` and on its `code`,
   and a hand-written stand-in makes every instanceof answer false while the
   fixture looks right (the house rule, from miniWidgets) */
vi.mock("@/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/api/client")>("@/api/client")),
  api: {
    /* the review tab's voice picker reads the DIRECTORY; without the stub the
       panel throws and every test fails naming the transcript rather than its
       own subject */
    directory: async () => [],
    /* 0211 — the items panel resolves an `owner_id` to a colleague, so it reads
       the roster on mount. Without the stub the panel throws inside an effect and
       nine tests report as "the start spy was never called". */
    orgPeople: async () => [],
    /* the ledger's mini task list reads the board for what a commitment became */
    taskBoard: async () => ({ columns: [], tasks: [] }),
    /* 0217's re-run button on the Summary tab. It is never pressed in this file;
       the mock exists because an `api` object missing a function the tab renders
       against is a TypeError in a render, not a missing assertion. */
    extractCallDecisions: async () => ({
      call_id: "c-1", meeting_id: "m-1", claims: 0, items: 0, cards: 0, reason: null,
    }),
    /* and its ITEMS (0160) — decisions and action items are rows, and the
       panel is deliberately NOT gated on a recording */
    meetingItems: async () => [],
    addMeetingItem: async () => undefined,
    updateMeetingItem: async () => undefined,
    deleteMeetingItem: async () => undefined,
    meetingDetail: async () => MEETING,
    updateMeeting: async (_id: string, body: Record<string, unknown>) => {
      patched.push(body);
      MEETING = { ...MEETING, ...body } as MeetingRecord;
      /* LINKING A CALL BRINGS ITS STATUS WITH IT, the way db/0204's door
         does: the meeting publishes one word about the take, and a fake that
         left it null said "this take is not running" the instant the engine
         linked one — which sent the page to the record mid-recording and
         reported as "the live transcript is not on screen". */
      if (typeof body.call_id === "string") {
        MEETING = { ...MEETING, call_status: CALL?.status ?? "recording" };
      }
      return MEETING;
    },
    getCall: async () => CALL,
    /* the orphaned-take finish (2026-09-07). It MUTATES the fixture the way
       the server does — recording -> processing on both the call and the
       meeting's published status — so a test cannot pass by the page merely
       deciding to move on. */
    finishCall: async (callId: string) => {
      finished.push(callId);
      MEETING = { ...MEETING, call_status: "processing" };
      CALL = call({ status: "processing" });
      return { id: callId, status: "processing" };
    },
    me: async () => ({ id: "u-me", display_name: "سینا", display_name_en: null }),
    callNotes: async () => [],
    getSummaries: async () => [],
    getTranscript: async () => [],
    getSpeakers: async () => [],
    getCallAudio: async () => null,
    recallDecisions: (meetingId: string, window: string) => recallSpy(meetingId, window),
    /* db/0202 — the attendance stamp fires on EVERY visit to a live meeting */
    markMeetingAttended: async (id: string) => { attended.push(id); },
    createTask: vi.fn(), addCallNote: vi.fn(), deleteCallNote: vi.fn(),
  },
}));

import { MeetingPage } from "./MeetingPage";

beforeEach(() => {
  MEETING = meeting({});
  attended.length = 0;
  CALL = null;
  PENDING = null;
  UPLOAD_GATE = null;
  patched.length = 0;
  finished.length = 0;
  RECALL = [];
  recallSpy.mockClear();
  startSpy.mockClear();
  finishSpy.mockClear();
  uploadSpy.mockClear();
  notifyErrorSpy.mockClear();
  ENGINE_SNAPSHOT = idleEngine();
});

/** one processing step's row, found by its label */
function stepRow(label: string): HTMLElement {
  return screen.getByText(label).closest("li")!;
}

describe("MeetingPage", () => {
  /*
   * THE STEPPER IS GONE, and this is the assertion that says so. Every other
   * test below would pass just as well on a page that still offered three
   * steps beside the thing it is showing.
   */
  it("offers no stage navigation — the record decides what is on screen", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "تسک‌ها" })).toBeInTheDocument());

    /*
     * AND THE TAB SET IS FOUR. Asserted by NAME because the two that stayed
     * cannot
     * see them: a page still rendering «فایل‌ها» and «دستیار» satisfies every
     * other line in this file.
     */
    /* WITHIN THE TABLIST: the review tab's own panels carry tabs of their
       own, so a page-wide count answers a different question — it came back
       nine on the first run, which is the check catching its own scope. */
    const tabs = within(screen.getByRole("tablist", { name: "پس از جلسه" }));
    expect(tabs.queryByRole("tab", { name: "فایل‌ها" })).toBeNull();
    expect(tabs.queryByRole("tab", { name: "دستیار" })).toBeNull();
    expect(tabs.getAllByRole("tab")).toHaveLength(4);

    expect(screen.queryByRole("button", { name: /پیش از جلسه/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /حین جلسه/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /پس از جلسه/ })).toBeNull();
    /* and the meeting's NAME is not on this row either (2026-09-17, second
       pass): it was put in front of the tabs that morning and collided with
       the panel below — a long title and a nine-pill track do not share a
       line. The trail carries it, and the summary's document names itself. */
    expect(screen.queryByRole("heading", { name: MEETING.title })).toBeNull();
  });

  it("maps the call-status ladder onto the four steps, per step", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "linking" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("در حال پردازش جلسه")).toBeInTheDocument());

    expect(stepRow("آپلود فایل صوتی").textContent).toContain("انجام شد");
    expect(stepRow("رونویسی گفتار به متن").textContent).toContain("انجام شد");
    expect(stepRow("تفکیک و تشخیص گویندگان").textContent).toContain("در حال انجام…");
    expect(stepRow("استخراج هوشمند").textContent).not.toContain("انجام شد");
    expect(stepRow("استخراج هوشمند").textContent).not.toContain("در حال انجام…");
  });

  it("a ready record shows the review panels, not the processing card", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    /* an empty transcript on a READY call is "recorded but silent", not
       "no transcript yet" — the reference names that state and so do we */
    await waitFor(() =>
      expect(screen.getByText("صوت جلسه ضبط شد، ولی گفتاری تشخیص داده نشد")).toBeInTheDocument());
    expect(screen.queryByText("در حال پردازش جلسه")).toBeNull();
    expect(screen.getByRole("tab", { name: "تسک‌ها" })).toBeInTheDocument();
  });

  it("a failed record is named a failure, never progress", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "failed" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("پردازش این رکورد ناموفق بود.")).toBeInTheDocument());
    expect(screen.queryByText("در حال پردازش جلسه")).toBeNull();
    expect(screen.queryByText("صوت جلسه ضبط شد، ولی گفتاری تشخیص داده نشد")).toBeNull();
  });

  it("a recorded meeting opens on the record", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "نمای کلی" })).toHaveAttribute("aria-selected", "true"));
  });

  it("a record whose status cannot be read still opens on the record", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = null;
    render(<MeetingPage id="m-1" />);
    /* `getCall` answering null is "gone", a different nothing from "still
       asking" — the tabs are the meeting's and stay reachable either way */
    await waitFor(() => expect(screen.getByRole("tab", { name: "تسک‌ها" })).toBeInTheDocument());
    expect(await screen.findByText("رکورد دیگر خواندنی نیست — حذف یا پاک‌سازی شده است.")).toBeInTheDocument();
  });
});

describe("the live screen (2026-09-08)", () => {
  /*
   * ARRIVING IS THE START. Under the old shape a meeting created for NOW was
   * already a second in the past by the time the page loaded, so the landing
   * rule could not read the clock — it reads the RECORD now, which is a fact
   * rather than a comparison.
   */
  it("an unrecorded microphone meeting starts its take on arrival, once, with the meeting's mapping", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person", title: "جلسهٔ حضوری" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));

    const opts = startSpy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(opts.source).toBe("mic");
    expect(opts.title).toBe("جلسهٔ حضوری");
  });

  /*
   * THE ONLINE LANE IS A MICROPHONE TOO. `online` left the wizard on
   * 2026-09-08 and the video room left this page with it, so a meeting
   * carrying that mode is one somebody made earlier — recording it through
   * the microphone is the honest thing left to do, and asserting it is what
   * stops the shared-surface source coming back with the room that is gone.
   */
  it("a meeting still carrying the online mode records the microphone, not a shared surface", async () => {
    MEETING = meeting({ call_id: null, mode: "online" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    expect((startSpy.mock.calls[0]![0] as unknown as Record<string, unknown>).source).toBe("mic");
  });

  /*
   * THE SCREEN IS A SCOPE, A CLOCK AND ONE BUTTON. Every removed surface is
   * asserted by name: the page that still drew them renders perfectly and is
   * wrong only against the sentence that removed them.
   */
  it("carries no whiteboard, no presentation, no video and no rail of cards", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));

    for (const gone of ["وایت‌برد", "ارائه", "ویدیو", "اقدام‌های سریع", "اعضای جلسه", "دستور جلسه"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.getByLabelText("حین جلسه")).toBeInTheDocument();
  });

  /*
   * THE WORDS ARRIVE WHILE THE MEETING RUNS.
   *
   * The engine has opened a live caption lane on every take since M38 and
   * nothing on this page read it. This asserts the page READS IT — the
   * panel's own behaviour is LiveTranscript.test.tsx's subject; what belongs
   * here is that it is on screen and fed from the snapshot.
   */
  it("shows the transcript as the lane produces it", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    startSpy.mockImplementationOnce(async () => {
      ENGINE_SNAPSHOT = {
        ...idleEngine(),
        phase: "recording", callId: "c-9", recordedMs: 8_000,
        captions: { finals: "", interim: "و بعد" },
        captionRows: [{ atMs: 5_000, text: "خب، شروع کنیم." }],
        liveSpeakers: [],
      };
    });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    act(() => { pushEngine?.(); });

    expect(screen.getByText("خب، شروع کنیم.")).toBeInTheDocument();
    /* the unfinalised fragment too — it is what makes the panel read as
       live rather than as a list that updates every so often */
    expect(screen.getByText("و بعد")).toBeInTheDocument();
  });

  /*
   * THE LANE REFUSED, THE TAKE CARRIES ON. `captionsDown` had no reader on
   * this page: the engine set it when `/api/live-stt/start` failed and the
   * person saw a panel that said "listening" to a lane that was never coming
   * (M21 — an absence is said out loud). The discriminating half is the
   * recording itself: the on-air light must still be on, because the lane
   * is optional and the microphone is not.
   */
  it("says the live transcript is down while the recording itself carries on", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    startSpy.mockImplementationOnce(async () => {
      ENGINE_SNAPSHOT = {
        ...idleEngine(),
        phase: "recording", callId: "c-9", recordedMs: 8_000,
        captions: null, captionsDown: true,
      };
    });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    act(() => { pushEngine?.(); });

    expect(screen.getByText("رونوشت زنده در دسترس نیست — ضبط بدون آن ادامه دارد.")).toBeInTheDocument();
    /* not "listening", not "starts with the recording" — one word for every
       nothing is the fault this state exists to name */
    expect(screen.queryByText(/در حال شنیدن/)).toBeNull();
    expect(screen.queryByText("رونویسی با شروع ضبط آغاز می‌شود.")).toBeNull();
    expect(screen.getAllByRole("status").some((el) => el.textContent?.includes("در حال ضبط"))).toBe(true);
  });

  /*
   * … AND STOPPING HANDS THE MEETING OVER (the directive's other half: "I
   * should be able to then stop the recording which will automatically move
   * me to the summary part"). The record is what moves the page, so this
   * walks the whole way: press finish, the take ends, the tabs appear.
   */
  it("finishing the take moves the page to the record, transcript and all", async () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person" });
    engineIsRecording("c-1");
    CALL = call({ status: "recording" });
    render(<MeetingPage id="m-1" />);
    expect(await screen.findByLabelText("حین جلسه")).toBeInTheDocument();

    finishSpy.mockImplementationOnce(async () => {
      ENGINE_SNAPSHOT = idleEngine();
      MEETING = { ...MEETING, call_status: "ready" };
      CALL = call({ status: "ready" });
    });
    await userEvent.click(screen.getByRole("button", { name: "پایان و پردازش" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "نمای کلی" })).toBeInTheDocument());
    /* the live screen is GONE — a page that showed both would be two
       transcripts of one meeting on one screen */
    expect(screen.queryByLabelText("حین جلسه")).toBeNull();
    expect(screen.getByRole("tab", { name: "تسک‌ها" })).toBeInTheDocument();
  });

  /*
   * THE ON-AIR LIGHT.
   *
   * `starting` is the half worth a test: it is the stretch where the browser
   * is asking for a microphone — no clock, nothing captured — and it is
   * exactly when somebody who has just pressed RECORD NOW is looking for a
   * sign and pressing again if there is none.
   */
  it("says it is recording from the first moment — before the clock has a second on it", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    /* set INSIDE the call because the page reads the phase back the moment
       `startRecording` resolves, and reads an untouched "idle" as a take
       that never began */
    startSpy.mockImplementationOnce(async () => {
      ENGINE_SNAPSHOT = { ...idleEngine(), phase: "starting" };
    });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));

    /* ONE announcement since 2026-09-16, when the light joined the scope and
       the two acts in a single row and the top bar's pill retired — there
       had been two, agreeing, six pixels apart. The assertion is still
       written over ALL of them rather than over the first: what must never
       happen is two lights DISAGREEING, and phrasing it this way is what
       makes the day a second one returns a red instead of a pass. */
    const onAir = (word: string) =>
      screen.getAllByRole("status").filter((el) => (el.textContent ?? "").includes(word));
    act(() => { pushEngine?.(); });
    expect(onAir("در حال شروع ضبط")).toHaveLength(screen.getAllByRole("status").length);

    act(() => {
      ENGINE_SNAPSHOT = {
        ...idleEngine(),
        phase: "recording", callId: "c-9", recordedMs: 3_000, level: 0.3, wave: [0.1],
      };
      pushEngine?.();
    });
    /* the WORD and the clock together — a counter in a red pill is a thing
       you have to already know how to read */
    expect(onAir("در حال ضبط").length).toBeGreaterThan(0);
    expect(onAir("۰:۰۳").length).toBeGreaterThan(0);
  });

  it("links the record the engine hands back — and only the take this page started", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    /* the engine must be LIVE when `startRecording` resolves: resolution is
       not success, and a page that reads back "idle" correctly treats its
       own start as refused and links nothing */
    startSpy.mockImplementationOnce(async () => { engineIsRecording("c-new"); });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));

    act(() => { pushEngine?.(); });
    await waitFor(() => expect(patched).toContainEqual({ call_id: "c-new" }));
  });

  it("stamps attendance on a live meeting, and never on an upload", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(attended).toEqual(["m-1"]));
  });

  /*
   * ── LIVE RECALL IS MOUNTED, and why it had to be proved HERE ────────────
   *
   * `src/lib/liveRecall.test.tsx` has nine tests and mounts its own harness
   * around the hook, so every one of them passes with this PAGE rendering
   * nothing at all. That is the right subject for the hook's throttles and it
   * leaves one thing unsayable: an unmounted feature and a feature being
   * deliberately quiet are the same observation. Which is exactly how this one
   * came to be built whole — the core door, the hook, the cards, the BFF route,
   * db/0214 — with its only mount point on a stage that had been deleted.
   *
   * So the subject here is the WIRING, in both directions: the host's live take
   * renders the cards, and the finished record does not even ask.
   */
  const recalled = {
    id: "d-1", kind: "decision", body: "قرارداد با NAI تمدید شد", status: "standing",
    meeting_id: "m-0", meeting_title: "جلسهٔ قبل", decided_at: "2026-08-20T10:00:00.000Z",
    owner_id: null, due_on: null, shared: 0,
  };
  /* enough words to clear the hook's `MIN_NEW_CHARS` throttle — a shorter window
     is a silence the hook chose, which is the opposite of the subject */
  const talking = "تصمیم‌ها را مرور کنیم. ".repeat(12);

  it("RENDERS the recall cards on the host's live take", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    RECALL = [recalled];
    startSpy.mockImplementationOnce(async () => {
      ENGINE_SNAPSHOT = {
        ...idleEngine(),
        phase: "recording", callId: "c-9", recordedMs: 8_000,
        captions: { finals: talking, interim: "" }, captionRows: [], liveSpeakers: [],
      };
    });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    act(() => { pushEngine?.(); });

    /* the page ASKED, about this meeting, with the live transcript's tail */
    await waitFor(() => expect(recallSpy).toHaveBeenCalled());
    expect(recallSpy.mock.calls[0]![0]).toBe("m-1");
    expect(recallSpy.mock.calls[0]![1]).toContain("تصمیم‌ها را مرور کنیم.");
    /* …and the answer is on the stage, in the catalogue's own words */
    expect(await screen.findByText("قرارداد با NAI تمدید شد")).toBeInTheDocument();
    expect(screen.getByText("پیش‌تر تصمیم‌گیری شده")).toBeInTheDocument();
  });

  it("and NOT on the finished record: the uploaded-file path never even asks", async () => {
    /*
     * THE DISCRIMINATING HALF. The stub WOULD answer with a card, so a page that
     * mounted recall everywhere shows one here — over a record that is already
     * processed, where "what did we decide about this last time" is not a
     * question anybody is mid-sentence on. Asserted on the REQUEST as well as the
     * card, because a mounted hook that merely found nothing is a different state
     * from one that was never enabled, and only the request can tell them apart.
     */
    MEETING = meeting({ call_id: "c-1", mode: "upload" });
    CALL = call({ status: "ready" });
    RECALL = [recalled];
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "تسک‌ها" })).toBeInTheDocument());

    expect(recallSpy, "recall asked about a record that is already finished").not.toHaveBeenCalled();
    expect(screen.queryByText("قرارداد با NAI تمدید شد")).toBeNull();
  });

  it("and not on a COLLEAGUE's screen during the same take", async () => {
    /*
     * The other half of the gate (`isHost && live`), and it is about
     * INTERRUPTION rather than permission: a decision is readable by everybody
     * who can read its meeting and the server enforces exactly that. A card on
     * ten screens mid-sentence is a broadcast, and a wrong one is a public wrong
     * statement somebody has to correct out loud.
     */
    MEETING = meeting({
      call_id: "c-9", call_status: "recording", created_by: "u-host", mode: "in_person",
    });
    CALL = call({ id: "c-9", status: "recording" });
    RECALL = [recalled];
    ENGINE_SNAPSHOT = {
      ...idleEngine(),
      phase: "recording", callId: "c-9", recordedMs: 8_000,
      captions: { finals: talking, interim: "" },
    };
    render(<MeetingPage id="m-1" />);
    /* the colleague IS on the live screen — without this the test could pass by
       rendering some other view entirely */
    expect((await screen.findAllByRole("status")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("حین جلسه")).toBeInTheDocument();

    expect(recallSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("قرارداد با NAI تمدید شد")).toBeNull();
  });
});

describe("the upload lane (2026-09-08)", () => {
  it("never opens a microphone", async () => {
    MEETING = meeting({ call_id: null, mode: "upload" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("هنوز رکوردی از این جلسه نیست.")).toBeInTheDocument());
    expect(startSpy).not.toHaveBeenCalled();
    expect(attended).toEqual([]);
    /* the way back when the wizard's file never arrived: a picker, never a
       button that could open a microphone */
    expect(screen.getByRole("button", { name: /آپلود فایل/ })).toBeInTheDocument();
  });

  /*
   * THE FILE THE WIZARD SENT AFTER US — the whole point of the change: the
   * wizard used to hold the person on its own step while the audio uploaded,
   * with nothing to watch, rather than moving them on to a page where the
   * upload can be seen landing.
   *
   * The processing card DURING the send is the assertion that matters: a
   * version that uploads here and shows nothing until it lands would satisfy
   * "the file is sent" and leave the person on a blank screen, which is the
   * state this change exists to remove.
   */
  it("sends the file the wizard handed over, under the processing card, and links it", async () => {
    MEETING = meeting({ call_id: null, mode: "upload", title: "ضبط قدیمی" });
    PENDING = new File(["x"], "jalase.m4a", { type: "audio/mp4" });
    let land: (r: { ok: true; callId: string }) => void = () => undefined;
    UPLOAD_GATE = new Promise((resolve) => { land = resolve; });

    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    expect(uploadSpy.mock.calls[0]![0]).toBe(PENDING ?? uploadSpy.mock.calls[0]![0]);

    /* IN FLIGHT: the pipeline's own card, at its first step */
    expect(await screen.findByText("در حال پردازش جلسه")).toBeInTheDocument();
    expect(stepRow("آپلود فایل صوتی").textContent).toContain("در حال انجام…");

    CALL = call({ status: "processing" });
    await act(async () => { land({ ok: true, callId: "c-up" }); await Promise.resolve(); });
    await waitFor(() => expect(patched).toContainEqual({ call_id: "c-up" }));
  });

  it("takes the file ONCE — a remount must not send it twice", async () => {
    MEETING = meeting({ call_id: null, mode: "upload" });
    PENDING = new File(["x"], "jalase.m4a", { type: "audio/mp4" });
    const view = render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    view.rerender(<MeetingPage id="m-1" />);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it("a refused file says WHICH refusal, and leaves the meeting reachable", async () => {
    MEETING = meeting({ call_id: null, mode: "upload" });
    PENDING = new File(["x"], "notes.txt", { type: "text/plain" });
    uploadSpy.mockImplementationOnce(async () => ({ ok: false, reason: "notAudio" }) as never);
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(notifyErrorSpy).toHaveBeenCalledWith("این فایل صوتی نیست."));
    /* and the meeting is still reachable, with its own picker — a refusal
       must not leave a row nobody can finish */
    expect(screen.getByRole("button", { name: /آپلود فایل/ })).toBeInTheDocument();
  });
});

describe("the recording belongs to the host (db/0202)", () => {
  it("a colleague neither starts a take nor is offered the end", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person", created_by: "u-host" });
    render(<MeetingPage id="m-1" />);
    /* the SENTENCE, not a disabled button: a greyed «پایان و پردازش» is a
       promise the product will not keep */
    expect(await screen.findByText("شروع و پایان ضبط با میزبان است.")).toBeInTheDocument();
    expect(startSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "پایان و پردازش" })).toBeNull();
  });

  it("THE HOST still starts — without which the refusal above passes against a wall that refuses everybody", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("شروع و پایان ضبط با میزبان است.")).toBeNull();
  });

  it("ENDING is the host's: on one live take the host is offered «پایان و پردازش» and a colleague is not", async () => {
    for (const asHost of [true, false]) {
      MEETING = meeting({
        call_id: "c-1", call_status: "recording", mode: "in_person",
        created_by: asHost ? "u-me" : "u-host",
      });
      engineIsRecording("c-1");
      const view = render(<MeetingPage id="m-1" />);
      const found = await screen.findAllByRole("status");
      expect(found.length).toBeGreaterThan(0);
      if (asHost) {
        expect(screen.getByRole("button", { name: "پایان و پردازش" })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "پایان و پردازش" })).toBeNull();
      }
      view.unmount();
    }
  });

  /*
   * PAUSE AND CONTINUE. Three facts, and the third is the one a
   * button wired to nothing would still satisfy: the control CALLS the
   * engine, it turns into resume once the phase moves, and while it is
   * paused the screen stops claiming a recording is being made — the pill's
   * word, its still dot, and the scope's halo all follow the phase rather
   * than `recordingLive`, which stays true through a pause by design.
   */
  it("the host can pause a live take and continue it", async () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person" });
    engineIsRecording("c-1");
    render(<MeetingPage id="m-1" />);

    await userEvent.click(await screen.findByRole("button", { name: "مکث" }));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    /* the same control, now the other way round — a second «مکث» here would
       be a screen that cannot say what state the take is in */
    const back = await screen.findByRole("button", { name: "ادامه" });
    expect(screen.queryByRole("button", { name: "مکث" })).toBeNull();
    /* and the page stops saying it is recording */
    expect(screen.getAllByText("مکث شده").length).toBeGreaterThan(0);
    expect(screen.queryByText("در حال ضبط")).toBeNull();

    await userEvent.click(back);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "مکث" })).toBeInTheDocument();
  });

  it("a colleague is offered no pause — every start and every end is the host's", async () => {
    MEETING = meeting({
      call_id: "c-1", call_status: "recording", mode: "in_person", created_by: "u-host",
    });
    engineIsRecording("c-1");
    render(<MeetingPage id="m-1" />);
    await screen.findAllByRole("status");
    expect(screen.queryByRole("button", { name: "مکث" })).toBeNull();
  });

  it("the host's finish hands the take to the pipeline and re-reads the record", async () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person" });
    engineIsRecording("c-1");
    CALL = call({ status: "recording" });
    render(<MeetingPage id="m-1" />);

    /* the engine's own stop, as the server sees it: the take ends and the
       call leaves `recording`. Written INSIDE the mock because the page
       re-reads the meeting the moment finish resolves — a mutation after
       the click would land after that read and the test would be asserting
       its own timing rather than the page's. */
    finishSpy.mockImplementationOnce(async () => {
      ENGINE_SNAPSHOT = idleEngine();
      MEETING = { ...MEETING, call_status: "processing" };
      CALL = call({ status: "processing" });
    });
    await userEvent.click(await screen.findByRole("button", { name: "پایان و پردازش" }));
    expect(finishSpy).toHaveBeenCalledTimes(1);
    /* the RECORD is what moves the page on, not a stage this button sets */
    await waitFor(() => expect(screen.getByRole("tab", { name: "نمای کلی" })).toBeInTheDocument());
  });

  it("the session closes for everyone: a colleague's page moves to the record when the host finishes", async () => {
    vi.useFakeTimers();
    try {
      MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person", created_by: "u-host" });
      render(<MeetingPage id="m-1" />);
      await vi.waitFor(() =>
        expect(screen.getByText("شروع و پایان ضبط با میزبان است.")).toBeInTheDocument());

      /* the host finishes — the take stops running, which is the fact the
         poll waits for; the RECORD appearing is not (it appears when the
         host presses START) */
      MEETING = { ...MEETING, call_status: "processing" };
      CALL = call({ status: "processing" });
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      await vi.waitFor(() => expect(screen.getByRole("tab", { name: "نمای کلی" })).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a reload is not a finish (2026-09-07)", () => {
  it("the host reloading mid-take lands back on the live screen, not on the artifacts", async () => {
    /* the record exists from the first second, so `call_id` is NOT the word
       that means finished — the CALL leaving `recording` is */
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person" });
    render(<MeetingPage id="m-1" />);
    expect(await screen.findByLabelText("حین جلسه")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "نمای کلی" })).toBeNull();
  });

  it("the take that outlived its engine is finished from the page, and THAT is what moves it on", async () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person" });
    /* the engine is GONE — a reload destroyed it — so nothing local can end
       this take and `beginTake` rightly refuses a meeting that has a record */
    render(<MeetingPage id="m-1" />);
    expect(await screen.findByText(/این ضبط با بسته شدن یا تازه‌سازی صفحه قطع شد/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "پایان و پردازش" }));
    await waitFor(() => expect(finished).toEqual(["c-1"]));
    await waitFor(() => expect(screen.getByRole("tab", { name: "نمای کلی" })).toBeInTheDocument());
  });

  it("a colleague is offered no such button — finishing is the host's, however the take was orphaned", async () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person", created_by: "u-host" });
    render(<MeetingPage id="m-1" />);
    expect(await screen.findByText("شروع و پایان ضبط با میزبان است.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "پایان و پردازش" })).toBeNull();
  });
});

/*
 * THE TRANSCRIPT SCROLLS INSIDE ITS PANEL (observed 2026-09-08: the
 * transcript grew without bound instead of scrolling in its panel).
 *
 * A SOURCE read, and deliberately: jsdom lays nothing out, so no rendered
 * assertion here can tell a bounded column from an unbounded one — a test
 * that queried the DOM would pass in both worlds, which is how the panel came
 * to carry `overflow-y-auto` for months while the page scrolled instead.
 *
 * The scroller was never missing. What was missing is something ABOVE it with
 * a height, and in this scaffold that is exactly one thing a page opts into
 * out loud. So the assertion is the pair: the panel asks to scroll, and the
 * route grants it a bounded column.
 */
describe("the record's own scroll", () => {
  const read = (rel: string) => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    return fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8");
  };

  it("the meeting route fills the height the shell grants", () => {
    const route = read("app/[locale]/meetings/[id]/page.tsx");
    expect(route).toMatch(/<PageContainer[^>]* fill[ >]/);
  });

  it("the transcript panel is the box that scrolls", () => {
    /* the control for the line above: `fill` on a page whose panels grow with
       their content clips them instead of scrolling them, which is a worse
       bug than the one being fixed */
    const review = read("components/platform/meeting/Review.tsx");
    expect(review).toContain("min-h-0 flex-1 space-y-3 overflow-y-auto");
  });

  it("the two document tabs bring their own scroller", () => {
    /* «یادداشت‌های من» and «صورت‌جلسه» are as tall as their content — in a
       filling column they need SectionScroller or they are cut off */
    const page = read("components/platform/MeetingPage.tsx");
    expect(page.match(/<SectionScroller>/g) ?? []).toHaveLength(2);
  });
});

describe("the recording bar, and the words under it (2026-09-15)", () => {
  /*
   * Two user directives from one set of screenshots: "the recording bar …
   * make it smaller like the last image, something small and clean", and
   * "the live transcription when the record started went to scroll mode and
   * showed me the bottom of it and i didnt see the text — fix it that the
   * page always follow the text".
   *
   * The second one had a precise cause: the transcript reserved 224px under
   * its last line for the recall cards that floated over its foot, and on a
   * laptop that reservation WAS the box — the follow pinned to an empty
   * bottom and the words sat above the fold. So the floor is gone and the
   * cards float over the transcript's TOP corner instead. Both are asserted
   * here, on the page, because the page is where the floor was passed in.
   */
  const recalled = {
    id: "d-1", kind: "decision", body: "قرارداد با NAI تمدید شد", status: "standing",
    meeting_id: "m-0", meeting_title: "جلسهٔ قبل", decided_at: "2026-08-20T10:00:00.000Z",
    owner_id: null, due_on: null, shared: 0,
  };
  const talking = "تصمیم‌ها را مرور کنیم. ".repeat(12);

  const liveTake = () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    startSpy.mockImplementationOnce(async () => {
      ENGINE_SNAPSHOT = {
        ...idleEngine(),
        phase: "recording", callId: "c-9", recordedMs: 8_000,
        captions: { finals: talking, interim: "" },
        captionRows: [{ atMs: 5_000, text: "خب، شروع کنیم." }],
        liveSpeakers: [],
      };
    });
  };

  it("draws the take as ONE bar — the strip beside the clock in a single card, no hall over the words", async () => {
    liveTake();
    const { container } = render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    act(() => { pushEngine?.(); });

    const scope = container.querySelector(".wave-scope") as HTMLElement | null;
    expect(scope, "the scope rendered").not.toBeNull();
    expect(scope!.className).toContain("wave-scope-strip");
    expect(scope!.className).toContain("h-8");
    expect(scope!.className).not.toContain("h-28");
    /* the clock rides in the SAME card as the strip — one instrument, the
       player bar's own shape — and nowhere as a heading */
    const bar = scope!.closest(".card") as HTMLElement | null;
    expect(bar, "the strip sits in a card row").not.toBeNull();
    expect(bar!.querySelector(".tabular-nums")).not.toBeNull();
    expect(container.querySelector(".text-3xl")).toBeNull();
  });

  it("reserves NO floor under the transcript, and floats the recall cards over its TOP corner", async () => {
    liveTake();
    RECALL = [recalled];
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    act(() => { pushEngine?.(); });
    await waitFor(() => expect(recallSpy).toHaveBeenCalled());

    const transcript = screen.getByRole("region", { name: "رونویسی زنده" });
    const scroller = transcript.querySelector(".overflow-y-auto") as HTMLElement | null;
    expect(scroller, "the transcript's scroller rendered (a row is on it)").not.toBeNull();
    expect(scroller!.className).not.toMatch(/\bpb-/);

    const stack = (await screen.findByText("قرارداد با NAI تمدید شد")).closest(".absolute") as HTMLElement;
    expect(stack.className).toMatch(/\btop-/);
    expect(stack.className).not.toMatch(/\bbottom-/);
    /* over the TRANSCRIPT, not the stage: the stack and the words share one
       relative box, so the cards cannot land on the bar above */
    expect(stack.parentElement).toBe(transcript.parentElement);
    expect(stack.parentElement!.className).toContain("relative");
  });
});

describe("the take's one row, and the people beside it (2026-09-16)", () => {
  /*
   * User directive, on the third of five designs: "use the third design with
   * a main column for live transcription and attendances, and for the sound
   * bar and the buttons use one row with a red alarming recording icon
   * without text and digits on the left side of the bar, and the pause and
   * finish on the right side".
   *
   * Four of these assertions are about WHERE things are, which is unusual for
   * this file and is the point: the light, the clock, the scope and the two
   * acts were spread across a top bar and a card below it, and the directive
   * is that they become one instrument. DOM order is the honest way to say
   * "left" and "right" here, because the row is `dir="ltr"` — that attribute
   * is what makes the first child the left end in both locales, so it is
   * asserted beside the order rather than assumed.
   */
  const liveTake = () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person" });
    engineIsRecording("c-1");
  };
  /** the one row: the card the scope sits in */
  const theRow = (container: HTMLElement) =>
    (container.querySelector(".wave-scope") as HTMLElement).closest(".card") as HTMLElement;

  it("holds the light, the clock, the scope and the two acts in ONE row", async () => {
    liveTake();
    const { container } = render(<MeetingPage id="m-1" />);
    await screen.findByRole("status");

    const row = theRow(container);
    expect(row, "the scope sits in a card row").not.toBeNull();
    expect(within(row).getByRole("status")).toBeInTheDocument();
    expect(within(row).getByText("۰:۱۲")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "مکث" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "پایان و پردازش" })).toBeInTheDocument();
  });

  it("puts the light and the clock at one end and the two buttons at the other", async () => {
    liveTake();
    const { container } = render(<MeetingPage id="m-1" />);
    await screen.findByRole("status");

    const row = theRow(container);
    /* the attribute that makes the order below mean left-to-right rather
       than the reading direction of the page around it */
    expect(row.getAttribute("dir")).toBe("ltr");
    const kids = [...row.children];
    const at = (test: (el: Element) => boolean) => kids.findIndex(test);
    const light = at((el) => el.getAttribute("role") === "status");
    const scope = at((el) => el.classList.contains("wave-scope") || el.querySelector(".wave-scope") !== null);
    const acts = at((el) => el.querySelector("button") !== null);
    expect(light).toBeGreaterThanOrEqual(0);
    expect(light).toBeLessThan(scope);
    expect(scope).toBeLessThan(acts);
    /* and within the acts, the reversible one first — which leaves the
       page's one destructive-shaped act at the far end of the row */
    const buttons = [...kids[acts]!.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent))
      .toEqual(["مکث", "پایان و پردازش"]);
    /*
     * DOM order is only the claim while nothing re-orders the row on screen,
     * and jsdom lays nothing out — so the two utilities that would move the
     * buttons to the left end while every assertion above still passed are
     * named here. Without this the check is a proxy for the thing the
     * directive is about rather than the thing itself.
     */
    expect(row.getAttribute("class")).not.toMatch(/flex-row-reverse/);
    for (const kid of kids) {
      expect(kid.getAttribute("class") ?? "").not.toMatch(/\border-(first|last|none|\d)/);
    }
  });

  it("the light carries no words on screen, and still announces itself", async () => {
    liveTake();
    render(<MeetingPage id="m-1" />);
    const light = await screen.findByRole("status");

    /* the words are the directive's "without text" — present for a reader
       who cannot see a red dot, hidden from the one who can. `role="status"`
       with nothing in it announces nothing, which is why they stay. */
    const word = within(light).getByText("در حال ضبط");
    expect(word.className).toContain("sr-only");
    /* what is left on screen beside the icon is the digits, and only those */
    expect(light.textContent?.replace("در حال ضبط", "").trim()).toBe("۰:۱۲");
  });

  it("says it ONCE — the top bar's pill is gone rather than duplicated", async () => {
    liveTake();
    const { container } = render(<MeetingPage id="m-1" />);
    await screen.findByRole("status");

    /* the discriminating half: a page that ADDED the row and kept the old
       pill would satisfy every assertion above and show two lights that must
       never disagree */
    const lights = screen.getAllByRole("status");
    expect(lights).toHaveLength(1);
    expect(theRow(container).contains(lights[0]!)).toBe(true);
  });

  it("a colleague gets the light and the clock and no controls at all", async () => {
    MEETING = meeting({
      call_id: "c-1", call_status: "recording", mode: "in_person", created_by: "u-host",
    });
    engineIsRecording("c-1");
    const { container } = render(<MeetingPage id="m-1" />);
    await screen.findByRole("status");

    const row = theRow(container);
    expect(within(row).getByText("۰:۱۲")).toBeInTheDocument();
    expect(row.querySelector("button")).toBeNull();
  });

  it("stands the people beside the words, in one row of the stage", async () => {
    liveTake();
    render(<MeetingPage id="m-1" />);
    const rail = await screen.findByRole("region", { name: "شرکت‌کنندگان" });
    const transcript = screen.getByRole("region", { name: "رونویسی زنده" });

    /* «beside»: the transcript's own box and the rail share a parent, and
       that parent is the row — stacked at laptop widths, side by side above
       `lg`, which is the one place this layout decision is written */
    const columns = rail.parentElement!;
    expect(columns).toBe(transcript.parentElement!.parentElement);
    expect(columns.className).toContain("lg:flex-row");
    /* the host is in the room by construction, and the colleague nobody
       stamped is listed without any claim about where they were */
    expect(within(rail).getByText("۱ در جلسه")).toBeInTheDocument();
  });
});

describe("the page says which meeting it is exactly once (2026-09-17)", () => {
  /*
   * TWO DIRECTIVES IN ONE DAY, and the second reverses the first — recorded
   * here because the reversal is the finding:
   *
   *   morning  "remove the name of the meeting from the top inside the page —
   *            instead add it in front of overview, into the content."
   *   evening  "remove the name of the meeting that is hanging behind in the
   *            sub menu on top, we don't need it there" — with screenshots of
   *            a real meeting where it did exactly that: «جلسه بررسی پلتفرم»
   *            wrapped off the tab row and sat over «رونوشت جلسه».
   *
   * A long title and a nine-pill track cannot share one line. So the page
   * carries NO name of its own now, and the claim worth pinning is that
   * absence — plus the two places the name still is, which is what makes the
   * absence safe rather than a screen that never says which meeting it is.
   */
  it("keeps the name off the tab row, where it collided with the panel", async () => {
    MEETING = meeting({ call_id: "c-1", title: "جلسهٔ فروش" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);

    const tablist = await screen.findByRole("tablist", { name: "پس از جلسه" });
    /* nothing but tabs on that row */
    expect(within(tablist.parentElement!).queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("heading", { name: "جلسهٔ فروش" })).toBeNull();
    /* THE CONTROL, and the reason the absence is not a regression: the trail
       is told the title (the shell renders it), and the summary tab's own
       document names itself — asserted in Summary.test.tsx. A page that had
       simply stopped knowing its meeting would fail here. */
    expect(crumbTitles.at(-1)).toBe("جلسهٔ فروش");
  });

  it("gives a live take no title block at all — the trail is where the name is", async () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", title: "جلسهٔ فروش" });
    engineIsRecording("c-1");
    render(<MeetingPage id="m-1" />);
    await screen.findByRole("status");

    /* the page's top bar is GONE on the ordinary take, heading and all: with
       the name moved, what was left was an empty flex child spending the
       column's gap above the stage */
    expect(screen.queryByRole("heading", { name: "جلسهٔ فروش" })).toBeNull();
    /* the CONTROL — it is the title that left, not the stage: the take's own
       row is still there, with the finish on it */
    expect(screen.getByRole("button", { name: "پایان و پردازش" })).toBeInTheDocument();
  });
});
