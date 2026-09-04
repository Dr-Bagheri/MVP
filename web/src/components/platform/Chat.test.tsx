import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChannelRecord, ChatMessageRecord, OrgPersonRecord } from "@/api/types";

/**
 * 0184 — the team channel's contract facts.
 *
 *  1. UNREAD IS BOLD; A MENTION IS A NUMBER. Two classes, not three — and the
 *     unread state is a COMPARISON of two numbers on the wire, never a flag
 *     the server maintained.
 *  2. AN AGENT'S MESSAGE IS MARKED AS ONE. `author_kind` is pinned by the
 *     writing database role, so the screen must not quietly render an agent
 *     row as a colleague's.
 *  3. A TOMBSTONE STAYS IN THE ROOM. The row is still there, the words are
 *     gone, and it says so — the alternative (hiding it) is the delete whose
 *     post-image its own author cannot see, which is how M11 broke.
 *  4. AN AGENT'S FAILURE IS AN ANNOTATION, NEVER A MESSAGE. A tidy apology
 *     written into the record is indistinguishable a week later from
 *     something the agent said.
 *  5. THE @ PICKER OFFERS AGENTS. Naming one is the whole authorization for
 *     it to answer, so it has to be as easy to type as a colleague's name.
 */
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

/* delivery is its own module with its own tests; here it is a hand the test
   can pull, so an event can be delivered without a network */
let emit: ((event: unknown) => void) | null = null;
vi.mock("@/lib/chatLive", async () => {
  const real = await vi.importActual<typeof import("@/lib/chatLive")>("@/lib/chatLive");
  return {
    ...real,
    openChatLive: (handlers: { onEvent: (e: unknown) => void; onState: (s: string) => void }) => {
      emit = handlers.onEvent;
      handlers.onState("live");
      return () => { emit = null; };
    },
  };
});

const posted: string[] = [];
let CHANNELS: ChatChannelRecord[] = [];
let MESSAGES: ChatMessageRecord[] = [];

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    chatChannels: async () => CHANNELS,
    chatMessages: async () => MESSAGES,
    postChatMessage: async (_id: string, body: string) => {
      posted.push(body);
      return message({ id: "m-new", seq: 99, body });
    },
    editChatMessage: async (id: string) => message({ id, deleted: true, body: null }),
    markChatRead: async () => undefined,
    setChatJoined: async () => undefined,
    updateChatChannel: async () => CHANNELS[0]!,
    createChatChannel: async () => CHANNELS[0]!,
    chatTicket: async () => ({ ticket: "t", direct_url: null }),
    /* AgentAvatar reads the roster to draw a portrait. Without this the
       component throws INSIDE a promise and the suite reports "مریم not
       found" — an unhandled rejection wearing the costume of an assertion
       failure, which is the shape that sends somebody to fix working code. */
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
    id: "m-1", seq: 1, channel_id: "c-1", author_kind: "user", author_id: "u-1",
    agent_handle: null, body: "سلام", deleted: false, edited_at: null,
    created_at: "2026-09-01T08:00:00.000Z", mentions: [], reactions: [], reply_to: null,
    ...over,
  };
}

const PEOPLE: OrgPersonRecord[] = [
  { id: "u-1", display_name: "سینا", display_name_en: null, role: "owner", username: "sina" },
  { id: "u-2", display_name: "مریم", display_name_en: null, role: "member", username: "maryam" },
  /* a colleague with NO handle — the picker must not offer them, because a
     mention of a handle nobody holds badges nobody */
  { id: "u-3", display_name: "رضا", display_name_en: null, role: "member", username: null },
];

import { Chat } from "./Chat";

beforeEach(() => {
  CHANNELS = [channel({})];
  MESSAGES = [];
  posted.length = 0;
  emit = null;
});

describe("the channel list", () => {
  it("bolds an unread room and numbers a mention — and does neither for a read one", async () => {
    /* the rooms moved from a left RAIL to the top sub-menu on 2026-09-04
       (user directive). The states did not change and neither did this test's
       subject: bold = unread, a number = you were named, and no third. */
    CHANNELS = [
      channel({ id: "c-1", name: "عمومی", last_seq: 9, last_read_seq: 9 }),
      channel({ id: "c-2", name: "پشتیبانی", last_seq: 12, last_read_seq: 4, mention_count: 3 }),
    ];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const rooms = await screen.findByRole("tablist", { name: "اتاق‌ها" });

    const read = within(rooms).getByText("عمومی");
    const unread = within(rooms).getByText("پشتیبانی");
    expect(unread.className).toContain("font-bold");
    /* the control: without it, a component that bolded EVERY chip passes */
    expect(read.className).not.toContain("font-bold");
    expect(within(rooms).getByText("۳")).toBeInTheDocument();
  });

  it("offers «افزودن اعضا» to an admin and to nobody else", async () => {
    /*
     * 0189: "the admins had to have this option to add all members and other
     * admins to the room". ABSENT rather than disabled, for the same reason
     * the project's create button is: a greyed control is a promise the
     * product will not keep, and pressing it explains nothing.
     */
    CHANNELS = [channel({ id: "c-1", name: "عمومی" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    expect(await screen.findByRole("button", { name: /افزودن اعضا/ })).toBeInTheDocument();

    cleanup();
    render(<Chat isAdmin={false} meId="u-1" people={PEOPLE} />);
    await waitFor(() => expect(screen.getByText("عمومی")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /افزودن اعضا/ })).toBeNull();
    /* the control: the room still rendered, so "no button" is not "no page" */
    expect(screen.getByRole("button", { name: /اتاق تازه/ })).toBeInTheDocument();
  });
});

describe("the room", () => {
  it("marks an agent's message as an agent's, and a colleague's as theirs", async () => {
    MESSAGES = [
      message({ id: "m-1", seq: 1, author_kind: "user", author_id: "u-2", body: "سلام رؤیا" }),
      message({
        id: "m-2", seq: 2, author_kind: "agent", author_id: null,
        agent_handle: "roya", body: "سلام! در خدمتم.",
      }),
    ];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });

    /* anchored on a value that exists only AFTER the read lands: the log box
       renders immediately (that is the loading rule), so `findByRole` alone
       would assert the skeleton and report it as the rule */
    expect(await within(log).findByText("مریم")).toBeInTheDocument();
    /* the agent tag renders ONCE — on the agent's row and not on the
       colleague's, which is what makes it a distinction rather than a label */
    expect(within(log).getAllByText("دستیار")).toHaveLength(1);
  });

  it("keeps a removed message in the room, and says it was removed", async () => {
    MESSAGES = [
      message({ id: "m-1", seq: 1, body: "پیام اول" }),
      message({ id: "m-2", seq: 2, body: null, deleted: true }),
      message({ id: "m-3", seq: 3, body: "پیام سوم" }),
    ];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });

    expect(await within(log).findByText("این پیام حذف شد.")).toBeInTheDocument();
    /* both neighbours still there: a tombstone that swallowed the rows
       around it would satisfy the line above and be a different bug */
    expect(within(log).getByText("پیام اول")).toBeInTheDocument();
    expect(within(log).getByText("پیام سوم")).toBeInTheDocument();
  });

  it("renders an agent's failure as an ANNOTATION, never as a message", async () => {
    MESSAGES = [message({ id: "m-1", seq: 1, body: "@roya یک خلاصه بده" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    /* AFTER the read, or `before` counts the skeleton and the assertion at
       the foot compares two different moments rather than two states */
    await within(log).findByText(/یک خلاصه بده/);
    const before = within(log).queryAllByRole("time").length;
    expect(before).toBe(1);

    await waitFor(() => expect(emit).not.toBeNull());
    emit!({ type: "agent_failed", channel_id: "c-1", handle: "roya" });

    await waitFor(() =>
      expect(within(log).getByText(/نتوانست پاسخ بدهد/)).toBeInTheDocument());
    /* THE LOAD-BEARING HALF: no new message row. A bubble would look tidier
       and would be, a week later, indistinguishable from something Roya
       said. Counted by the timestamps, because only a real message has one. */
    expect(within(log).queryAllByRole("time")).toHaveLength(before);
  });

  it("adds a message that arrives on the stream, once", async () => {
    MESSAGES = [message({ id: "m-1", seq: 1, body: "اولین" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText("اولین");
    await waitFor(() => expect(emit).not.toBeNull());

    const arriving = message({ id: "m-2", seq: 2, author_id: "u-2", body: "دومین" });
    emit!({ type: "message", message: arriving });
    await waitFor(() => expect(within(log).getByText("دومین")).toBeInTheDocument());

    /* the SAME message again — the stream and a catch-up read overlap all
       the time, and a room that showed it twice would be unreadable */
    emit!({ type: "message", message: arriving });
    await waitFor(() => expect(within(log).getAllByText("دومین")).toHaveLength(1));
  });

  it("ignores an event for a room the reader is not standing in", async () => {
    MESSAGES = [message({ id: "m-1", seq: 1, body: "اینجا" })];
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const log = await screen.findByRole("log", { name: "پیام‌ها" });
    await within(log).findByText("اینجا");
    await waitFor(() => expect(emit).not.toBeNull());

    emit!({ type: "message", message: message({ id: "x", seq: 5, channel_id: "c-OTHER", body: "جای دیگر" }) });
    await waitFor(() => expect(within(log).getByText("اینجا")).toBeInTheDocument());
    expect(within(log).queryByText("جای دیگر")).toBeNull();
  });
});

describe("the composer", () => {
  it("sends on Enter and offers agents as well as colleagues after @", async () => {
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const box = await screen.findByPlaceholderText(/پیام بنویسید/);
    /* the composer is DISABLED until a room is selected, and typing into a
       disabled box does nothing at all — silently, which is what made the
       first version of this test fail against working code */
    await waitFor(() => expect(box).not.toBeDisabled());

    await userEvent.type(box, "@ro");
    /* an AGENT in the picker — naming one is the whole authorization for it
       to answer, so it must be as easy to type as a person's name */
    expect(await screen.findByText("@roya")).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "@ma");
    expect(await screen.findByText("@maryam")).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "سلام{Enter}");
    await waitFor(() => expect(posted).toEqual(["سلام"]));
  });

  it("puts the tools left and the send right — PHYSICALLY — and the send has no fill", async () => {
    /*
     * The directive named corners: "on the right side, lowest part, an enter
     * icon without fill for sending, and on the other side, left, there must
     * be a @ option … and a mic … and an emoji dropdown."
     *
     * The person was LOOKING AT THE RTL PAGE when they said that, so the row
     * is pinned `dir="ltr"` and the logical properties are deliberately not
     * used. A logical version would look right in English and move both
     * clusters to the other side of the box they had just pointed at — which
     * is exactly why this asserts the attribute and the DOM ORDER rather than
     * a class: under dir="ltr", first is left and last is right.
     */
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const send = await screen.findByRole("button", { name: "ارسال" });
    const row = send.parentElement!;
    expect(row).toHaveAttribute("dir", "ltr");

    const mention = within(row).getByRole("button", { name: "صدا زدن کسی" });
    // eslint-disable-next-line no-bitwise
    expect(mention.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    /* «an enter icon WITHOUT fill»: an outline glyph, not a filled pill. In a
       room the send is pressed by Enter almost every time, so a solid accent
       button would be the loudest thing on a screen whose subject is the
       conversation. */
    expect(send.className).toContain("border");
    expect(send.className).not.toContain("bg-accent");

    /* the other two the directive named, on the left with the @ */
    expect(within(row).getByRole("button", { name: "گفتن با میکروفون" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "ایموجی" })).toBeInTheDocument();
  });

  it("the @ BUTTON opens the picker, not just a character in the box", async () => {
    /*
     * The control the directive named ("an @ option that can add agents to
     * the chat"). Pressing it used to insert the character and nothing else,
     * because the insert path does not run the change handler that decides
     * whether a picker is open — so the list appeared only after the next
     * keystroke. A dedicated button that does nothing visible when pressed
     * teaches, on its first press, that the feature does not work.
     */
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const box = await screen.findByPlaceholderText(/پیام بنویسید/);
    await waitFor(() => expect(box).not.toBeDisabled());

    await userEvent.click(screen.getByRole("button", { name: "صدا زدن کسی" }));
    /* agents FIRST, because naming one is the whole authorization for it to
       answer — and a colleague too, so the list is not an agent menu */
    expect(await screen.findByText("@roya")).toBeInTheDocument();
    expect(screen.getByText("@maryam")).toBeInTheDocument();
    expect(box).toHaveValue("@");
  });

  it("never offers a colleague who has no handle", async () => {
    render(<Chat isAdmin meId="u-1" people={PEOPLE} />);
    const box = await screen.findByPlaceholderText(/پیام بنویسید/);
    await waitFor(() => expect(box).not.toBeDisabled());
    /* رضا has username null. A mention of a handle nobody holds resolves to
       nobody, so an entry here would be a control that silently does
       nothing — and the picker is where somebody learns what is mentionable. */
    await userEvent.type(box, "@r");
    await waitFor(() => expect(screen.queryByText("@roya")).toBeInTheDocument());
    expect(screen.queryByText("رضا")).toBeNull();
  });
});
