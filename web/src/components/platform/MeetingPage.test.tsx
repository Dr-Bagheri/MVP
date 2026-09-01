import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, MeetingRecord } from "@/api/types";

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

const startSpy = vi.fn(async (_opts: unknown) => undefined);
/* useSyncExternalStore REQUIRES a stable snapshot reference — a getter that
   builds a fresh object every call re-renders forever (the real engine's
   snapshot is a module-level constant between changes for the same reason) */
const ENGINE_SNAPSHOT = { phase: "idle", callId: null, recordedMs: 0 };
vi.mock("@/lib/recordingEngine", () => ({
  startRecording: (opts: unknown) => startSpy(opts),
  finish: vi.fn(async () => undefined),
  recorderSnapshot: () => ENGINE_SNAPSHOT,
  subscribeRecorder: () => () => undefined,
}));

function meeting(over: Partial<MeetingRecord>): MeetingRecord {
  return {
    id: "m-1", title: "جلسهٔ محصول", scheduled_at: "2020-01-01T09:00:00.000Z",
    duration_minutes: 60, mode: "online", topic: null, location: null,
    description: "", invitees: [], agenda: [], call_id: null, call_title: null,
    archived: false, created_by: "u-1", created_at: "2026-08-31T08:00:00.000Z",
    video_url: null, video_provider: null,
    minutes_approved_at: null, minutes_closed_at: null, minutes_signatures: [],
    ...over,
  };
}

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

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    meetingDetail: async () => MEETING,
    updateMeeting: async (_id: string, body: Record<string, unknown>) => ({ ...MEETING, ...body }),
    getCall: async () => CALL,
    me: async () => ({ id: "u-me", display_name: "سینا", display_name_en: null }),
    taskBoard: async () => ({ columns: [], topics: [], tasks: [] }),
    callNotes: async () => [],
    getSummaries: async () => [],
    getTranscript: async () => [],
    getSpeakers: async () => [],
    getCallAudio: async () => null,
    createTask: vi.fn(), addCallNote: vi.fn(), deleteCallNote: vi.fn(),
  },
}));

import { MeetingPage } from "./MeetingPage";

beforeEach(() => {
  MEETING = meeting({});
  CALL = null;
  startSpy.mockClear();
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
       video room, and the canvas is a chip on the same header */
    await userEvent.click(screen.getByRole("button", { name: /حین جلسه/ }));
    expect(screen.getByRole("button", { name: /ساخت اتاق ویدیویی/ })).toBeInTheDocument();
    expect(screen.queryByTestId("whiteboard-stub")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "وایت‌برد" }));
    expect(screen.getByTestId("whiteboard-stub")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /پس از جلسه/ }));
    expect(screen.getByText("هنوز رکوردی از این جلسه نیست.")).toBeInTheDocument();
  });

  it("starting hands the ENGINE the meeting's mapping — online becomes the system source", async () => {
    MEETING = meeting({ call_id: null, mode: "online", title: "جلسهٔ آنلاین" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("مشخصات")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /شروع جلسه/ }));
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    const opts = startSpy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(opts.source).toBe("system");
    expect(opts.title).toBe("جلسهٔ آنلاین");
  });

  it("a recorded meeting opens on the post stage", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() =>
      expect(screen.getByText("صوت جلسه ضبط شد، ولی گفتاری تشخیص داده نشد")).toBeInTheDocument());
    expect(screen.queryByTestId("whiteboard-stub")).toBeNull();
  });
});
