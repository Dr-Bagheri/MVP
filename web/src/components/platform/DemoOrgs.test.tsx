import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { openRowMenu } from "@/test/rowMenu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The console's Demo tab (M52).
 *
 * The load-bearing case is the SHOWN-ONCE password. Core generates it,
 * delivers it on the finished poll of a seed JOB (2026-09-09) and stores it
 * nowhere — the job is forgotten as it is delivered — so the panel is the
 * only place it will ever exist. The assertions here are as much about what
 * STOPS being on screen as about what appears: after the acknowledgement it
 * is gone and there is no route that could fetch it again.
 *
 * The press itself now opens a blocking modal over the form, and the tests
 * for it are written against the incident: the button is DISABLED and the
 * form INERT from the first press, so the second press that met a 409 cannot
 * be made from this screen.
 *
 * The delete case has the same shape from the other side. `deleteDemoOrganization`
 * is caught by the destructive-method census, so the client call may only
 * happen inside a confirmation — and the test asserts BOTH halves, because
 * "the dialog opened" is true of a version that already deleted the row.
 */

const demoOrganizations = vi.fn();
const createDemoOrganization = vi.fn();
const reseedDemoOrganization = vi.fn();
const deleteDemoOrganization = vi.fn();
const demoSeedJob = vi.fn();
const notifyError = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    demoOrganizations: () => demoOrganizations(),
    createDemoOrganization: (input: unknown) => createDemoOrganization(input),
    reseedDemoOrganization: (...a: unknown[]) => reseedDemoOrganization(...a),
    deleteDemoOrganization: (...a: unknown[]) => deleteDemoOrganization(...a),
    demoSeedJob: (id: string) => demoSeedJob(id),
  },
  BffError: class BffError extends Error {
    status: number;
    detail: string | undefined;
    constructor(status: number, _kind?: string, detail?: string) {
      super(`HTTP ${status}`);
      this.status = status;
      this.detail = detail;
    }
  },
}));

vi.mock("@/lib/notify", () => ({
  notifyError: (message: string) => notifyError(message),
  notify: vi.fn(),
}));

const { DemoOrgs } = await import("./DemoOrgs");

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const row = {
  id: ORG_ID,
  name: "پیشرو داده (دمو)",
  status: "active",
  locale: "fa",
  created_at: "2026-09-09T08:00:00.000Z",
  deleted_at: null,
  language: "fa",
  demo_date: "2026-09-09",
  seeded_at: "2026-09-09T08:00:00.000Z",
  reseeded_at: null,
  owner_email: "demo-pishro-20260909@demo.neurai.invalid",
  member_count: 5,
};

const seeded = {
  org_id: ORG_ID,
  owner: {
    email: "demo-pishro-20260909@demo.neurai.invalid",
    password: "Xk4-mQ7pRt2vNb5YwZ9c",
  },
  report: {
    persons: 7, columns: 4, topics: 2, tasks: 23,
    records: [
      { key: "prior", callId: "c1", meetingId: "m1", segments: 29, speakers: 2, items: 6, audio: true },
      { key: "pricing", callId: "c2", meetingId: "m2", segments: 20, speakers: 2, items: 6, audio: true },
    ],
    upcomingMeetingIds: ["m3", "m4"],
    meetings: 2,
    /* the presenter's seeded week with the assistant — what the sidebar
       opens on, so the panel's one counts line has to be able to say it */
    conversations: [
      { key: "simorgh", sessionId: "s1", title: "سیمرغ دقیقاً شامل چه چیزهایی است؟", turns: 2, lastMessageAt: "2026-09-03T06:43:00.000Z" },
      { key: "board", sessionId: "s2", title: "الان کارت‌های باز دست چه کسانی است؟", turns: 4, lastMessageAt: "2026-09-04T06:13:00.000Z" },
      { key: "quote", sessionId: "s3", title: "نامهٔ پیشنهاد قیمت", turns: 6, lastMessageAt: "2026-09-06T12:55:00.000Z" },
      { key: "weekly", sessionId: "s4", title: "در جلسهٔ هفتگی", turns: 4, lastMessageAt: "2026-09-07T07:38:00.000Z" },
      { key: "unanswered", sessionId: "s5", title: "مقایسه", turns: 1, lastMessageAt: "2026-09-08T15:17:00.000Z" },
    ],
    glossary: ["سیمرغ", "آسمان", "پاسارگاد"],
    warnings: [],
  },
};

/* the 202's shape, as core sends it — the stage list is the producer's */
const STAGES = [
  "identities", "organization", "people", "board",
  "prior_audio", "prior_transcript", "prior_summary",
  "pricing_audio", "pricing_transcript", "pricing_summary",
  "tasks", "upcoming", "conversations", "glossary",
];
const jobStart = { job_id: "job-1", stages: STAGES, started_at: "2026-09-09T08:00:00.000Z" };

const runningAt = (stage: string) => ({
  id: "job-1", kind: "create", name: "Demo", status: "running",
  stage, stages: STAGES, done_stages: STAGES.indexOf(stage), total_stages: STAGES.length,
  started_at: jobStart.started_at, finished_at: null,
});
const finished = (result: unknown, kind = "create") => ({
  ...runningAt("glossary"), kind, status: "done", stage: null, done_stages: STAGES.length,
  finished_at: "2026-09-09T08:04:00.000Z", result,
});

/** The modal polls every two seconds; move the clock past one poll. */
const nextPoll = () => vi.advanceTimersByTimeAsync(2_100);

beforeEach(() => {
  vi.clearAllMocks();
  demoOrganizations.mockResolvedValue([row]);
  createDemoOrganization.mockResolvedValue(jobStart);
  reseedDemoOrganization.mockResolvedValue({ ...jobStart, stages: STAGES.slice(1) });
  demoSeedJob.mockResolvedValue(finished(seeded));
  deleteDemoOrganization.mockResolvedValue({
    purged: true, identities_removed: 5, identities_stranded: [],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the demo tab", () => {
  it("lists the demo organizations with the facts only this tab knows", async () => {
    render(<DemoOrgs />);
    expect(await screen.findByText("پیشرو داده (دمو)")).toBeTruthy();
    expect(screen.getByText("demo-pishro-20260909@demo.neurai.invalid")).toBeTruthy();
    // the CONTENT language, which is not the organisation's interface locale
    expect(screen.getAllByText("فارسی").length).toBeGreaterThan(0);
  });

  it("tells a refused list apart from an empty one", async () => {
    demoOrganizations.mockRejectedValue(new Error("nope"));
    render(<DemoOrgs />);
    /* "no demo organization has been seeded yet" would be a claim about the
       platform; this is a claim about the request */
    expect(await screen.findByText(/خوانده نشد/)).toBeTruthy();
    expect(screen.queryByText(/هنوز هیچ سازمان دمویی/)).toBeNull();
  });

  it("asks for no audit reason — the console supplies its own sentence", async () => {
    render(<DemoOrgs />);
    const button = await screen.findByRole("button", { name: "ساخت سازمان دمو" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByLabelText(/دلیل/)).toBeNull();
  });

  it("sends the form's own values, with the language the radio chose", async () => {
    render(<DemoOrgs />);
    await screen.findByRole("button", { name: "ساخت سازمان دمو" });
    fireEvent.click(screen.getByRole("radio", { name: "انگلیسی" }));
    fireEvent.click(screen.getByRole("button", { name: "ساخت سازمان دمو" }));

    await waitFor(() => expect(createDemoOrganization).toHaveBeenCalledTimes(1));
    const sent = createDemoOrganization.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.language).toBe("en");
    /* the name defaults to the CHOSEN language's pack name, not the reader's
       locale — an English demo called «پیشرو داده (دمو)» is the org name and
       the content disagreeing */
    expect(sent.name).toBe("Northstar Data Demo");
    expect(sent.offset_minutes).toBe(20);
    expect(typeof sent.reason).toBe("string");
    expect((sent.reason as string).length).toBeGreaterThanOrEqual(3);
    /* an empty presenter is OMITTED, never sent as "" — core generates one,
       and an empty string is an address it would have to refuse */
    expect("presenter_email" in sent).toBe(false);
  });

  it("opens the blocking modal on the press, with the button and the form inert behind it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    demoSeedJob.mockResolvedValue(runningAt("people"));
    render(<DemoOrgs />);
    await screen.findByRole("button", { name: "ساخت سازمان دمو" });
    fireEvent.click(screen.getByRole("button", { name: "ساخت سازمان دمو" }));

    /* the modal is up the moment the 202 lands — before any poll */
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("در حال ساخت سازمان دمو…")).toBeTruthy();
    expect(screen.getByText(/این صفحه را باز نگه دارید/)).toBeTruthy();
    /* the button behind it is disabled and reads as busy; the form is inert.
       `hidden`, because Radix marks everything outside an open dialog
       aria-hidden — which is itself the "inert behind it" half */
    const button = screen.getByRole("button", { name: "در حال ساخت…", hidden: true });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);
    /* pressing it again asks the server for nothing */
    fireEvent.click(button);
    expect(createDemoOrganization).toHaveBeenCalledTimes(1);

    /* the poll draws the real stage, and Escape does not close the modal */
    await nextPoll();
    await waitFor(() =>
      expect(document.querySelector('[data-stage="people"]')?.getAttribute("data-state")).toBe("active"));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
    await Promise.resolve();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "بستن" })).toBeNull();
  });

  it("shows the presenter's password once, and only until it is acknowledged", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DemoOrgs />);
    await screen.findByRole("button", { name: "ساخت سازمان دمو" });
    fireEvent.click(screen.getByRole("button", { name: "ساخت سازمان دمو" }));
    await screen.findByRole("dialog");
    await nextPoll();

    expect(await screen.findByText("Xk4-mQ7pRt2vNb5YwZ9c")).toBeTruthy();
    expect(screen.getByText("سازمان دمو آماده است")).toBeTruthy();
    /* the address appears twice on purpose — in the panel and in the row the
       seed just added — so this counts rather than demanding one */
    expect(screen.getAllByText("demo-pishro-20260909@demo.neurai.invalid").length)
      .toBeGreaterThan(0);
    /* and the one line that says what was seeded counts the CONVERSATIONS
       too — the sidebar is on screen in the demo, and a panel that reported
       meetings, cards and people would leave the presenter to guess whether
       the assistant has a history at all */
    const counts = await screen.findByText(/گفت‌وگوی دستیار/);
    /* the NUMBER, not the phrase: the harness's `t` leaves an unsupplied
       placeholder standing as `{conversations}`, so a version that never
       passed the count renders the sentence perfectly and says nothing —
       only the value can tell the two apart. (Digits are the harness's, not
       the product's; what is under test is that the count reaches the copy.) */
    expect(counts.textContent).toContain("5 گفت‌وگوی دستیار");

    fireEvent.click(screen.getByRole("button", { name: "گذرواژه را ذخیره کردم" }));
    /* and it is GONE — there is no route that could bring it back, so a panel
       that lingered would be the only copy sitting on an unattended screen */
    await waitFor(() => expect(screen.queryByText("Xk4-mQ7pRt2vNb5YwZ9c")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    const button = screen.getByRole("button", { name: "ساخت سازمان دمو" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the seed's failure inside the modal, with a way out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    demoSeedJob.mockResolvedValue({
      ...runningAt("prior_audio"), status: "failed", stage: null,
      error: { message: "the organisation was created (org-1) but its content was not finished", code: "demo_content_failed" },
    });
    render(<DemoOrgs />);
    await screen.findByRole("button", { name: "ساخت سازمان دمو" });
    fireEvent.click(screen.getByRole("button", { name: "ساخت سازمان دمو" }));
    await screen.findByRole("dialog");
    await nextPoll();

    expect(await screen.findByText(/its content was not finished/)).toBeTruthy();
    expect(notifyError).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "بستن" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((screen.getByRole("button", { name: "ساخت سازمان دمو" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says out loud when a record was seeded without its audio", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    demoSeedJob.mockResolvedValue(finished({
      ...seeded,
      report: {
        ...seeded.report,
        records: seeded.report.records.map((r) => ({ ...r, audio: false })),
        warnings: ["the demo audio _demo/fa/prior/part-0.wav is not in the call-audio bucket"],
      },
    }));
    render(<DemoOrgs />);
    await screen.findByRole("button", { name: "ساخت سازمان دمو" });
    fireEvent.click(screen.getByRole("button", { name: "ساخت سازمان دمو" }));
    await screen.findByRole("dialog");
    await nextPoll();
    expect(await screen.findByText(/_demo\/fa\/prior\/part-0\.wav/)).toBeTruthy();
  });

  it("deletes only on the confirmation, never on the menu press", async () => {
    render(<DemoOrgs />);
    await screen.findByText("پیشرو داده (دمو)");
    await openRowMenu("پیشرو داده (دمو)");
    fireEvent.click(await screen.findByRole("menuitem", { name: /حذف سازمان دمو/ }));

    // the dialog is up and NOTHING has been asked of the server yet
    expect(await screen.findByText(/برای همیشه حذف می‌شوند/)).toBeTruthy();
    expect(deleteDemoOrganization).not.toHaveBeenCalled();

    const buttons = screen.getAllByRole("button", { name: "حذف سازمان دمو" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(deleteDemoOrganization).toHaveBeenCalledTimes(1));
    expect(deleteDemoOrganization.mock.calls[0]![0]).toBe(ORG_ID);
  });

  it("names the sign-in accounts a delete could not remove", async () => {
    deleteDemoOrganization.mockResolvedValue({
      purged: true, identities_removed: 3,
      identities_stranded: ["aaaa-1", "bbbb-2"],
    });
    render(<DemoOrgs />);
    await screen.findByText("پیشرو داده (دمو)");
    await openRowMenu("پیشرو داده (دمو)");
    fireEvent.click(await screen.findByRole("menuitem", { name: /حذف سازمان دمو/ }));
    const buttons = screen.getAllByRole("button", { name: "حذف سازمان دمو" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(String(notifyError.mock.calls[0]![0])).toContain("aaaa-1");
  });

  it("re-seeds for the date the dialog carries, then watches that job in the same modal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    demoSeedJob.mockResolvedValue(finished({ report: { ...seeded.report, warnings: ["no storage is configured"] } }, "reseed"));
    render(<DemoOrgs />);
    await screen.findByText("پیشرو داده (دمو)");
    await openRowMenu("پیشرو داده (دمو)");
    fireEvent.click(await screen.findByRole("menuitem", { name: /ساخت دوباره/ }));

    /* the CONSEQUENCE, said while the person can still change their mind */
    expect(await screen.findByText(/حساب‌ها می‌مانند/)).toBeTruthy();
    expect(reseedDemoOrganization).not.toHaveBeenCalled();

    const buttons = screen.getAllByRole("button", { name: /ساخت دوباره برای یک تاریخ/ });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(reseedDemoOrganization).toHaveBeenCalledTimes(1));
    expect(reseedDemoOrganization.mock.calls[0]![0]).toBe(ORG_ID);
    expect((reseedDemoOrganization.mock.calls[0]![1] as { demo_date: string }).demo_date)
      .toBe("2026-09-09");

    /* the confirm gives way to the progress modal, named for the organisation */
    expect(await screen.findByText("در حال ساخت دوبارهٔ پیشرو داده (دمو)…")).toBeTruthy();
    await nextPoll();
    expect(await screen.findByText(/دوباره نوشته شد/)).toBeTruthy();
    /* a re-seed's warnings are said inside the modal, not toasted over it */
    expect(screen.getByText("no storage is configured")).toBeTruthy();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("re-reads the list once the seed has settled, so the table is never stale", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DemoOrgs />);
    await screen.findByText("پیشرو داده (دمو)");
    expect(demoOrganizations).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "ساخت سازمان دمو" }));
    await screen.findByRole("dialog");
    /* the 202 alone is not a row yet — nothing to re-read until the job ends */
    expect(demoOrganizations).toHaveBeenCalledTimes(1);
    await act(async () => { await nextPoll(); });
    await waitFor(() => expect(demoOrganizations).toHaveBeenCalledTimes(2));
  });
});
