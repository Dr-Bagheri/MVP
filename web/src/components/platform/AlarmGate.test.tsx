import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DueAlarmItem } from "@/api/types";

/**
 * THE ALARM POP-UP (db/0231).
 *
 * User directive, 2026-09-18: an alarm gives "a notification pop up in the
 * platform", a task near its deadline alarms, and a meeting alarms half an
 * hour before — including one somebody has just added you to.
 *
 * ── what this file is about, and what it is deliberately not ──────────────
 *
 * WHICH alarms are due is the SERVER's answer and is asserted in core
 * (test/reminders.test.ts) and against real RLS in db/test/134. A browser-side
 * fixture of "is this within thirty minutes" would be a second clock, and the
 * two disagreeing is the one failure an alarm cannot have.
 *
 * What is asserted here is the part the browser owns and nothing else can
 * see: that an alarm is SHOWN, that answering it tells the SERVER rather than
 * a local list, that three arriving together are answered one at a time, and
 * that the two kinds with somewhere to go offer a door while the kind with
 * nowhere to go does not.
 */

const dueAlarms = vi.fn();
const ackAlarm = vi.fn();
const push = vi.fn();

vi.mock("@/api/client", () => ({ api: { dueAlarms: () => dueAlarms(), ackAlarm: (k: string) => ackAlarm(k) } }));
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn(), notifyError: vi.fn() }));

const { AlarmGate } = await import("./AlarmGate");

const alarm = (over: Partial<DueAlarmItem> = {}): DueAlarmItem => ({
  key: "reminder:r-1", kind: "custom", at: "2026-09-18T10:00:00.000Z", label: "دیتاست صوتی", ...over,
});

beforeEach(() => {
  dueAlarms.mockReset();
  ackAlarm.mockReset();
  push.mockReset();
  ackAlarm.mockResolvedValue(undefined);
});

describe("an alarm that is due", () => {
  it("comes up as a pop-up carrying its own words and its moment", async () => {
    dueAlarms.mockResolvedValue({ alarms: [alarm()] });
    render(<AlarmGate />);
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("دیتاست صوتی")).toBeTruthy();
  });

  it("shows NOTHING when nothing is due — the control", async () => {
    // Without this, a gate that renders its dialog unconditionally passes
    // every assertion above and puts an empty box on every page in the
    // product.
    dueAlarms.mockResolvedValue({ alarms: [] });
    const { container } = render(<AlarmGate />);
    await waitFor(() => expect(dueAlarms).toHaveBeenCalled());
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("tells the SERVER it was seen, with the server's own key", async () => {
    /* the whole reason acknowledging is a write: an alarm dismissed on a
       phone must not ring again on a laptop, and a browser-side list is a
       per-device answer to a per-person question */
    dueAlarms.mockResolvedValue({ alarms: [alarm({ key: "task:t-1:2026-09-18T10:00:00.000Z", kind: "task", task_id: "t-1" })] });
    const user = userEvent.setup();
    render(<AlarmGate />);
    await user.click(await screen.findByRole("button", { name: "باشه" }));
    expect(ackAlarm).toHaveBeenCalledWith("task:t-1:2026-09-18T10:00:00.000Z");
  });

  it("answers three in turn rather than stacking three boxes", async () => {
    dueAlarms.mockResolvedValue({ alarms: [
      alarm({ key: "a", label: "یک" }), alarm({ key: "b", label: "دو" }), alarm({ key: "c", label: "سه" }),
    ] });
    const user = userEvent.setup();
    render(<AlarmGate />);
    await screen.findByText("یک");
    expect(screen.queryByText("دو")).toBeNull();
    await user.click(screen.getByRole("button", { name: "باشه" }));
    await screen.findByText("دو");
  });

  it("opens the thing it is about, and offers no door when there is none", async () => {
    /* a task and a meeting have somewhere to go; a custom alarm is words the
       person wrote and has nowhere — a button that navigated to a page about
       nothing would be the pop-up's one act being a lie */
    dueAlarms.mockResolvedValue({ alarms: [alarm({
      key: "meeting:m-1:2026-09-18T10:30:00.000Z", kind: "meeting", meeting_id: "m-1", label: "هفتگی",
    })] });
    const user = userEvent.setup();
    const view = render(<AlarmGate />);
    await user.click(await screen.findByRole("button", { name: "بازکردن" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/m-1"));
    view.unmount();

    push.mockReset();
    dueAlarms.mockResolvedValue({ alarms: [alarm()] });
    render(<AlarmGate />);
    await screen.findByRole("alertdialog");
    expect(screen.queryByRole("button", { name: "بازکردن" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "باشه" }));
    await waitFor(() => expect(ackAlarm).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("closes the box even when telling the server FAILED", async () => {
    // An alarm that will not go away because a write failed is an alarm that
    // cannot be closed — the person has seen it, which is what the button
    // means. The next poll may bring it back, and that is the right failure.
    dueAlarms.mockResolvedValue({ alarms: [alarm()] });
    ackAlarm.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    const { container } = render(<AlarmGate />);
    await user.click(await screen.findByRole("button", { name: "باشه" }));
    await waitFor(() => expect(container.querySelector("[role=dialog]")).toBeNull());
  });

  it("survives a page whose api mock has never heard of it", async () => {
    /* it mounts in the SHELL, so every page test in the product renders it
       with whatever mock that page carries. Calling undefined throws
       synchronously in the effect and takes the page down — and the failure
       arrives as whatever rendered last, which is the shape that sends
       somebody to fix a component that is not broken. */
    dueAlarms.mockImplementation(() => { throw new TypeError("api.dueAlarms is not a function"); });
    const { container } = render(<AlarmGate />);
    await waitFor(() => expect(dueAlarms).toHaveBeenCalled());
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });
});
