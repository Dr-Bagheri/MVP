import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCardItem } from "@/api/types";

/**
 * db/0221 — A CARD OPENS ITS OWN CONVERSATION.
 *
 * The bell pushed `/conversations` for every card and never read `session_id`,
 * while the comment beside that line claimed the opposite ("every other card
 * points at the conversation that produced it"). That was survivable only
 * because an agent-opened session was LISTED in the history table, so "go to
 * the list and find it by title" happened to work.
 *
 * 0221 excludes those rows from that list. The two changes are one change:
 * with the filter and without this, a post-call brief is written, its card
 * rings, and pressing it lands on a table that deliberately does not contain
 * it — the brief becomes unreachable, which is a worse outcome than the
 * sidebar row we were asked to remove.
 *
 * THE NEGATIVE CONTROLS ARE THE POINT. "It navigates somewhere" passes for the
 * shipped bug, and "it uses session_id" passes for a version that sends a
 * purged card to `/assistant?c=null`. So three cards differ in exactly the way
 * the rule cares about:
 *
 *   A  a brief WITH a session      → /assistant?c=<id>   (the fix)
 *   B  a brief whose session is NULL → /conversations     (0074's tombstone)
 *   C  a colleague's message         → nowhere            (0167, unchanged)
 *
 * B is what stops "always use session_id" passing; C is what stops "always
 * navigate" passing; A is what stops the shipped behaviour passing.
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
    markCardRead: async (id: string) => {
      marked.push(id);
    },
    respondToInvite: async () => ({ kind: "chat_channel", target_id: "c-1" }),
  },
}));

function card(over: Partial<AgentCardItem>): AgentCardItem {
  return {
    id: "card-1",
    kind: "post_call_brief",
    /* the string the defect was reported against, verbatim */
    title: "خلاصهٔ آمادهٔ «Weekly meeting with NAI»",
    session_id: "5f7c1f6e-3d2b-4a91-8c44-6f2d9f0f1a2b",
    created_at: "2026-09-09T10:46:31.863Z",
    read: false,
    body: "",
    from_name: null,
    from_name_en: null,
    /* 0217's column, at its default: a brief is not a meeting card, and a
       fixture missing it would be a row shape the BFF never sends */
    meeting_id: null,
    ...over,
  };
}

import { NotificationBell } from "./NotificationBell";

/** the cards are read on mount AND on every open */
async function openPanel(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "اعلان‌ها" }));
}

beforeEach(() => {
  CARDS = [];
  marked.length = 0;
  push.mockClear();
});

describe("a card in the bell goes where its content is", () => {
  it("opens the brief's OWN conversation, not the history table", async () => {
    CARDS = [card({ id: "c-brief", session_id: "sess-77" })];
    render(<NotificationBell />);
    await openPanel();

    await userEvent.click(
      await screen.findByRole("button", { name: /Weekly meeting with NAI/ }),
    );

    /* the whole defect: `/conversations` is a list that, after 0221, does not
       contain this thread — asserted as the exact address rather than as "some
       navigation happened" */
    await waitFor(() => expect(push).toHaveBeenCalledWith("/assistant?c=sess-77"));
    expect(push).not.toHaveBeenCalledWith("/conversations");
    expect(marked).toEqual(["c-brief"]);
  });

  it("sends a card whose conversation was PURGED to the list instead", async () => {
    /* NEGATIVE CONTROL for the fix itself. `session_id` is null only because
       db/0074's composite FK set it null when the org was purged — so the
       thread is gone, and `/assistant?c=null` would be a 404 wearing a
       conversation's clothes. A version that interpolates unconditionally
       passes the test above and fails here. */
    CARDS = [card({ id: "c-orphan", session_id: null })];
    render(<NotificationBell />);
    await openPanel();

    await userEvent.click(
      await screen.findByRole("button", { name: /Weekly meeting with NAI/ }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/conversations"));
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("c=null"));
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("c=undefined"));
  });

  it("still takes a colleague's message NOWHERE (0167)", async () => {
    /* NEGATIVE CONTROL for the navigation itself: a version that navigates for
       every card passes both tests above. A message's whole content is on the
       row and there is no conversation to open. */
    CARDS = [card({ id: "c-msg", kind: "member_message", title: "", body: "میتینگ ساعت ۴", session_id: null, from_name: "سارا" })];
    render(<NotificationBell />);
    await openPanel();

    await userEvent.click(await screen.findByRole("button", { name: /میتینگ ساعت ۴/ }));

    await waitFor(() => expect(marked).toEqual(["c-msg"]));
    expect(push).not.toHaveBeenCalled();
  });
});
