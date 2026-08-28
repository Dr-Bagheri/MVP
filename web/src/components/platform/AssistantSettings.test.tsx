import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * [REVISED 2026-08-28, user directive] "remove watch and act from everywhere
 * in the platform. the only thing that must be in the platform is assist."
 *
 * The autonomy dial used to be this screen's first card. These tests assert
 * its ABSENCE — and because "renders identically to its absence" is the
 * failure this repo keeps finding, the instrument carries its own controls:
 *
 *  - the POSITIVE control: the same option-query that must find nothing for
 *    the dial DOES find the voice card's language options, so an empty
 *    verdict cannot be the query failing to see the DOM at all;
 *  - the fixture is the load-bearing one: /v1/me still CARRIES `autonomy`
 *    on the wire (the field stayed; core pins it), and here it deliberately
 *    says "act" — a component that quietly rendered the stored dial again
 *    would put a watch/act option or the old heading back on screen and go
 *    red here.
 */

const ME = {
  id: "u-1", org_id: "o-1", email: "user@example.test", display_name: "کاربر",
  avatar_url: null, role: "member", status: "active", locale: "fa",
  calendar: "auto", timezone: "auto",
  /* the wire field survives the dial — and may hold a stale value */
  autonomy: "act",
  assistant_reply_language: null, assistant_reply_length: null,
  assistant_instructions: null, post_call_brief: true,
  auto_draft_replies: false, auto_meeting_prep: false,
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

const { AssistantSettings } = await import("./AssistantSettings");

beforeEach(() => {
  me.mockReset();
  weeklyDigest.mockReset();
  updateAssistant.mockReset();
  setWeeklyDigest.mockReset();
  me.mockResolvedValue(ME);
  weeklyDigest.mockResolvedValue({ available: true, enabled: false });
});

describe("the autonomy dial is GONE — assist is pinned, and not shown", () => {
  it("renders the voice card, and NO watch/act control anywhere", async () => {
    render(<AssistantSettings />);

    // positive identification: the screen under test actually rendered
    expect(await screen.findByRole("heading", { name: "لحن و رفتار دستیار" })).toBeInTheDocument();

    // the instrument's positive control: this query style CAN find options
    // in this DOM (the voice card's language select)
    expect(document.querySelector('option[value="fa"]')).not.toBeNull();

    // the absence itself: no control offers watch or act — a re-added dial
    // would reintroduce exactly these option values
    expect(document.querySelector('option[value="watch"]')).toBeNull();
    expect(document.querySelector('option[value="act"]')).toBeNull();
    // and the old card's heading is not merely renamed
    expect(screen.queryByText("سطح اختیار دستیار")).toBeNull();
  });

  it("a stale stored 'act' on the wire changes NOTHING on screen", async () => {
    /* the wire deliberately says act (see ME) — if any code path adopted it
       back into a rendered control, one of these would light up */
    render(<AssistantSettings />);
    await screen.findByRole("heading", { name: "لحن و رفتار دستیار" });
    expect(screen.queryByText("خوداجرا")).toBeNull();
    expect(screen.queryByText("فقط تماشا")).toBeNull();
  });
});

describe("the notification switches are GONE — they live in Settings·Notifications now", () => {
  /*
   * MOVED (user directive, 2026-08-28): post-call brief, weekly digest,
   * auto-draft and meeting prep are Settings·Notifications rows. The ME
   * fixture above is load-bearing here exactly as it is for the dial: the
   * wire STILL carries post_call_brief / auto_draft_replies /
   * auto_meeting_prep, so a component that quietly rendered its old
   * switches again would find every fact it needs — and go red below.
   */
  it("keeps the voice card and renders NO toggle of any kind", async () => {
    render(<AssistantSettings />);

    // the control: this screen still renders, and its remaining card is whole
    expect(await screen.findByRole("heading", { name: "لحن و رفتار دستیار" })).toBeInTheDocument();
    expect(document.querySelector('option[value="fa"]')).not.toBeNull();

    /* the absence, by STRUCTURE first: after the move this screen owns no
       boolean control at all — a re-added toggle in any dress (checkbox,
       switch) goes red here, whatever it is labelled */
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(screen.queryByRole("switch")).toBeNull();

    // and by NAME, so a row rebuilt on the new copy keys is caught too
    expect(screen.queryByText("خلاصهٔ پس از تماس")).toBeNull();
    expect(screen.queryByText("گزارش هفتگی")).toBeNull();
    expect(screen.queryByText("پیش‌نویس خودکار پاسخ ایمیل")).toBeNull();
    expect(screen.queryByText("آماده‌سازی پیش از جلسه")).toBeNull();
  });
});
