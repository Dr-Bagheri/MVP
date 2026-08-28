import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings·Notifications — the assertions are about the WIRE, not the pixel:
 * each switch must move exactly one stored fact, spelled exactly as the
 * server stores it. A row whose column the deployment lacks renders the
 * honest reason instead of a switch (the capability pattern), and a row
 * whose state could not be READ names that as a different nothing.
 *
 * Save-then-adopt is asserted from its failing side: a refused save leaves
 * the switch where it was and says so — the test that goes red the moment
 * someone makes the component "nicer" with an optimistic flip.
 */

const ME = {
  id: "u-1", org_id: "o-1", email: "user@example.test", display_name: "کاربر",
  role: "member", status: "active", locale: "fa",
  calendar: "auto", timezone: "auto",
  assistant_reply_language: null, assistant_reply_length: null,
  assistant_instructions: null,
  post_call_brief: true,
  auto_draft_replies: false,
  auto_meeting_prep: false,
};

const me = vi.fn();
const weeklyDigest = vi.fn();
const updateAssistant = vi.fn();
const setWeeklyDigest = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    weeklyDigest: () => weeklyDigest(),
    updateAssistant: (patch: unknown) => updateAssistant(patch),
    setWeeklyDigest: (enabled: boolean) => setWeeklyDigest(enabled),
  },
}));

const notify = vi.fn();
vi.mock("@/lib/notify", () => ({
  notify: (text: string, kind?: string) => notify(text, kind),
}));

const { NotificationsSettings } = await import("./NotificationsSettings");

beforeEach(() => {
  me.mockReset();
  weeklyDigest.mockReset();
  updateAssistant.mockReset();
  setWeeklyDigest.mockReset();
  notify.mockReset();
  me.mockResolvedValue(ME);
  weeklyDigest.mockResolvedValue({ available: true, enabled: false });
  // echo the patch back the way the BFF does: the adopted value is the
  // server's answer, so the mock must answer
  updateAssistant.mockImplementation(async (patch: object) => ({ ...ME, ...patch }));
  setWeeklyDigest.mockResolvedValue(undefined);
});

describe("each toggle moves exactly its own stored fact", () => {
  it("post-call brief sends { post_call_brief } and adopts the server's answer", async () => {
    render(<NotificationsSettings />);
    // anchored on post-fetch state: the switch exists only once data arrived
    const sw = await screen.findByRole("switch", { name: "خلاصهٔ پس از تماس" });
    expect(sw).toHaveAttribute("aria-checked", "true");

    fireEvent.click(sw);
    expect(updateAssistant).toHaveBeenCalledWith({ post_call_brief: false });
    // adopt-after-answer, and the adopted value is the returned one
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
  });

  it("auto-draft and meeting-prep send their own columns, nothing beside them", async () => {
    render(<NotificationsSettings />);
    const draft = await screen.findByRole("switch", { name: "پیش‌نویس خودکار پاسخ ایمیل" });
    fireEvent.click(draft);
    expect(updateAssistant).toHaveBeenCalledWith({ auto_draft_replies: true });
    await waitFor(() => expect(draft).toHaveAttribute("aria-checked", "true"));

    const prep = screen.getByRole("switch", { name: "آماده‌سازی پیش از جلسه" });
    fireEvent.click(prep);
    expect(updateAssistant).toHaveBeenCalledWith({ auto_meeting_prep: true });
    await waitFor(() => expect(prep).toHaveAttribute("aria-checked", "true"));
  });

  it("the weekly digest goes through its own wire, not the assistant patch", async () => {
    render(<NotificationsSettings />);
    const sw = await screen.findByRole("switch", { name: "گزارش هفتگی" });
    expect(sw).toHaveAttribute("aria-checked", "false");

    fireEvent.click(sw);
    expect(setWeeklyDigest).toHaveBeenCalledWith(true);
    expect(updateAssistant).not.toHaveBeenCalled();
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
  });
});

describe("the kinds of nothing", () => {
  it("a deployment without the auto-draft column gets the reason, not a switch", async () => {
    const { auto_draft_replies: _dropped, ...withoutColumn } = ME;
    void _dropped;
    me.mockResolvedValue(withoutColumn);
    render(<NotificationsSettings />);

    // the CONTROL: a sibling row on the same wire still renders a live
    // switch, so "no switch" below cannot be the fetch failing wholesale
    await screen.findByRole("switch", { name: "خلاصهٔ پس از تماس" });

    expect(screen.queryByRole("switch", { name: "پیش‌نویس خودکار پاسخ ایمیل" })).toBeNull();
    expect(screen.getAllByText("این تنظیم هنوز روی این استقرار فعال نیست.")).toHaveLength(1);
  });

  it("a digest the deployment cannot serve renders the same honest reason", async () => {
    weeklyDigest.mockResolvedValue({ available: false, enabled: false });
    render(<NotificationsSettings />);
    await screen.findByRole("switch", { name: "خلاصهٔ پس از تماس" });
    expect(screen.queryByRole("switch", { name: "گزارش هفتگی" })).toBeNull();
    expect(screen.getAllByText("این تنظیم هنوز روی این استقرار فعال نیست.")).toHaveLength(1);
  });

  it("an unreadable state is NOT reported as 'not available' — different nothings", async () => {
    me.mockRejectedValue(new Error("network"));
    weeklyDigest.mockRejectedValue(new Error("network"));
    render(<NotificationsSettings />);
    await waitFor(() =>
      expect(screen.getAllByText("وضعیت فعلی این تنظیم خوانده نشد.")).toHaveLength(4),
    );
    expect(screen.queryByText("این تنظیم هنوز روی این استقرار فعال نیست.")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("save-then-adopt, never optimistic", () => {
  it("a refused save leaves the switch where it was, and says so", async () => {
    updateAssistant.mockRejectedValue(new Error("500"));
    render(<NotificationsSettings />);
    const sw = await screen.findByRole("switch", { name: "خلاصهٔ پس از تماس" });

    fireEvent.click(sw);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("ذخیره نشد.", "warn"));
    // the switch never moved: nothing was adopted because nothing was saved
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("a refused digest save leaves ITS switch unchanged too", async () => {
    setWeeklyDigest.mockRejectedValue(new Error("500"));
    render(<NotificationsSettings />);
    const sw = await screen.findByRole("switch", { name: "گزارش هفتگی" });

    fireEvent.click(sw);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("ذخیره نشد.", "warn"));
    expect(sw).toHaveAttribute("aria-checked", "false");
  });
});
