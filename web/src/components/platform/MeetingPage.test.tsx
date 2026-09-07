import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, MeetingRecord } from "@/api/types";
import { meetingFixture } from "@/test/fixtures";
import { __setPreferencesForTest } from "@/lib/preferences";

/**
 * The meeting page's contract facts (the big-milestone shape):
 *
 *  1. THE LADDER MAPPING is the load-bearing one: the processing view's
 *     four steps are the call-status ladder wearing the reference's labels
 *     — asserted PER STEP. (Verified red by breaking ladderIndex to a
 *     constant: the per-step assertions failed.)
 *  2. A READY record shows the review panels (transcript + extraction),
 *     not the processing card — the states are exclusive.
 *  3. "failed" is named a failure, never progress.
 *  4. An unrecorded meeting opens on its PLAN however overdue it is, and
 *     its post stage names the absence; a recorded one opens on post.
 *  5. Starting hands the ENGINE the meeting's mapping (online → system
 *     source, the meeting's own title) — the engine is the only recorder.
 */
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));
vi.mock("@/components/platform/CrumbTitle", () => ({
  useCrumbTitle: () => undefined,
}));
/* the canvas is its own subject — here it only needs to exist */
vi.mock("./meeting/Whiteboard", () => ({
  Whiteboard: () => <div data-testid="whiteboard-stub" />,
}));
/* so is the video room: LiveKit opens a real WebSocket the moment it renders,
   and jsdom has no WebRTC — an unmocked room throws mid-render, which takes
   the whole page down and reports as "the stepper is missing" */
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) =>
    <div data-testid="livekit-room">{children}</div>,
  GridLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ParticipantTile: () => <div />,
  ControlBar: () => <div />,
  RoomAudioRenderer: () => null,
  useTracks: () => [],
}));

const startSpy = vi.fn(async (_opts: unknown) => undefined);
const tokenSpy = vi.fn((_id: string) => undefined);
/* useSyncExternalStore REQUIRES a stable snapshot reference — a getter that
   builds a fresh object every call re-renders forever (the real engine's
   snapshot is a module-level constant between changes for the same reason).
   SETTABLE since 2026-09-06, and only ever between tests: a suite whose
   engine is frozen at "idle" cannot represent a take in progress, so the
   end button — half of the host rule — was unreachable by any assertion. */
let ENGINE_SNAPSHOT: { phase: string; callId: string | null; recordedMs: number } =
  { phase: "idle", callId: null, recordedMs: 0 };
const engineIsRecording = (callId: string) => {
  ENGINE_SNAPSHOT = { phase: "recording", callId, recordedMs: 12_000 };
};
vi.mock("@/lib/recordingEngine", () => ({
  startRecording: (opts: unknown) => startSpy(opts),
  finish: vi.fn(async () => undefined),
  recorderSnapshot: () => ENGINE_SNAPSHOT,
  subscribeRecorder: () => () => undefined,
}));

/*
 * The shared fixture (see src/test/fixtures.ts for why it is not written out
 * twice), with ONE default of this suite's own: the reader is the HOST.
 *
 * db/0202 made starting and ending a recording the host's alone, and almost
 * every test here is about running a meeting — so a stranger as the default
 * viewer would exercise the refusal in every case and the product in none.
 * It lives on the wrapper rather than in `beforeEach` because each test
 * builds its own record, and an override there is silently discarded.
 * A test about somebody ELSE's meeting passes `created_by` and reads as
 * what it is.
 */
const meeting = (over: Partial<MeetingRecord> = {}): MeetingRecord =>
  meetingFixture({ created_by: "u-me", ...over });

/* db/0202's roster: who was ADDED, who was STAMPED, and the directory the
   dialog picks from */
const added: string[][] = [];
const removed: string[] = [];
const attended: string[] = [];
let PEOPLE: Array<{ id: string; display_name: string; display_name_en: string | null; username: string | null; role: string }> = [];
const personRow = (id: string) => ({
  user_id: id, display_name: id, display_name_en: null, username: null, attended: false,
});

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
/* a read that stays IN FLIGHT until the test says so — the only way the
   loading state is a state at all; a mock that resolves at once renders the
   frame for no measurable moment (audit finding, 2026-09-02) */
let DETAIL_GATE: Promise<MeetingRecord> | null = null;
/** every PATCH body the page sent */
const patched: Record<string, unknown>[] = [];
/** every call id handed to finishCall */
const finished: string[] = [];

/* the REAL BffError: the screen branches on `instanceof` and on its `code`,
   and a hand-written stand-in makes every instanceof answer false while the
   fixture looks right (the house rule, from miniWidgets) */
vi.mock("@/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/api/client")>("@/api/client")),
  api: {
    /* the plan reads its documents on mount (0159); a mock without it makes
       every meeting test fail on a render error rather than on its subject */
    meetingAttachments: async () => [],
    uploadMeetingAttachment: async () => undefined,
    deleteMeetingAttachment: async () => undefined,
    /* and its ITEMS (0160) — decisions and action items are rows now, and
       the panel is deliberately NOT gated on a recording, so this stub is
       needed by every meeting test rather than only the review ones */
    meetingItems: async () => [],
    addMeetingItem: async () => undefined,
    updateMeetingItem: async () => undefined,
    deleteMeetingItem: async () => undefined,
    meetingDetail: async () => DETAIL_GATE ?? MEETING,
    /* the edit dialog reads the topic list on mount (2026-09-04) */
    meetingTopics: async () => [],
    updateMeeting: async (_id: string, body: Record<string, unknown>) => {
      patched.push(body);
      return { ...MEETING, ...body };
    },
    getCall: async () => CALL,
    /* the orphaned-take finish (2026-09-07). It MUTATES the fixture the way
       the server does — recording -> processing on both the call and the
       meeting's published status — so a test cannot pass by the page
       merely deciding to move on. */
    finishCall: async (callId: string) => {
      finished.push(callId);
      MEETING = { ...MEETING, call_status: "processing" };
      CALL = call({ status: "processing" });
      return { id: callId, status: "processing" };
    },
    me: async () => ({ id: "u-me", display_name: "سینا", display_name_en: null }),
    taskBoard: async () => ({ columns: [], topics: [], tasks: [] }),
    callNotes: async () => [],
    getSummaries: async () => [],
    getTranscript: async () => [],
    getSpeakers: async () => [],
    getCallAudio: async () => null,
    /* the video room asks for a TOKEN now — the server mints it, so a test
       that let this reject would be testing the failure branch by accident */
    meetingRoomToken: async (id: string) => tokenSpy(id) ?? ({
      token: "t", url: "wss://example.livekit.cloud",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
    /* db/0202 — the roster and the attendance stamp. `markMeetingAttended`
       fires on EVERY visit to a held meeting, so a mock without it makes
       every stage test fail on a render error rather than on its subject. */
    markMeetingAttended: async (id: string) => { attended.push(id); },
    addMeetingAttendees: async (_id: string, ids: string[]) => {
      added.push(ids);
      return { ...MEETING, attendees: [...MEETING.attendees, ...ids.map(personRow)] };
    },
    removeMeetingAttendee: async (_id: string, userId: string) => {
      removed.push(userId);
      return { ...MEETING, attendees: MEETING.attendees.filter((a) => a.user_id !== userId) };
    },
    orgPeople: async () => PEOPLE,
    createTask: vi.fn(), addCallNote: vi.fn(), deleteCallNote: vi.fn(),
  },
}));

import { MeetingPage } from "./MeetingPage";

beforeEach(() => {
  /*
   * THE READER IS THE HOST, by default (db/0202, 2026-09-06).
   *
   * Starting and ending a recording is the host's alone now, so a suite
   * whose default viewer is a stranger would be testing the refusal in
   * every case and the product in none. The two tests that are ABOUT
   * somebody else's meeting say so on their own line, which is also what
   * makes them readable.
   */
  MEETING = meeting({});
  added.length = 0;
  removed.length = 0;
  attended.length = 0;
  PEOPLE = [];
  CALL = null;
  DETAIL_GATE = null;
  patched.length = 0;
  finished.length = 0;
  startSpy.mockClear();
  ENGINE_SNAPSHOT = { phase: "idle", callId: null, recordedMs: 0 };
  tokenSpy.mockClear();
});

/** one processing step's row, found by its label */
function stepRow(label: string): HTMLElement {
  return screen.getByText(label).closest("li")!;
}

describe("MeetingPage", () => {
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

  /* THE LANDING RULE (0148): an unrecorded meeting opens on its PLAN,
     however long ago it was scheduled. The old rule compared the scheduled
     time to now, so a meeting created FOR NOW was already a second in the
     past by the time this page loaded and dropped the person straight onto
     the live stage — the whiteboard below is what that looked like, and it
     is why this test asserts an absence. */
  it("an unrecorded meeting opens on its PLAN — never the live stage, however overdue", async () => {
    MEETING = meeting({ call_id: null, scheduled_at: "2020-01-01T09:00:00.000Z" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /پیش از جلسه/ })).toHaveAttribute("aria-current", "step");
    expect(screen.queryByTestId("whiteboard-stub")).toBeNull();

    /* and the stage is one click away — an ONLINE meeting opens it on the
       video room, which is a frame in OUR box rather than a link out, and
       the canvas is a chip on the same header */
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    expect(await screen.findByTestId("livekit-room")).toBeInTheDocument();
    expect(screen.queryByTestId("whiteboard-stub")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "وایت‌برد" }));
    expect(screen.getByTestId("whiteboard-stub")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /پس از جلسه/ }));
    expect(screen.getByText("هنوز رکوردی از این جلسه نیست.")).toBeInTheDocument();
  });

  it("names the MEETING'S host under the host badge — never whoever is looking", async () => {
    /*
     * THE BUG THIS PINS, live until 2026-09-03: the live stage's «اعضای جلسه»
     * card rendered `me` — the signed-in viewer — with the «میزبان» badge, and
     * added one to the count for them. So everybody who opened a colleague's
     * meeting was shown as its host, and the two people in a two-person
     * meeting each saw themselves listed and the other one missing.
     *
     * THE FIXTURE IS THE WHOLE TEST. The default `meeting()` host and the
     * mocked viewer are BOTH "سینا", so an assertion that "سینا is on screen"
     * passes against the bug and against the fix — indistinguishable, which is
     * how it survived. The host is renamed here so the two can be told apart,
     * and both halves are asserted: the host's name present, the viewer's
     * absent. Verified red against the old row on both.
     */
    MEETING = meeting({
      call_id: null, mode: "online", host_name: "مریم", invitees: ["رضا"],
      /* SOMEBODY ELSE'S meeting — which is the whole point of this test and,
         since 0202, also the reason the start controls are absent below */
      created_by: "u-host",
    });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));

    const members = (await screen.findByRole("heading", { name: "اعضای جلسه" })).closest("section")!;
    expect(within(members).getByText("مریم")).toBeInTheDocument();
    expect(within(members).queryByText("سینا")).toBeNull();
    /* the invitee is still listed, so this cannot pass by rendering nobody */
    expect(within(members).getByText("رضا")).toBeInTheDocument();
    /* and the count is the record's two, not three-with-the-reader */
    expect(within(members).getByText("۲")).toBeInTheDocument();
  });

  /*
   * THE ONLINE LANE STARTS ON A PRESS (user directive, 2026-09-04: "for the
   * online meetings go with face screen share to get the audio from web").
   *
   * Both halves matter and the FIRST is the one that would rot quietly.
   * Walking into the stage must NOT start an online take: the share picker
   * only opens for a gesture, so an auto-started one is refused with the
   * same error a cancelled picker raises — the person is told they
   * cancelled a dialog they were never shown. Verified red by deleting the
   * `mode === "online"` line from the auto-start effect.
   */
  it("an online meeting waits for the button, then records the SHARED TAB", async () => {
    MEETING = meeting({ call_id: null, mode: "online", title: "جلسهٔ آنلاین" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    expect(startSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    /* in the live stage, and still nothing opened */
    const start = await screen.findByRole("button", { name: /شروع ضبط/ });
    expect(startSpy).not.toHaveBeenCalled();

    await userEvent.click(start);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    const opts = startSpy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    /* "system", not "room" — the reversal. The meetings people actually
       hold are in software we do not host, and our own room can only ever
       record the people who came to OURS. */
    expect(opts.source).toBe("system");
    expect(opts.title).toBe("جلسهٔ آنلاین");
  });

  /* WALKING IN IS THE START, where nothing has to be asked for (user
     directive: the mid-meeting page should already be recording). The plan
     does NOT record — that half is the one worth asserting, because a page
     that starts a take on load would be recording a room nobody has walked
     into yet. */
  it("an in-person STAGE starts the take itself, once, with the meeting's mapping", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person", title: "جلسهٔ حضوری" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    expect(startSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    const opts = startSpy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(opts.source).toBe("mic");
    expect(opts.title).toBe("جلسهٔ حضوری");

    /* ONCE. Walking back to the plan and in again must not open a second
       take over the first — the ref, not the engine, is what makes that
       true, and without it the re-entry reads as a stranger's collision. */
    await userEvent.click(screen.getByRole("button", { name: /پیش از جلسه/ }));
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("an in-person meeting is offered no video room", async () => {
    /* the mode rule the user asked for: a meeting held in the room has no
       video room and never will, so the tab is absent rather than
       present-and-empty.

       The `source: "mic"` assertion that used to sit here is GONE, and on
       purpose — the test above owns it. Two checks that fail together for
       the same reason read as extra rigour and are a maintenance tax: the
       one that gets updated is whichever the next person finds first. */
    MEETING = meeting({ call_id: null, mode: "in_person", title: "جلسهٔ حضوری" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    expect(screen.queryByRole("button", { name: "ویدیو" })).toBeNull();
    // the canvas is what an in-person meeting opens on
    expect(screen.getByTestId("whiteboard-stub")).toBeInTheDocument();
  });

  it("the upload lane opens a FILE PICKER and never a microphone", async () => {
    MEETING = meeting({ call_id: null, mode: "upload" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    /* the load-bearing assertion: arriving on the stage must not open a mic
       for a lane whose whole premise is a file the person already has */
    expect(startSpy).not.toHaveBeenCalled();
  });

  /* THE ROOM IS THE BOX (user directive: "i dont want it to open here").
     There is nothing to mint and no link to press: an online meeting's room
     is derived from its id and driven by Jitsi's external API inside the
     stage.
     jsdom cannot load that script, so what renders here is the FALLBACK —
     and that is worth asserting for its own sake: when the embed cannot
     load, the box must say so and still hand over the room's real address.
     A silent empty rectangle is the failure this branch exists to prevent.
     The address itself is pinned in Room.test.ts, where it is a pure
     function and can be checked without a browser at all. */
  it("an online meeting's stage asks for a room token, and says so when there is none", async () => {
    /* the room is OUR components now, not a frame — jsdom cannot run a
       WebRTC connection, so what is assertable here is the hand-off: the
       stage asks the server for a token for THIS meeting. Where the token
       goes afterwards is livekit-token.test.ts's subject, on the side that
       mints it. */
    MEETING = meeting({ call_id: null, mode: "online" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));

    await waitFor(() => expect(tokenSpy).toHaveBeenCalledWith("m-1"));
  });

  /* THE FRAME BEFORE THE RECORD (audit finding, 2026-09-02). The page was a
     lone «…» until the read landed; loading.guard.test.ts cannot see an early
     `return <p>…</p>`, so this is the instrument for it. Verified red against
     the old branch on both halves: no navigation landmark, and the ellipsis
     present. The third assertion is the control — a frame is a frame, not the
     page rendered over invented data. */
  it("renders the stepper frame while the record loads — never a bare ellipsis", async () => {
    let release: (m: MeetingRecord) => void = () => undefined;
    DETAIL_GATE = new Promise<MeetingRecord>((resolve) => { release = resolve; });
    render(<MeetingPage id="m-1" />);
    expect(screen.getByRole("navigation", { name: "مراحل جلسه" })).toBeInTheDocument();
    expect(screen.queryByText("…")).toBeNull();
    expect(screen.queryByText("مشخصات")).toBeNull();

    release(meeting({}));
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /پیش از جلسه/ })).toBeInTheDocument();
  });

  it("a recorded meeting opens on the post stage", async () => {
    /* `call_status` is what makes this the CONTROL for the reload tests
       below: a page that simply always opened on the live stage would pass
       every one of them and fail this. */
    MEETING = meeting({ call_id: "c-1", call_status: "ready" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() =>
      expect(screen.getByText("صوت جلسه ضبط شد، ولی گفتاری تشخیص داده نشد")).toBeInTheDocument());
    expect(screen.queryByTestId("whiteboard-stub")).toBeNull();
  });
});

describe("the edit dialog reads the platform's clock (2026-09-06)", () => {
  afterEach(() => __setPreferencesForTest({ timezone: "auto" }));

  it("saving the plan with nothing changed keeps the instant — in the STORED zone, not the browser's", async () => {
    /*
     * The zone is one no machine running this suite sits in (UTC+14), so the
     * fixture disagrees with the browser everywhere. Until 2026-09-06 the
     * dialog prefilled its fields from `getHours()` — the browser's clock —
     * and saved them through `instantFromFields` — the stored zone — so a
     * save that touched nothing moved the meeting by the offset between the
     * two. The create dialog was fixed on 2026-09-02; this one was not.
     */
    __setPreferencesForTest({ timezone: "Pacific/Kiritimati" });
    MEETING = meeting({ call_id: null, scheduled_at: "2026-05-07T22:09:00.000Z" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole("button", { name: "ویرایش" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]!.scheduled_at).toBe("2026-05-07T22:09:00.000Z");
  });
});

/**
 * THE RECORDING IS THE HOST'S, AND THE ROSTER IS AN ACCOUNT (db/0202).
 *
 * User directive, 2026-09-06: "only the host should have the ability to start
 * the recording and share the screen for audio and only the host must have
 * the ability to finish it and after it finishes the session should be close
 * for all. no, all that come to the meeting have a ability to get it for
 * themselves as well and its a bug fix it."
 *
 * The whole matrix is walked, because asserting the refusal alone leaves the
 * ORDINARY path unproven — and the ordinary path is the product: a wall that
 * refuses everybody satisfies every "a colleague cannot" line in this block.
 */
describe("the recording belongs to the host (db/0202)", () => {
  it("a colleague walking into the stage neither starts a take nor is offered one", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person", created_by: "u-host" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));

    /* the in-person lane is the one that starts by ARRIVING, so this is the
       case where a missing wall costs a recording nobody asked for */
    await screen.findByText("شروع و پایان ضبط با میزبان است.");
    expect(startSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "پایان و پردازش" })).toBeNull();
  });

  it("the online share button is the HOST'S: they are offered it and a colleague is not", async () => {
    /*
     * THE PAIR IS THE TEST, and the first half is what makes the second
     * mean anything. Written the other way round — a colleague, and one
     * queryByRole coming back null — it passed against a mutation that
     * handed the button to everybody, because the name in the query
     * («هم‌رسانی») is not the name on the button («شروع ضبط و اشتراک صدا»)
     * and could never have matched. Found by verify-red, 2026-09-06: a
     * check that only asks "is the thing I expect absent?" cannot tell an
     * absent button from a misspelt query.
     */
    MEETING = meeting({ call_id: null, mode: "online" });
    const host = render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    await screen.findByRole("button", { name: "شروع ضبط و اشتراک صدا" });
    host.unmount();

    MEETING = meeting({ call_id: null, mode: "online", created_by: "u-host" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    await screen.findByText("شروع و پایان ضبط با میزبان است.");
    expect(screen.queryByRole("button", { name: "شروع ضبط و اشتراک صدا" })).toBeNull();
  });

  it("THE HOST still starts — the ordinary path, without which the two above pass against a wall that refuses everybody", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));

    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("شروع و پایان ضبط با میزبان است.")).toBeNull();
  });

  it("ENDING is the host's too: on one live take the host is offered «پایان و پردازش» and a colleague is not", async () => {
    /*
     * A reload mid-recording — the engine's take IS this meeting's linked
     * call — which is the state where the end button appears without this
     * page having started anything. The pair is the test: one fixture, one
     * engine, two readers, and only the answer differs.
     */
    engineIsRecording("c-1");
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "linking" });
    const own = render(<MeetingPage id="m-1" />);
    await screen.findByRole("button", { name: "پایان و پردازش" });
    own.unmount();

    MEETING = meeting({ call_id: "c-1", created_by: "u-host" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("در حال پردازش جلسه")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "پایان و پردازش" })).toBeNull();
  });

  it("the session closes for everyone: a colleague's page moves to the record when the host finishes", async () => {
    /*
     * "after it finishes the session should be close for all". The engine is
     * in the HOST's browser, so this page has nothing local to watch — it
     * asks, and what it waits for is the RECORD itself, which is the same
     * fact the host's own end() waits for.
     *
     * The poll is on a real interval, so the clock is faked here; the read
     * answers `call_id` only after the host has finished.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      MEETING = meeting({ call_id: null, mode: "in_person", created_by: "u-host" });
      render(<MeetingPage id="m-1" />);
      await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
      await screen.findByText("شروع و پایان ضبط با میزبان است.");

      /*
       * THE HOST PRESSES START, somewhere else. The record appears on the
       * meeting THIS INSTANT — the recorder links it the moment the call
       * exists — and until 2026-09-07 that alone moved this page to the
       * artifacts, one second into a meeting the colleague was sitting in.
       */
      MEETING = meeting({
        call_id: "c-1", call_status: "recording", mode: "in_person", created_by: "u-host",
      });
      CALL = call({ status: "recording" });
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(screen.queryByText("در حال پردازش جلسه")).toBeNull();
      expect(screen.getByText("شروع و پایان ضبط با میزبان است.")).toBeInTheDocument();

      /* and NOW the host finishes */
      MEETING = meeting({
        call_id: "c-1", call_status: "linking", mode: "in_person", created_by: "u-host",
      });
      CALL = call({ status: "linking" });
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });

      await waitFor(() => expect(screen.getByText("در حال پردازش جلسه")).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});

/*
 * A RELOAD IS NOT A FINISH (user report, 2026-09-07: "when the meeting is
 * recording and you are the host if you refresh the page it closes the
 * recording and send it to the after meeting stage — it should do that only
 * after you press finish").
 *
 * `call_id` says a take was STARTED, not that it ended; `call_status ===
 * "recording"` is the take still being made (db/0204's door publishes it to
 * every attendee). The control for all of it is the landing test above: a
 * FINISHED record still opens on the post stage.
 */
describe("a reload is not a finish (2026-09-07)", () => {
  it("the host reloading mid-take lands back in the live stage, not on the artifacts", async () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person" });
    CALL = call({ status: "recording" });
    render(<MeetingPage id="m-1" />);

    /* the canvas is what an in-person live stage opens on — a positive
       marker, so this cannot pass on an error page or an empty frame */
    await screen.findByTestId("whiteboard-stub");
    expect(screen.queryByText("در حال پردازش جلسه")).toBeNull();
  });

  it("a take still running leaves the earlier steps as doors; a finished one seals them", async () => {
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "in_person" });
    CALL = call({ status: "recording" });
    const { unmount } = render(<MeetingPage id="m-1" />);
    await screen.findByTestId("whiteboard-stub");
    /* a host who reloaded must not be locked out of their own plan */
    await userEvent.click(screen.getByRole("button", { name: /پیش از جلسه/ }));
    expect(await screen.findByText("مشخصات")).toBeInTheDocument();
    unmount();

    /* and the seal still holds once the record is real — the pair is what
       makes either half mean anything */
    MEETING = meeting({ call_id: "c-1", call_status: "ready", mode: "in_person" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() =>
      expect(screen.getByText("صوت جلسه ضبط شد، ولی گفتاری تشخیص داده نشد")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /پیش از جلسه/ }));
    expect(screen.queryByText("مشخصات")).toBeNull();
  });

  it("the take that outlived its engine is finished from the page, and THAT is what moves it on", async () => {
    /* the engine is idle: a reload destroyed it, and the call is sitting at
       `recording` because nothing has finished it */
    MEETING = meeting({ call_id: "c-1", call_status: "recording", mode: "online" });
    CALL = call({ status: "recording" });
    render(<MeetingPage id="m-1" />);

    /* what will happen is said before it is pressed */
    await screen.findByText(/این ضبط با بسته شدن یا تازه‌سازی صفحه قطع شد/);
    expect(screen.queryByText("در حال پردازش جلسه")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "پایان و پردازش" }));
    await waitFor(() => expect(finished).toEqual(["c-1"]));
    await waitFor(() => expect(screen.getByText("در حال پردازش جلسه")).toBeInTheDocument());
  });

  it("a colleague is offered no such button — finishing is the host's, however the take was orphaned", async () => {
    MEETING = meeting({
      call_id: "c-1", call_status: "recording", mode: "online", created_by: "u-host",
    });
    CALL = call({ status: "recording" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /حین جلسه/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "پایان و پردازش" })).toBeNull();
    expect(screen.queryByText(/این ضبط با بسته شدن یا تازه‌سازی صفحه قطع شد/)).toBeNull();
  });

  it("a record whose status cannot be read still opens on the post stage", async () => {
    /* the third nothing: a purged call, or a database without db/0204. It is
       NOT "still recording", and reading it as such would strand the page in
       a live stage for a meeting that ended weeks ago. */
    MEETING = meeting({ call_id: "c-1", call_status: null, mode: "in_person" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() =>
      expect(screen.getByText("صوت جلسه ضبط شد، ولی گفتاری تشخیص داده نشد")).toBeInTheDocument());
    expect(screen.queryByTestId("whiteboard-stub")).toBeNull();
  });
});

describe("who was in the room (db/0202)", () => {
  it("stamps attendance on walking into a HELD meeting, and never on the plan", async () => {
    MEETING = meeting({ call_id: null, mode: "in_person" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    /* the PLAN is not the room: a meeting somebody is reading about has not
       been attended, and a stamp here would put every browser in it */
    expect(attended).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    await waitFor(() => expect(attended).toEqual(["m-1"]));

    /* ONCE — walking back and in again is one arrival, and the stamp's own
       `coalesce` keeps the first moment anyway */
    await userEvent.click(screen.getByRole("button", { name: /پیش از جلسه/ }));
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    expect(attended).toEqual(["m-1"]);
  });

  it("lists colleagues by their USER MANAGEMENT name and marks who actually came", async () => {
    /*
     * The screenshot that started this showed «drbagheri» beside «دکتر
     * باقری» — one person, twice, because the roster was a list of NAMES and
     * two surfaces had written two spellings. A row keyed by an account
     * cannot do that, and the name is resolved at read time.
     */
    MEETING = meeting({
      call_id: null, mode: "in_person", invitees: ["مهمان بیرونی"],
      attendees: [
        { user_id: "u-2", display_name: "سینا سپاسی", display_name_en: "Sina Sepasi", username: "sina", attended: true },
        { user_id: "u-3", display_name: "شهلا حسینی", display_name_en: null, username: "shahla", attended: false },
      ],
    });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));

    const members = (await screen.findByRole("heading", { name: "اعضای جلسه" })).closest("section")!;
    expect(within(members).getByText("سینا سپاسی")).toBeInTheDocument();
    expect(within(members).getByText("شهلا حسینی")).toBeInTheDocument();
    /* the person with no account is still listed, and is MARKED as such —
       so this cannot pass by rendering the roster and dropping the guests */
    expect(within(members).getByText("مهمان بیرونی")).toBeInTheDocument();
    expect(within(members).getByText("مهمان")).toBeInTheDocument();

    /* ATTENDANCE, in the affirmative only: exactly one «در جلسه», on the
       person who was there. A version that marked everybody would pass an
       assertion that merely found the word. */
    expect(within(members).getAllByText("در جلسه")).toHaveLength(1);
    expect(within(members).getByText("سینا سپاسی").closest("li")!).toHaveTextContent("در جلسه");

    /* host + two colleagues + one guest */
    expect(within(members).getByText("۴")).toBeInTheDocument();
  });

  it("somebody who was IN THE ROOM cannot be taken off the meeting, and somebody who was not still can", async () => {
    /*
     * The pair, and the second half is what stops this passing against a
     * dialog that removes nobody at all.
     *
     * Removing an attendee drops db/0202's row and its `attended_at` with
     * it — the platform's own evidence that a person was there, which is
     * the fact the transcript's roster reads. Un-planning is not a delete;
     * un-remembering is.
     */
    PEOPLE = [
      { id: "u-2", display_name: "سینا", display_name_en: null, username: "sina", role: "member" },
      { id: "u-3", display_name: "شهلا", display_name_en: null, username: "shahla", role: "member" },
    ];
    MEETING = meeting({
      call_id: null,
      attendees: [
        { user_id: "u-2", display_name: "سینا", display_name_en: null, username: "sina", attended: true },
        { user_id: "u-3", display_name: "شهلا", display_name_en: null, username: "shahla", attended: false },
      ],
    });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "دعوت افراد" }));
    const dialog = await screen.findByRole("dialog");

    /* BOTH doors to removal, because either one left open is the whole
       hole: the chip's × and the directory row's toggle */
    expect(within(dialog).queryByRole("button", { name: "حذف سینا" })).toBeNull();
    /* anchored at the START of the name: the chip's own remove button is
       labelled «حذف شهلا», so an unanchored match finds two buttons and
       the query cannot say which door it is asking about */
    expect(await within(dialog).findByRole("button", { name: /^سینا/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /^شهلا/ })).toBeEnabled();

    await userEvent.click(within(dialog).getByRole("button", { name: "حذف شهلا" }));
    await waitFor(() => expect(removed).toEqual(["u-3"]));
  });

  it("a colleague picked in the invite dialog is added BY ACCOUNT, in the one request that also invites them", async () => {
    /*
     * Adding somebody and telling them about it used to be two buttons —
     * «دعوت‌شدگان» wrote a name into the text array and «دعوت اعضا» minted
     * the invitations — so being on a meeting and hearing about it could
     * come apart in either direction. One act now, and the assertion is on
     * the USER ID: a version that went on writing names would still put a
     * chip on screen.
     */
    PEOPLE = [
      { id: "u-2", display_name: "سینا سپاسی", display_name_en: "Sina Sepasi", username: "sina", role: "member" },
    ];
    MEETING = meeting({ call_id: null });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "دعوت افراد" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /سینا سپاسی/ }));

    await waitFor(() => expect(added).toEqual([["u-2"]]));
    /* and NOT through the old door: a name must never reach the text array
       for somebody who has an account here */
    expect(patched).toEqual([]);
  });
});
