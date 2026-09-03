import { render, screen, waitFor } from "@testing-library/react";
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
 *
 * audit finding, 2026-09-02: the card's heading is FRAME now and renders
 * before api.me() answers, so `findByRole("heading")` no longer proves the
 * form loaded — awaiting it would pass during the skeleton and the option
 * queries below would run against an empty form (the temporal vacuum). The
 * anchor is the loaded state itself: `loaded()` waits for the form's own
 * language option.
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

/** the form is on screen — anchored on a node that exists ONLY after the
    wire answered with the group, never on the frame */
async function loaded() {
  await waitFor(() => expect(document.querySelector('option[value="fa"]')).not.toBeNull());
}

const skeleton = () => document.querySelector("[aria-busy='true']");

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
    expect(screen.getByRole("heading", { name: "لحن و رفتار دستیار" })).toBeInTheDocument();

    // the instrument's positive control: this query style CAN find options
    // in this DOM (the voice card's language select) — once it is loaded
    await loaded();

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
    await loaded();
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
    expect(screen.getByRole("heading", { name: "لحن و رفتار دستیار" })).toBeInTheDocument();
    await loaded();

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

describe("the card is frame; only its body waits for the wire (audit finding, 2026-09-02)", () => {
  /*
   * Before: one boolean gated the whole card, so "not answered yet", "this
   * deployment has no assistant columns" and "the read failed" were the same
   * blank area. Each is its own picture now, and the frame never moves.
   */
  it("pending: the heading stands, a skeleton holds the form's place, no control yet", () => {
    me.mockReturnValue(new Promise(() => undefined)); // never answers
    render(<AssistantSettings />);

    expect(screen.getByRole("heading", { name: "لحن و رفتار دستیار" })).toBeInTheDocument();
    expect(skeleton()).not.toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    // and neither of the two sentences is shown for a state nobody knows yet
    expect(screen.queryByText("این استقرار هنوز تنظیمات لحن دستیار را ذخیره نمی‌کند.")).toBeNull();
    expect(screen.queryByText("تنظیمات فعلی دستیار خوانده نشد.")).toBeNull();

    /*
     * 2026-09-03: the SIZE of what is reserved, not merely its presence.
     * The placeholder was three blocks of SkeletonLines — bars where fields
     * land — so the card still grew by roughly 76px when the answer arrived,
     * which is the jump the whole rule exists to remove. It is one
     * FieldSkeleton per field now: five fields (reply language, reply length,
     * the two voices, the instructions box), each a label bar plus a control
     * bar at `.input`'s own height. The count goes red the day a field is
     * added without extending the reserved space — the way a skeleton
     * silently becomes the wrong size.
     */
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(5 * 2);
  });

  it("absent: a wire without the group renders the honest sentence, not defaults wearing controls", async () => {
    const { assistant_instructions: _dropped, ...withoutGroup } = ME;
    void _dropped;
    me.mockResolvedValue(withoutGroup);
    render(<AssistantSettings />);

    expect(await screen.findByText("این استقرار هنوز تنظیمات لحن دستیار را ذخیره نمی‌کند.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(skeleton()).toBeNull();
  });

  it("unreadable: a rejected read says so instead of staying blank forever", async () => {
    me.mockRejectedValue(new Error("network"));
    render(<AssistantSettings />);

    expect(await screen.findByText("تنظیمات فعلی دستیار خوانده نشد.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(skeleton()).toBeNull();
  });

  it("ready: the negative control — no skeleton and no sentence once the form is up", async () => {
    render(<AssistantSettings />);
    await loaded();

    expect(skeleton()).toBeNull();
    /* the five fields the placeholder above reserves ten bars for: four
       selects and the standing-instructions box. Asserted here so that count
       is anchored to something real rather than to itself. */
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(screen.queryByText("این استقرار هنوز تنظیمات لحن دستیار را ذخیره نمی‌کند.")).toBeNull();
    expect(screen.queryByText("تنظیمات فعلی دستیار خوانده نشد.")).toBeNull();
  });
});
