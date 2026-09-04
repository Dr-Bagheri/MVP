import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
 *
 * THE DOOR MOVED on 2026-09-05 (user directive: "remove the other reply and
 * emoji that comes in the same row"). The hover bar these tests used to press
 * is gone and the right-click menu is the only way in, so they open it —
 * which is worth doing rather than mocking, because "the menu opens on the
 * message" is itself one of the things the directive corrected.
 */

/** open a message's menu the way a person does */
async function openMenu(row: HTMLElement): Promise<void> {
  /* `contextMenu`, not a click: the row listens for the real event and reads
     `clientX/clientY` off it to place the panel. jsdom reports 0 for both,
     which is fine — WHERE it lands is a style assertion, and this is about
     what is inside. */
  fireEvent.contextMenu(row);
}
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

    await openMenu(within(log).getByText(/کی جلسه را می‌گیرد/));
    await userEvent.click(await screen.findByRole("menuitem", { name: "پاسخ" }));
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

    await openMenu(within(log).getByText(/کی جلسه را می‌گیرد/));
    await userEvent.click(await screen.findByRole("menuitem", { name: "پاسخ" }));
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
  it("sends the emoji ON from the menu's quick strip", async () => {
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText(/کی جلسه را می‌گیرد/);

    await openMenu(within(log).getByText(/کی جلسه را می‌گیرد/));
    await userEvent.click(await screen.findByRole("button", { name: "👍" }));
    await waitFor(() => expect(reacted).toEqual([{ id: "m-1", emoji: "👍", on: true }]));
  });

  it("offers no way to DELETE a message, and still offers the reply", async () => {
    /*
     * User directive, 2026-09-05: "remove the delete from the right click".
     * It sat one row under «پاسخ», where the press that means "answer this"
     * is a few pixels from the press that removes it.
     *
     * Asserted as an ABSENCE beside a PRESENCE, because the version that
     * renders no menu at all satisfies "no delete" perfectly.
     */
    MESSAGES = [message({ id: "m-1", seq: 1, author_id: "u-1", body: "پیام خودم" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText("پیام خودم");

    await openMenu(within(log).getByText("پیام خودم"));
    expect(await screen.findByRole("menuitem", { name: "پاسخ" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /حذف/ })).toBeNull();
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

describe("standing in no room", () => {
  /*
   * User directive, 2026-09-05: "when you delete a room it must go away and
   * become empty, not stay with the previous chats. If you leave the room the
   * chat box should become empty as well."
   *
   * Both were the same defect: the room list reloaded and the MESSAGES were
   * left on screen, so the box went on showing a conversation whose room was
   * gone. Asserted on the words rather than on the room chip, because the
   * chip disappearing while the transcript stayed is exactly the bug.
   */
  it("empties the box when the room is deleted — with the list still stale", async () => {
    /*
     * THE FIRST VERSION OF THIS TEST COULD NOT SEE THE BUG, and the bug was
     * reported twice.
     *
     * It set `CHANNELS = []` BEFORE pressing delete — pre-emptying the room
     * list, which is the one state in which the defect cannot happen. The
     * real sequence is the opposite: the archive lands, the box clears, and
     * the list has NOT caught up yet — so the auto-select effect finds the
     * deleted room still sitting at index 0 and hands it straight back. That
     * is why a reload "fixed" it.
     *
     * So the list stays stale here on purpose. The fixture is the state the
     * user was in, not the state that makes the assertion easy.
     */
    MESSAGES = [message({ id: "m-1", seq: 1, body: "پیام قدیمی" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText("پیام قدیمی");

    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های اتاق" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /حذف اتاق/ }));

    await waitFor(() => expect(screen.queryByText("پیام قدیمی")).toBeNull());
    /* and it STAYS gone — the defect was a re-selection one tick later, so an
       assertion that fires immediately would pass against the broken code */
    await waitFor(() => expect(screen.getByText(/اتاقی انتخاب نشده است/)).toBeInTheDocument());
    expect(screen.queryByText("پیام قدیمی")).toBeNull();
  });

  it("empties it when the reader LEAVES, too", async () => {
    MESSAGES = [message({ id: "m-1", seq: 1, body: "پیام قدیمی" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText("پیام قدیمی");

    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های اتاق" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "خروج از اتاق" }));

    await waitFor(() => expect(screen.queryByText("پیام قدیمی")).toBeNull());
    /* leaving keeps the room in the LIST — it is still readable by every
       member — so this is the case where the auto-select effect would hand it
       back forever. The box must stay empty until a room is chosen. */
    await waitFor(() => expect(screen.getByText(/اتاقی انتخاب نشده است/)).toBeInTheDocument());
  });

  it("comes back the moment a room is CHOSEN, so leaving is not a dead end", async () => {
    /* the control for the two above: a version that simply stopped selecting
       rooms would pass both of them and leave the product unusable */
    MESSAGES = [message({ id: "m-1", seq: 1, body: "پیام قدیمی" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText("پیام قدیمی");

    await userEvent.click(screen.getByRole("button", { name: "گزینه‌های اتاق" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "خروج از اتاق" }));
    await waitFor(() => expect(screen.getByText(/اتاقی انتخاب نشده است/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: /عمومی/ }));
    await waitFor(() => expect(screen.getByText("پیام قدیمی")).toBeInTheDocument());
  });

  it("says «حذف اتاق» rather than «بایگانی»", async () => {
    /* the word names what the person GETS, and what they get is a room that
       is gone. The schema still archives — a room's messages are a record —
       but «بایگانی اتاق» described the implementation to somebody who cannot
       see it. */
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    await userEvent.click(await screen.findByRole("button", { name: "گزینه‌های اتاق" }));
    expect(await screen.findByRole("menuitem", { name: /حذف اتاق/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /بایگانی/ })).toBeNull();
  });
});

describe("answering an agent", () => {
  it("writes the agent's handle into the draft, once", async () => {
    /*
     * User directive: "if you reply on agent's message it must add @
     * automatically."
     *
     * In the DRAFT, where the person can see it and delete it — a silent
     * prefix added on the way out would summon somebody with a word the
     * sender never saw. The server has the same rule off the stored row, so
     * deleting the handle still reaches the agent; this is the visible half.
     */
    MESSAGES = [message({
      id: "m-1", seq: 1, author_kind: "agent", author_id: null,
      agent_handle: "roya", body: "سلام! چه کاری می‌توانم بکنم؟",
    })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText(/چه کاری می‌توانم بکنم/);

    await openMenu(within(log).getByText(/چه کاری می‌توانم بکنم/));
    await userEvent.click(await screen.findByRole("menuitem", { name: "پاسخ" }));

    const box = screen.getByPlaceholderText(/پیام بنویسید/);
    await waitFor(() => expect(box).toHaveValue("@roya "));

    /* and typing does not add a second one — the effect runs on every render
       while a reply is open, so "once" is the assertion that matters */
    await userEvent.type(box, "چرا؟");
    expect(box).toHaveValue("@roya چرا؟");
  });

  it("does NOT write a handle when the message is a colleague's", async () => {
    /* the control: a version that prefixed every reply would satisfy the test
       above perfectly, and would put an @ in front of every answer to a human */
    MESSAGES = [message({ id: "m-1", seq: 1, author_id: "u-2", body: "سلام" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText("سلام");

    await openMenu(within(log).getByText("سلام"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "پاسخ" }));

    await screen.findByText(/پاسخ به/);
    expect(screen.getByPlaceholderText(/پیام بنویسید/)).toHaveValue("");
  });
});
