import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChannelRecord, ChatMessageRecord, OrgPersonRecord } from "@/api/types";

/**
 * 0189 — REPLY AND REACTION, the two things the directive asked for on every
 * message ("for each message that has been sent there must be a possible
 * right click to do the reply and reaction emoji as well").
 *
 * The subject here is the WIRING, not the menu: what the room sends when
 * somebody answers a message, and what it sends when they press a reaction.
 * Both are one argument wide and both are silently wrong in a way no screen
 * shows — a reply posted with `reply_to: null` renders exactly like a reply,
 * and a toggle that always sends `on: true` looks like a reaction that
 * refuses to come off.
 *
 * The quote's own test is the third: it stays on screen until the message is
 * sent, and it COMES BACK if the send is refused. A reply target held only in
 * state, with nothing on screen, is a message that answers something for
 * reasons only the sender knows.
 */
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

vi.mock("@/lib/chatLive", async () => {
  const real = await vi.importActual<typeof import("@/lib/chatLive")>("@/lib/chatLive");
  return { ...real, openChatLive: (h: { onState: (s: string) => void }) => { h.onState("live"); return () => undefined; } };
});

const posted: Array<{ body: string; reply_to: string | null }> = [];
const reacted: Array<{ id: string; emoji: string; on: boolean }> = [];
let SEND_FAILS = false;
let CHANNELS: ChatChannelRecord[] = [];
let MESSAGES: ChatMessageRecord[] = [];

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    chatChannels: async () => CHANNELS,
    chatMessages: async () => MESSAGES,
    postChatMessage: async (_c: string, body: string, replyTo: string | null) => {
      if (SEND_FAILS) throw new Error("refused");
      posted.push({ body, reply_to: replyTo });
      return message({ id: "m-new", seq: 99, body });
    },
    reactToChatMessage: async (id: string, emoji: string, on: boolean) => {
      reacted.push({ id, emoji, on });
      return message({ id, reactions: on ? [{ emoji, count: 1, mine: true }] : [] });
    },
    editChatMessage: async (id: string) => message({ id, deleted: true, body: null }),
    markChatRead: async () => undefined,
    setChatJoined: async () => undefined,
    updateChatChannel: async () => CHANNELS[0]!,
    createChatChannel: async () => CHANNELS[0]!,
    chatTicket: async () => ({ ticket: "t", direct_url: null }),
    agents: async () => [],
  },
}));

function channel(over: Partial<ChatChannelRecord>): ChatChannelRecord {
  return {
    id: "c-1", name: "عمومی", topic: "", project_id: null, archived_at: null,
    created_by: "u-1", created_at: "2026-09-01T08:00:00.000Z",
    joined: true, muted: false, last_seq: 0, last_read_seq: 0, mention_count: 0,
    ...over,
  };
}

function message(over: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: "m-1", seq: 1, channel_id: "c-1", author_kind: "user", author_id: "u-2",
    agent_handle: null, body: "سلام", deleted: false, edited_at: null,
    created_at: "2026-09-01T08:00:00.000Z", mentions: [], reactions: [], reply_to: null,
    ...over,
  };
}

const PEOPLE: OrgPersonRecord[] = [
  { id: "u-1", display_name: "سینا", display_name_en: null, role: "owner", username: "sina" },
  { id: "u-2", display_name: "مریم", display_name_en: null, role: "member", username: "maryam" },
];

import { Chat } from "./Chat";

beforeEach(() => {
  CHANNELS = [channel({})];
  MESSAGES = [message({ id: "m-1", seq: 1, body: "کی جلسه را می‌گیرد؟" })];
  posted.length = 0;
  reacted.length = 0;
  SEND_FAILS = false;
});

describe("answering a message", () => {
  it("quotes it in the composer and posts the answer WITH its parent", async () => {
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText(/کی جلسه را می‌گیرد/);

    await userEvent.click(within(log).getByRole("button", { name: "پاسخ" }));
    /* the quote is on screen and names what is being answered */
    expect(await screen.findByText(/پاسخ به.*کی جلسه را می‌گیرد/)).toBeInTheDocument();

    const box = screen.getByPlaceholderText(/پیام بنویسید/);
    await userEvent.type(box, "من می‌گیرم{Enter}");

    /* THE LOAD-BEARING ASSERTION. Without `reply_to` the message still
       arrives, still renders, and answers nothing — the defect is invisible
       on the sender's own screen, which is why it is asserted on the wire. */
    await waitFor(() => expect(posted).toEqual([{ body: "من می‌گیرم", reply_to: "m-1" }]));
    /* and the quote is gone once it has been sent */
    expect(screen.queryByText(/پاسخ به/)).toBeNull();
  });

  it("puts the quote BACK when the send is refused", async () => {
    SEND_FAILS = true;
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText(/کی جلسه را می‌گیرد/);

    await userEvent.click(within(log).getByRole("button", { name: "پاسخ" }));
    await screen.findByText(/پاسخ به/);
    await userEvent.type(screen.getByPlaceholderText(/پیام بنویسید/), "من می‌گیرم{Enter}");

    /* the refusal is visible… */
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    /* …AND the target survives it. A composer that cleared the quote on a
       failure leaves the person to retype into a room where their next
       message answers nothing, and nothing on screen says so. */
    expect(screen.getByText(/پاسخ به.*کی جلسه را می‌گیرد/)).toBeInTheDocument();
    expect(posted).toEqual([]);
  });

  it("renders the quote above a reply that arrived with one", async () => {
    MESSAGES = [
      message({ id: "m-1", seq: 1, body: "کی جلسه را می‌گیرد؟" }),
      message({
        id: "m-2", seq: 2, author_id: "u-1", body: "من می‌گیرم",
        reply_to: {
          id: "m-1", author_kind: "user", author_id: "u-2",
          agent_handle: null, excerpt: "کی جلسه را می‌گیرد؟",
        },
      }),
    ];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });

    /* the parent's words appear TWICE — once as the message, once as the
       quote on the answer — and the quote names its author, which is the
       part that makes it readable without scrolling up */
    await waitFor(() => expect(within(log).getAllByText(/کی جلسه را می‌گیرد/)).toHaveLength(2));
    expect(within(log).getAllByText("مریم").length).toBeGreaterThan(0);
  });
});

describe("reacting to a message", () => {
  it("sends the emoji ON from the hover bar", async () => {
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText(/کی جلسه را می‌گیرد/);

    await userEvent.click(within(log).getByRole("button", { name: "واکنش" }));
    await waitFor(() => expect(reacted).toEqual([{ id: "m-1", emoji: "👍", on: true }]));
  });

  it("counts a reaction, and pressing your own takes it OFF", async () => {
    MESSAGES = [message({
      id: "m-1", seq: 1, body: "کی جلسه را می‌گیرد؟",
      reactions: [{ emoji: "🎉", count: 3, mine: true }],
    })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });

    /* the COUNT is the whole point of a chip: a bare glyph says somebody
       reacted, a chip says how many — in the reader's own digits */
    const chip = await within(log).findByRole("button", { pressed: true });
    expect(within(chip).getByText("۳")).toBeInTheDocument();

    await userEvent.click(chip);
    /* `on: false`, because it is already mine. A toggle that always sent
       true would look like a reaction that refuses to come off, and every
       press would be a no-op the server absorbs. */
    await waitFor(() => expect(reacted).toEqual([{ id: "m-1", emoji: "🎉", on: false }]));
  });
});
