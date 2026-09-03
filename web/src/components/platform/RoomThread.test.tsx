import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomEvent } from "@/api/types";

/**
 * THE ROOM, and the three things that are only true if it was built right.
 *
 * ── 1. Each agent's turn renders under THAT agent's name and face ────────
 *
 * The whole point of the surface is several voices, two of them machines
 * answering each other. A version that labelled every agent turn identically
 * — "assistant", or the first agent in the roster — would satisfy any
 * single-agent assertion perfectly. So the fixture is a real hand-off (رؤیا
 * answers, names @ava, آوا answers next) and the assertion is that the two
 * rows carry DIFFERENT names, each beside its own row's text. The control is
 * the half that makes it mean anything.
 *
 * ── 2. `turn_failed` produces NO message row ─────────────────────────────
 *
 * The platform's standing rule, and it is a NEGATIVE: a tidy failure bubble
 * reads as polish, which is the direction code drifts. Counting rows before
 * and after is the only way to catch a version that renders the failure as a
 * turn — such a version looks better on screen and is a lie in the record.
 *
 * ── 3. `bounded` reads as a boundary, not as a failure ───────────────────
 *
 * The ceiling is a deliberate stop, and the sentence tells the person that
 * speaking again continues the work. A version that rendered it in the
 * failure tone would teach people to read a working mechanism as an error.
 */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => "/agents/room-1",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/**
 * The trail's provider — the page's ancestor in the real tree, RECORDED
 * rather than stubbed to a no-op.
 *
 * The room's title is not drawn inside the page (the platform stopped drawing
 * page titles on 2026-09-02); the breadcrumb carries it. So this is the only
 * place the title is observable, and without it the rename test could assert
 * the patch and the closing input and still pass against an OPTIMISTIC screen
 * — which is the claim that test makes.
 */
const crumbs: (string | null | undefined)[] = [];
vi.mock("@/components/platform/CrumbTitle", () => ({
  useCrumbTitle: (title: string | null | undefined) => { crumbs.push(title); },
}));

/*
 * PRODUCER-SHAPED fixtures (core/src/api/rooms.ts): `author_kind` pinned by
 * the writing role, both author columns present with exactly one set, the
 * join's five author_* columns, `turn` assigned by the insert. Hand-writing a
 * tidier shape here is the thing rule 10 exists to refuse.
 */
const ROYA = { id: "ag-roya", handle: "roya", name: "رؤیا", icon: "sparkles", color: "violet" };
const AVA = { id: "ag-ava", handle: "ava", name: "آوا", icon: "chart", color: "blue" };

const ROOM = {
  id: "room-1",
  title: "پورت به فلاتر",
  subject_kind: null,
  subject_id: null,
  archived: false,
  created_at: "2026-09-03T08:00:00.000Z",
  updated_at: "2026-09-03T08:00:00.000Z",
  last_message_at: "2026-09-03T08:00:00.000Z",
  agents: [ROYA, AVA],
};

function agentTurn(id: string, agent: typeof ROYA, body: string, turn: number) {
  return {
    id,
    author_kind: "agent" as const,
    author_user_id: null,
    author_agent_id: agent.id,
    author_name: agent.name,
    author_name_en: null,
    author_handle: agent.handle,
    author_icon: agent.icon,
    author_color: agent.color,
    body,
    turn,
    reply_to_id: null,
    created_at: "2026-09-03T08:01:00.000Z",
  };
}

/** every patch the screen sent, in order — the argument is the assertion */
const patches: { id: string; patch: Record<string, unknown> }[] = [];

const ASKED = {
  id: "m-0",
  author_kind: "user" as const,
  author_user_id: "u-1",
  author_agent_id: null,
  author_name: "امیررضا",
  author_name_en: "Amirreza",
  author_handle: null,
  author_icon: null,
  author_color: null,
  body: "به فلاتر می‌رویم، برنامهٔ پورت را دوباره بچین.",
  turn: 0,
  reply_to_id: null,
  created_at: "2026-09-03T08:00:30.000Z",
};

/** What the stream will emit, set per test. */
let script: RoomEvent[] = [];

vi.mock("@/api/client", () => ({
  api: {
    room: () => Promise.resolve({ room: ROOM, messages: [] }),
    me: () => Promise.resolve({ id: "u-1", display_name: "امیررضا", role: "owner" }),
    /* the CATALOGUE the names resolve through — system level, so the shipped
       copy wins over the stored spelling (seededCopy's rule) */
    agents: () => Promise.resolve([
      { ...ROYA, level: "system", description: "", tools: [] },
      { ...AVA, level: "system", description: "", tools: [] },
    ]),
    // eslint-disable-next-line require-yield
    sayInRoom: async function* () {
      for (const event of script) yield event;
    },
    /* answers the ROOM AS IT NOW STANDS, which is what save-then-adopt
       consumes — a mock echoing the request would let an optimistic screen
       pass, since the two are indistinguishable when the server agrees */
    updateRoom: (id: string, patch: Record<string, unknown>) => {
      patches.push({ id, patch });
      return Promise.resolve({
        ...ROOM,
        title: typeof patch.title === "string" ? `${patch.title} ` : ROOM.title,
        archived: patch.archived === true,
      });
    },
  },
}));

import { RoomThread } from "./RoomThread";

async function say(text: string) {
  const user = userEvent.setup();
  const box = await screen.findByRole("textbox");
  await user.type(box, text);
  await user.click(screen.getByRole("button", { name: /فرستادن/ }));
}

/** every rendered turn, whatever its author — the row count these tests judge */
function turns(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-author-kind]"));
}

/** whose row this is, read from the author element and nowhere else */
function authorOf(row: HTMLElement): string | undefined {
  return row.querySelector("[data-author]")?.textContent ?? undefined;
}

beforeEach(() => {
  script = [];
  patches.length = 0;
  crumbs.length = 0;
});

describe("a room renders several voices", () => {
  it("puts each agent's turn under that agent's own name, and the two differ", async () => {
    script = [
      { type: "message", message: ASKED },
      { type: "working", agent: ROYA },
      { type: "message", message: agentTurn("m-1", ROYA, "دارم ویوهای ری‌اکت را به ویجت‌های فلاتر نگاشت می‌کنم. لایهٔ وضعیت را می‌سپارم به @ava", 1) },
      { type: "working", agent: AVA },
      { type: "message", message: agentTurn("m-2", AVA, "لایهٔ وضعیت را نگاه کردم؛ سه جای وابسته به کانتکست هست.", 2) },
      { type: "done", failed: false },
    ];
    render(<RoomThread id="room-1" />);
    await say("سلام");

    await waitFor(() => expect(turns()).toHaveLength(3));
    const [asked, first, second] = turns();

    // the person's own turn, under the person's name
    expect(asked!).toHaveAttribute("data-author-kind", "user");
    expect(authorOf(asked!)).toBe("امیررضا");

    // ── THE CONTROL ──────────────────────────────────────────────────────
    // Both agent rows exist and are labelled DIFFERENTLY. A component that
    // labelled every agent turn with one name — the roster's first, or a
    // generic "assistant" — passes every positive assertion below and fails
    // exactly here, which is the only question this test can answer NO to.
    //
    // It reads the row's AUTHOR element rather than looking for the name
    // anywhere in the row: رؤیا's body contains an @ava chip carrying آوا's
    // name, so a whole-row search cannot tell "آوا spoke" from "رؤیا named
    // آوا" — the two facts this surface exists to keep apart.
    expect(authorOf(first!)).toBe("رؤیا");
    expect(authorOf(second!)).toBe("آوا");
    expect(authorOf(first!)).not.toBe(authorOf(second!));

    // and each name sits with ITS OWN body, not merely somewhere on the page
    expect(within(first!).getByText(/ویجت‌های فلاتر/)).toBeInTheDocument();
    expect(within(second!).getByText(/سه جای وابسته/)).toBeInTheDocument();

    // the hand-off is a chip naming the colleague it addressed
    expect(first!.querySelector('[data-mention="ava"]')).not.toBeNull();
  });

  it("draws no chip for a handle nobody invited", async () => {
    /* the mirror of the assertion above: `@finance` reaches nobody, so a chip
       would draw a hand-off that never happened */
    script = [
      { type: "message", message: ASKED },
      { type: "message", message: agentTurn("m-1", ROYA, "این را می‌سپارم به @finance", 1) },
      { type: "done", failed: false },
    ];
    render(<RoomThread id="room-1" />);
    await say("سلام");

    await waitFor(() => expect(turns()).toHaveLength(2));
    expect(document.querySelector("[data-mention]")).toBeNull();
    expect(screen.getByText(/@finance/)).toBeInTheDocument();
  });
});

describe("the endings that are not messages", () => {
  it("writes NO row for a failed turn, and names it as an annotation", async () => {
    script = [
      { type: "message", message: ASKED },
      { type: "working", agent: ROYA },
      { type: "turn_failed", agent: ROYA, code: "no_model" },
      { type: "done", failed: true },
    ];
    render(<RoomThread id="room-1" />);
    await say("سلام");

    // the failure is SAID — silence with no explanation is its own lie
    await screen.findByText(/رؤیا این نوبت چیزی نگفت/);

    // …and it is not a turn. ONE row: the question, standing unanswered.
    expect(turns()).toHaveLength(1);
    expect(turns()[0]!).toHaveAttribute("data-author-kind", "user");
  });

  it("reads `bounded` as a boundary with a way forward, not as a failure", async () => {
    script = [
      { type: "message", message: ASKED },
      { type: "message", message: agentTurn("m-1", ROYA, "یک دور رفتیم.", 1) },
      { type: "bounded", limit: 8 },
      { type: "done", failed: false },
    ];
    render(<RoomThread id="room-1" />);
    await say("سلام");

    const notice = await screen.findByText(/تا جایی که خودشان می‌توانستند پیش رفتند/);
    // the sentence tells the person what continues the work
    expect(notice.textContent).toMatch(/برای ادامه چیزی بگویید/);
    // and it is NOT dressed as the failure the annotation above wears
    expect(notice.className).not.toMatch(/text-warning/);
    // the turns that did happen are still the record
    expect(turns()).toHaveLength(2);
  });

  it("reports a stream that ended without `done` as a dropped connection", async () => {
    /*
     * `done` is ALWAYS the last event by contract, so its absence is a
     * transport death. The hub walked the SUCCESS path on exactly this for a
     * week (a proxy timeout closing the body cleanly), which is why the check
     * is here from the first day rather than after the first report.
     */
    script = [
      { type: "message", message: ASKED },
      { type: "message", message: agentTurn("m-1", ROYA, "شروع کردم…", 1) },
    ];
    render(<RoomThread id="room-1" />);
    await say("سلام");

    await screen.findByText(/ارتباط پیش از پایان گفت‌وگو قطع شد/);
    // what was written stays written — the row is the record
    expect(turns()).toHaveLength(2);
  });
});

describe("renaming and archiving", () => {
  it("sends the typed title and ADOPTS the server's answer", async () => {
    /*
     * SAVE-THEN-ADOPT, and this is the assertion that can tell it from an
     * optimistic screen.
     *
     * The mock answers with a title that DIFFERS from what was typed (a
     * trailing space — stand-in for any normalisation core applies). A screen
     * that set its own state from the input passes the patch assertion and
     * the closing-input assertion identically; only the value that reaches
     * the crumb separates the two. Without a differing answer the whole test
     * would be green against both, which is the vacuum this repo keeps
     * finding: a fixture where the right and wrong versions agree.
     */
    const user = userEvent.setup();
    render(<RoomThread id="room-1" />);

    await user.click(await screen.findByRole("button", { name: "گزینه‌های این اتاق" }));
    await user.click(await screen.findByRole("menuitem", { name: /تغییر نام/ }));

    const box = await screen.findByRole("textbox", { name: "موضوع اتاق" });
    await user.clear(box);
    await user.type(box, "برنامهٔ انتشار");
    await user.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ id: "room-1", patch: { title: "برنامهٔ انتشار" } });
    // the inline composer closes only once the write came back
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "موضوع اتاق" })).toBeNull());

    // THE ADOPT: the crumb carries the SERVER's spelling, not the typed one
    await waitFor(() => expect(crumbs.at(-1)).toBe("برنامهٔ انتشار "));
    expect(crumbs).not.toContain("برنامهٔ انتشار");
  });

  it("archives, and the composer stops offering to speak into a filed room", async () => {
    const user = userEvent.setup();
    render(<RoomThread id="room-1" />);

    // the control is live before: the assertion after it is about the CHANGE
    expect(await screen.findByRole("button", { name: /فرستادن/ })).toBeDisabled();
    const box = await screen.findByRole("textbox", { name: "پیام به اتاق" });
    expect(box).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "گزینه‌های این اتاق" }));
    await user.click(await screen.findByRole("menuitem", { name: /بایگانی اتاق/ }));

    await waitFor(() => expect(patches).toEqual([{ id: "room-1", patch: { archived: true } }]));
    /* core REFUSES a message in an archived room (`room_archived`), so a
       composer that still accepted one would be a control promising a write
       the server will not take */
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "پیام به اتاق" })).toBeDisabled());
    // and the menu now offers the way back — archiving is not a one-way door
    await user.click(screen.getByRole("button", { name: "گزینه‌های این اتاق" }));
    expect(await screen.findByRole("menuitem", { name: /بازگرداندن از بایگانی/ })).toBeInTheDocument();
  });
});
