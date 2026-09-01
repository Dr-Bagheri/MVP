import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, MeetingRecord } from "@/api/types";

/**
 * The meeting page's contract facts:
 *
 *  1. THE LADDER MAPPING is the load-bearing one: the processing view's
 *     four steps are the call-status ladder wearing the reference's labels.
 *     At status "linking" the first two steps read done, diarization reads
 *     in-progress, extraction reads pending — asserted PER STEP, because a
 *     card that renders all four steps identically satisfies any bare
 *     presence check. (Verified red by breaking ladderIndex to a constant:
 *     the per-step assertions failed, presence assertions would not have.)
 *  2. "ready" shows the finished card with the record's door — and no
 *     step list (the states are exclusive).
 *  3. "failed" is named as a failure, never rendered as progress.
 *  4. A meeting with NO record shows the named state, and its start button
 *     switches to the hold stage (the embedded recorder appears).
 *  5. A meeting with a record OPENS on the post stage (stage derivation).
 */
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

/* the recorder is ITS OWN suite's subject — here it only needs to exist */
vi.mock("@/components/echo/Recorder", () => ({
  Recorder: () => <div data-testid="recorder-stub" />,
}));
vi.mock("@/components/platform/CrumbTitle", () => ({
  useCrumbTitle: () => undefined,
}));

function meeting(over: Partial<MeetingRecord>): MeetingRecord {
  return {
    id: "m-1", title: "جلسهٔ محصول", scheduled_at: "2020-01-01T09:00:00.000Z",
    duration_minutes: 60, mode: "online", topic: null, location: null,
    description: "", invitees: [], agenda: [], call_id: null, call_title: null,
    archived: false, created_by: "u-1", created_at: "2026-08-31T08:00:00.000Z",
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
    taskBoard: async () => ({ columns: [], topics: [], tasks: [] }),
    callNotes: async () => [],
    getSummaries: async () => [],
    createTask: vi.fn(), addCallNote: vi.fn(), deleteCallNote: vi.fn(),
  },
}));

import { MeetingPage } from "./MeetingPage";

beforeEach(() => {
  MEETING = meeting({});
  CALL = null;
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

    // linking = upload done, transcription done, diarization ACTIVE,
    // extraction pending — each row's own state, not the card's existence
    expect(stepRow("آپلود فایل صوتی").textContent).toContain("انجام شد");
    expect(stepRow("رونویسی گفتار به متن").textContent).toContain("انجام شد");
    expect(stepRow("تفکیک و تشخیص گویندگان").textContent).toContain("در حال انجام…");
    expect(stepRow("استخراج هوشمند").textContent).not.toContain("انجام شد");
    expect(stepRow("استخراج هوشمند").textContent).not.toContain("در حال انجام…");
  });

  it("a ready record shows the finished card, not the step list", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("رکورد آماده است")).toBeInTheDocument());
    expect(screen.queryByText("در حال پردازش جلسه")).toBeNull();
    expect(screen.getByRole("button", { name: "باز کردن رکورد" })).toBeInTheDocument();
  });

  it("a failed record is named a failure, never progress", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "failed" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("پردازش این رکورد ناموفق بود.")).toBeInTheDocument());
    expect(screen.queryByText("در حال پردازش جلسه")).toBeNull();
    expect(screen.queryByText("رکورد آماده است")).toBeNull();
  });

  it("no record: the named state, and start switches to the hold stage", async () => {
    MEETING = meeting({ call_id: null, scheduled_at: "2020-01-01T09:00:00.000Z" });
    render(<MeetingPage id="m-1" />);
    // a due-but-unrecorded meeting opens on HOLD (the recorder)
    await waitFor(() => expect(screen.getByTestId("recorder-stub")).toBeInTheDocument());

    // walk to the post stage by hand: the absence is named, with the door back
    await userEvent.click(screen.getByRole("button", { name: /پس از جلسه/ }));
    expect(screen.getByText("هنوز رکوردی از این جلسه نیست.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /شروع جلسه/ }));
    expect(screen.getByTestId("recorder-stub")).toBeInTheDocument();
  });

  it("a recorded meeting opens on the post stage", async () => {
    MEETING = meeting({ call_id: "c-1" });
    CALL = call({ status: "ready" });
    render(<MeetingPage id="m-1" />);
    await waitFor(() => expect(screen.getByText("رکورد آماده است")).toBeInTheDocument());
    // the recorder is not on screen — post is the opening stage
    expect(screen.queryByTestId("recorder-stub")).toBeNull();
  });
});
