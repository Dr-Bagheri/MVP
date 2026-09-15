import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seed progress modal (M52, 2026-09-09).
 *
 * The load-bearing cases are the two NEGATIVES. (1) While the seed runs
 * there is no way out — no close button, and Escape reaches a function that
 * does nothing; a version that let the person close it and press create
 * again is the incident this modal exists to end, and "a close button is
 * rendered at the end" is true of that version too. Verified red by making
 * the running modal's onClose real. (2) The stage list is drawn from what
 * CORE reports, never from the clock: the assertion is anchored on a stage
 * name that only arrives on the poll (rule 12's temporal form — the initial
 * render shows every stage pending, and "a stage is rendered" holds there).
 *
 * `pollMs` is short and the timers are real: what is under test is the
 * order of polls and what each one draws, not the two-second interval.
 */

const demoSeedJob = vi.fn();

vi.mock("@/api/client", () => ({
  api: { demoSeedJob: (id: string) => demoSeedJob(id) },
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

const { DemoSeedModal } = await import("./DemoSeedModal");
const { BffError } = await import("@/api/client");

/* the stage list the PRODUCER sends — pinned on the core side in
   demo-seed-engine.test ("announces exactly the stages it promised") */
const STAGES = [
  "identities", "organization", "people", "board",
  "prior_audio", "prior_transcript", "prior_summary",
  "pricing_audio", "pricing_transcript", "pricing_summary",
  "tasks", "upcoming", "glossary",
];

const job = { job_id: "job-1", stages: STAGES, started_at: "2026-09-09T08:00:00.000Z" };

const running = (stage: string) => ({
  id: "job-1", kind: "create" as const, name: "Demo", status: "running" as const,
  stage, stages: STAGES, done_stages: STAGES.indexOf(stage), total_stages: STAGES.length,
  started_at: job.started_at, finished_at: null,
});

const done = {
  ...running("glossary"), status: "done" as const, stage: null, done_stages: STAGES.length,
  finished_at: "2026-09-09T08:04:00.000Z",
  result: { org_id: "org-1", owner: { email: "p@demo.neurai.invalid", password: "Xk4-mQ7pRt2vNb5YwZ9c" }, report: {} },
};

const stateOf = (stage: string) =>
  document.querySelector(`[data-stage="${stage}"]`)?.getAttribute("data-state");

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the seed progress modal", () => {
  it("opens over the form with the title, the clock, the note and every promised stage pending", () => {
    demoSeedJob.mockReturnValue(new Promise(() => {}));
    render(
      <DemoSeedModal kind="create" name="Demo" job={job} pollMs={5} onClose={() => {}} renderDone={() => null} />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("demo-seed-title").textContent).toBe("در حال ساخت سازمان دمو…");
    /* the clock starts at zero, in the page's own digits */
    expect(screen.getByTestId("demo-seed-clock").textContent).toBe("۰۰:۰۰");
    expect(screen.getByText(/حدود چهار دقیقه/)).toBeTruthy();
    for (const stage of STAGES) expect(stateOf(stage)).toBe("pending");
    expect(stateOf("done")).toBe("pending");
    /* the labels are the catalogue's, not the wire's keys */
    expect(screen.getByText("تماس قیمت‌گذاری: رونوشت")).toBeTruthy();
    expect(screen.queryByText(/demoStage_/)).toBeNull();
  });

  it("counts the elapsed time in the page's digits", () => {
    vi.useFakeTimers();
    demoSeedJob.mockReturnValue(new Promise(() => {}));
    render(
      <DemoSeedModal kind="create" name="Demo" job={job} pollMs={60_000} onClose={() => {}} renderDone={() => null} />,
    );
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByTestId("demo-seed-clock").textContent).toBe("۰۱:۰۱");
  });

  it("polls the job and draws the stage core reports — done before it, active on it, pending after", async () => {
    /* the second poll is HELD until the first picture has been read — at a
       5ms interval it would otherwise land between waitFor and the next line */
    let releaseSecond!: (view: unknown) => void;
    const second = new Promise((resolve) => { releaseSecond = resolve; });
    demoSeedJob
      .mockResolvedValueOnce(running("people"))
      .mockImplementationOnce(() => second)
      .mockReturnValue(new Promise(() => {}));
    render(
      <DemoSeedModal kind="create" name="Demo" job={job} pollMs={5} onClose={() => {}} renderDone={() => null} />,
    );
    /* anchored on the poll's own answer: "people" is pending on first paint */
    await waitFor(() => expect(stateOf("people")).toBe("active"));
    expect(stateOf("identities")).toBe("done");
    expect(stateOf("organization")).toBe("done");
    expect(stateOf("board")).toBe("pending");
    expect(document.querySelector('[aria-current="step"]')?.getAttribute("data-stage")).toBe("people");

    releaseSecond(running("prior_transcript"));
    await waitFor(() => expect(stateOf("prior_transcript")).toBe("active"));
    expect(stateOf("prior_audio")).toBe("done");
    expect(stateOf("people")).toBe("done");
    expect(stateOf("prior_summary")).toBe("pending");
    expect(demoSeedJob).toHaveBeenCalledWith("job-1");
  });

  it("cannot be closed while the seed runs — no button, and Escape does nothing", async () => {
    demoSeedJob.mockResolvedValue(running("board"));
    const onClose = vi.fn();
    render(
      <DemoSeedModal kind="create" name="Demo" job={job} pollMs={5} onClose={onClose} renderDone={() => null} />,
    );
    await waitFor(() => expect(stateOf("board")).toBe("active"));
    expect(screen.queryByRole("button", { name: "بستن" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
    /* the scrim too: a pointer outside the panel is not a dismissal */
    fireEvent.pointerDown(document.body);
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("turns into what the caller renders for a finished job, and settles exactly once", async () => {
    demoSeedJob.mockResolvedValueOnce(running("tasks")).mockResolvedValueOnce(done);
    const onSettled = vi.fn();
    const onClose = vi.fn();
    render(
      <DemoSeedModal
        kind="create" name="Demo" job={job} pollMs={5}
        onSettled={onSettled} onClose={onClose}
        renderDone={(view, close) => (
          <div>
            <code>{(view.result as { owner: { password: string } }).owner.password}</code>
            <button type="button" onClick={close}>saved</button>
          </div>
        )}
      />,
    );
    expect(await screen.findByText("Xk4-mQ7pRt2vNb5YwZ9c")).toBeTruthy();
    expect(screen.getByTestId("demo-seed-title").textContent).toBe("سازمان دمو آماده است");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]![0]).toMatchObject({ status: "done" });
    /* the clock and the keep-open note are gone with the running state */
    expect(screen.queryByTestId("demo-seed-clock")).toBeNull();
    expect(screen.queryByText(/حدود چهار دقیقه/)).toBeNull();
    /* and no further poll: the job was forgotten by core on delivery */
    const polls = demoSeedJob.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(demoSeedJob.mock.calls.length).toBe(polls);

    fireEvent.click(screen.getByRole("button", { name: "saved" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the seed's own sentence when it fails, where it stopped, with a way out", async () => {
    demoSeedJob
      .mockResolvedValueOnce(running("prior_audio"))
      .mockResolvedValueOnce({
        ...running("prior_audio"), status: "failed", stage: null, finished_at: job.started_at,
        error: { message: "the demo seed failed at record:prior: the bucket refused", code: "demo_content_failed" },
      });
    const onClose = vi.fn();
    render(
      <DemoSeedModal kind="create" name="Demo" job={job} pollMs={5} onClose={onClose} renderDone={() => null} />,
    );
    expect(await screen.findByText(/the bucket refused/)).toBeTruthy();
    /* where it stopped: the stages before it stay ticked, "done" never ticks */
    expect(stateOf("board")).toBe("done");
    expect(stateOf("done")).toBe("pending");
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بستن" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says plainly when core no longer knows the job", async () => {
    demoSeedJob.mockRejectedValue(new BffError(404, "not_found", "no such seed job"));
    render(
      <DemoSeedModal kind="reseed" name="پیشرو" job={job} pollMs={5} onClose={() => {}} renderDone={() => null} />,
    );
    expect(await screen.findByText(/سرور دیگر این ساخت را نمی‌شناسد/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "بستن" })).toBeTruthy();
    /* a re-seed names the organisation in its title */
    expect(screen.getByTestId("demo-seed-title").textContent).toBe("در حال ساخت دوبارهٔ پیشرو…");
  });

  it("keeps polling through a transient failure — a blip is not a lost seed", async () => {
    demoSeedJob
      .mockRejectedValueOnce(new BffError(502, "upstream", "core unreachable"))
      .mockResolvedValueOnce(running("upcoming"))
      .mockReturnValue(new Promise(() => {}));
    render(
      <DemoSeedModal kind="create" name="Demo" job={job} pollMs={5} onClose={() => {}} renderDone={() => null} />,
    );
    await waitFor(() => expect(stateOf("upcoming")).toBe("active"));
    expect(screen.queryByText(/core unreachable/)).toBeNull();
  });
});
