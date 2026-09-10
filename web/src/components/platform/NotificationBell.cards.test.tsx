import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCardItem } from "@/api/types";

/**
 * 0217 — THE MEETING'S CARDS IN THE BELL.
 *
 * Two new kinds arrive from the worker the moment a meeting's summary and its
 * extraction have landed: «the summary is ready» to the roster, «you committed
 * to this» to each owner. The server stores DATA (the meeting's title, the
 * commitment's sentence) and no prose, so the sentence around the title is the
 * catalogue's — asserted against the real fa.json — and the card opens the
 * MEETING rather than the conversations list every other card opens.
 *
 * The CONTROL is the half that makes the destination an assertion: a brief
 * still goes to /conversations and a colleague's message still goes nowhere,
 * because one destination for every kind would pass the two meeting cases and
 * send a digest to a meeting page.
 */
const push = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

let CARDS: AgentCardItem[] = [];
const marked: string[] = [];
vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    cards: async () => ({ cards: CARDS }),
    invites: async () => [],
    markCardRead: async (id: string) => { marked.push(id); },
    respondToInvite: async () => { throw new Error("no invitation in this file"); },
  },
}));

import { NotificationBell } from "./NotificationBell";

function card(over: Partial<AgentCardItem>): AgentCardItem {
  return {
    id: "c-1", kind: "post_call_brief", title: "خلاصهٔ آمادهٔ «تماس ۱»", session_id: "s-1",
    created_at: "2026-09-10T08:00:00.000Z", read: false, body: "",
    from_name: null, from_name_en: null, meeting_id: null,
    ...over,
  };
}

async function openPanel(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "اعلان‌ها" }));
}

beforeEach(() => {
  CARDS = [];
  marked.length = 0;
  push.mockClear();
});

describe("a meeting's cards in the bell (0217)", () => {
  it("«the summary is ready» names the meeting from the catalogue, and opens the meeting", async () => {
    CARDS = [card({ id: "c-r", kind: "meeting_ready", title: "جلسهٔ برنامه‌ریزی", meeting_id: "mtg-1", session_id: null })];
    render(<NotificationBell />);
    await openPanel();

    const row = await screen.findByText("خلاصهٔ جلسهٔ «جلسهٔ برنامه‌ریزی» آماده است.");
    await userEvent.click(row);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/mtg-1"));
    expect(marked).toEqual(["c-r"]);
  });

  it("a commitment shows the SENTENCE the meeting heard under the meeting's name, and opens the meeting", async () => {
    CARDS = [card({
      id: "c-c", kind: "meeting_commitment", title: "جلسهٔ برنامه‌ریزی",
      body: "گزارش هزینه‌ها را تا شنبه می‌فرستم", meeting_id: "mtg-1", session_id: null,
    })];
    render(<NotificationBell />);
    await openPanel();

    expect(await screen.findByText("تعهد شما در جلسهٔ «جلسهٔ برنامه‌ریزی»:")).toBeInTheDocument();
    await userEvent.click(screen.getByText("گزارش هزینه‌ها را تا شنبه می‌فرستم"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/mtg-1"));
  });

  it("THE CONTROL: a brief still opens the conversations, and a colleague's message still goes nowhere", async () => {
    CARDS = [
      card({ id: "c-b" }),
      card({ id: "c-m", kind: "member_message", title: "", body: "سلام، فردا می‌بینمت", from_name: "سارا" }),
    ];
    render(<NotificationBell />);
    await openPanel();

    await userEvent.click(await screen.findByText("خلاصهٔ آمادهٔ «تماس ۱»"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/conversations"));

    push.mockClear();
    await openPanel();
    await userEvent.click(await screen.findByText("سلام، فردا می‌بینمت"));
    await waitFor(() => expect(marked).toContain("c-m"));
    expect(push).not.toHaveBeenCalled();
  });

  it("a meeting card whose meeting is GONE falls through to the conversations rather than to a 404", async () => {
    CARDS = [card({ id: "c-g", kind: "meeting_ready", title: "جلسهٔ قدیمی", meeting_id: null, session_id: null })];
    render(<NotificationBell />);
    await openPanel();

    await userEvent.click(await screen.findByText("خلاصهٔ جلسهٔ «جلسهٔ قدیمی» آماده است."));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/conversations"));
  });
});
