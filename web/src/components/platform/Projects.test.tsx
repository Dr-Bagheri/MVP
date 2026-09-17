import { personFixture } from "@/test/fixtures";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TAB_TRACK } from "./sectionTabs";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgPersonRecord, ProjectRecord, TaskCardRecord, TaskColumnRecord } from "@/api/types";

/**
 * PROJECTS (0181) — the contract facts, and every one of them is a place the
 * screen could look right while saying something false.
 *
 *  1. PROGRESS IS A DASH when there is no work. A project with no tasks has
 *     no completion, and «۰ از ۰» is a claim about the WORK where the truth
 *     is a claim about the board being empty. (Verified red by rendering the
 *     numbers unconditionally: the empty project reported «۰ از ۰».)
 *  2. «پروژه‌های من» DOES NOTHING UNTIL THE IDENTITY LANDS — and does nothing by
 *     showing nothing, never by showing everything. `meId === null` is both
 *     "still loading" and "nobody"; a filter that falls back to the whole
 *     list on either is a screen quietly answering a different question.
 *  3. CREATE writes the wire's shape, and the CREATOR is not in `member_ids`:
 *     the server adds them unconditionally, so sending them too is a second
 *     opinion about a fact the server owns.
 *  4. The detail's work list is the project's OWN category, never the board.
 */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
  /* every other prop rides through to the anchor: the kanban card is a Link
     that also carries the hand's pointer handler, its data-card and
     draggable={false} (2026-09-05), and a stub that dropped them would test
     a card nobody can pick up */
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}));

/* jsdom ships no PointerEvent — the same shim TaskBoard.test carries */
if (typeof window.PointerEvent === "undefined") {
  class JsdomPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  (window as unknown as { PointerEvent: typeof JsdomPointerEvent }).PointerEvent = JsdomPointerEvent;
}

const pushSpy = vi.fn();
const created: Record<string, unknown>[] = [];
const deleted: string[] = [];
let createRefused = false;
const patches: { id: string; body: Record<string, unknown> }[] = [];
/** every PATCH the project panel sends — the rail is where a project is edited now */
const projectPatches: { id: string; body: Record<string, unknown> }[] = [];

/* THE READERS (db/0227). ADMIN made every fixture project (`created_by:
   "u-1"`), so the edits the earlier cases assert are theirs to draw; a
   second admin's project and the owner's seat get their own cases below. */
const ADMIN = { meId: "u-1", isAdmin: true, isOwner: false };
const MEMBER = { meId: "u-1", isAdmin: false, isOwner: false };

function project(over: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: "p-1", name: "بازطراحی سایت", summary: "", tone: "blue", icon: null,
    archived_at: null, created_by: "u-1", created_at: "2026-09-01T08:00:00.000Z",
    topic_id: "t-1", member_ids: [], task_total: 0, task_done: 0,
    /* 0208's five, at the columns' own defaults — a fixture that omitted them
       would be a project shape the server never sends */
    stage: "active", priority: "medium", lead_id: null,
    starts_on: null, due_on: null, channel_id: null,
    /* 0226 — no folder is the ordinary state */
    folder_id: null,
    ...over,
  };
}

function card(over: Partial<TaskCardRecord>): TaskCardRecord {
  return {
    id: "k-1", column_id: "c-1", topic_id: "t-1", call_id: null, call_title: null,
    meeting_id: null, meeting_title: null,
    title: "کارت", priority: "medium", labels: [], due_at: null, done: false,
    position: 1, archived: false, created_by: "u-1", assignee_ids: [],
    /* 0227 — no room is the ordinary state */
    channel_id: null, channel_name: null,
    label_ids: [], checklist_done: 0, checklist_total: 0, comment_count: 0,
    created_at: "2026-09-01T08:00:00.000Z", recurrence_id: null,
    ...over,
  };
}

const PEOPLE: OrgPersonRecord[] = [
  personFixture({ id: "u-1", display_name: "سینا", display_name_en: null, role: "owner", username: "u-1" }),
  personFixture({ id: "u-2", display_name: "رؤیا", display_name_en: null, role: "member", username: "u-2" }),
];

let LIST: ProjectRecord[] = [];
/* the FOLDERS (0226) — the strip's rows — and every write the strip sends */
let FOLDERS: Array<{ id: string; name: string }> = [];
const folderWrites: Array<[string, string]> = [];
let ONE: ProjectRecord = project({});
let TASKS: TaskCardRecord[] = [];
/* the BOARD'S columns, mutable: the kanban reads them from the board's own
   endpoint (2026-09-05, "it will have the same columns"), so a fixture that
   could only be one column could not test where a project lands. */
let COLUMNS: TaskColumnRecord[] = [
  { id: "c-1", name: "انجام‌شده", tone: "green", position: 1 },
];

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  api: {
    projects: async (opts?: { archived?: boolean }) => (opts?.archived === true ? [] : LIST),
    project: async () => ONE,
    createProject: async (input: Record<string, unknown>) => {
      if (createRefused) throw new Error("refused");
      created.push(input);
      return project({ id: "p-new", name: String(input.name) });
    },
    updateProject: async (id: string, patch: Record<string, unknown>) => {
      projectPatches.push({ id, body: patch });
      return project({ ...ONE, id, ...patch });
    },
    setProjectMember: vi.fn(async () => undefined),
    deleteProject: async (id: string) => { deleted.push(id); },
    /* the project folders (0226): their own read, and the strip's two writes */
    projectFolders: async () => FOLDERS,
    createProjectFolder: async (name: string) => { folderWrites.push(["create", name]); return { id: "f-new", name }; },
    updateProjectFolder: async (id: string, patch: { name?: string; archived?: boolean }) => {
      folderWrites.push(["update", `${id}:${patch.name ?? (patch.archived === true ? "archived" : "")}`]);
    },
    orgPeople: async () => PEOPLE,
    me: async () => ({ id: "u-1" }),
    /* the detail reads BOTH of these to draw the order dialog and the
       workload panel. Without them the component throws inside a promise and
       the failure arrives wearing an assertion's costume — the exact shape
       this suite's sibling minted a rule about hours ago. */
    taskLabels: async () => [],
    projectWorkload: async () => [],
    taskBoard: async () => ({ columns: COLUMNS, topics: [], tasks: TASKS }),
    /* a project dropped on a column moves its open cards, one write each */
    updateTask: async (id: string, body: Record<string, unknown>) => {
      patches.push({ id, body });
      return { ...card({ id }), ...body };
    },
  },
}));

import { Projects } from "./Projects";
import { ProjectDetail } from "./ProjectDetail";
import { CrumbTitleProvider } from "./CrumbTitle";

/* the REAL provider rather than a mocked hook: the page feeds its crumb
   title through this context, and a stub would be faking the composition's
   output instead of the rule. It also keeps the missing-floor throw honest
   — a detail page rendered outside a provider SHOULD fail. */
const detail = (id: string, meId: string | null) => (
  <CrumbTitleProvider><ProjectDetail id={id} reader={{ meId, isAdmin: true, isOwner: false }} onClose={() => undefined} /></CrumbTitleProvider>
);

/** the kanban column's own box — the element carrying its project cards */
async function columnOf(name: string): Promise<HTMLElement> {
  const heading = await screen.findByText(name);
  const section = heading.closest("section");
  if (section === null) throw new Error("no <section> around " + name);
  return section;
}

beforeEach(() => {
  createRefused = false;
  LIST = [];
  TASKS = [];
  COLUMNS = [{ id: "c-1", name: "انجام‌شده", tone: "green", position: 1 }];
  ONE = project({});
  created.length = 0;
  deleted.length = 0;
  FOLDERS = [];
  folderWrites.length = 0;
  patches.length = 0;
  projectPatches.length = 0;
  pushSpy.mockClear();
});

describe("Projects", () => {
  it("renders a DASH for a project with no work, and the count for one with work", async () => {
    LIST = [
      project({ id: "p-a", name: "پروژهٔ خالی", task_total: 0, task_done: 0 }),
      project({ id: "p-b", name: "پروژهٔ جاری", task_total: 5, task_done: 2 }),
    ];
    render(<Projects reader={ADMIN} />);
    await waitFor(() => expect(screen.getByText("پروژهٔ خالی")).toBeInTheDocument());

    /* scoped to each card, so a dash anywhere else on the page cannot make
       this pass — the card is the subject, not the screen */
    const empty = screen.getByText("پروژهٔ خالی").closest("a")!;
    const running = screen.getByText("پروژهٔ جاری").closest("a")!;
    expect(within(empty).getByText("—")).toBeInTheDocument();
    expect(within(empty).queryByText(/۰ از ۰/)).toBeNull();
    expect(within(running).getByText("۲ از ۵")).toBeInTheDocument();
  });

  it("offers the sort as a MENU on the row that reads its answer, never a dropdown", async () => {
    /*
     * User directive, 2026-09-04: "make the sort dropdown become the second
     * sub menu top" — and the user's choice of design «ج» (2026-09-17): the
     * sort is a MENU BUTTON on row one that shows the current field. Asserted
     * on the RENDERED CONTROL rather than on the absence of an import, because
     * the failure this guards is somebody reaching for `<Select>` again —
     * which looks perfectly reasonable in a diff and puts a full-width panel
     * back under the toolbar.
     */
    LIST = [project({ id: "p-a", name: "پروژه" })];
    render(<Projects reader={ADMIN} />);
    await waitFor(() => expect(screen.getByText("پروژه")).toBeInTheDocument());

    /* the current answer is VISIBLE on the row, which is the whole reason a
       menu that reads its value beats a select here */
    const trigger = screen.getByRole("button", { name: /^مرتب‌سازی/ });
    expect(trigger.textContent).toContain("تازه‌ترین");
    /* and the control: no combobox anywhere on the toolbar */
    expect(screen.queryByRole("combobox")).toBeNull();

    await userEvent.click(trigger);
    for (const label of ["تازه‌ترین", "بر اساس نام", "بر اساس پیشرفت"]) {
      expect(await screen.findByRole("menuitemradio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("menuitemradio", { name: "تازه‌ترین" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "بر اساس نام" }));
    expect(screen.getByRole("button", { name: /^مرتب‌سازی/ }).textContent).toContain("بر اساس نام");
  });

  it("offers the way in to an admin and to nobody else", async () => {
    /*
     * 0186: "the admins only can make projects". ABSENT rather than
     * disabled — a greyed button is a promise the product will not keep for
     * this person, and pressing it explains nothing. The wall itself is the
     * policy; this asserts the screen agrees with it.
     *
     * The CONTROL moved into the kanban column on 2026-09-05 and the rule did
     * not, which is why this test follows it rather than being deleted.
     */
    LIST = [project({ id: "p-a", name: "پروژه" })];
    render(<Projects reader={ADMIN} />);
    expect(await screen.findByRole("button", { name: /افزودن پروژه/ })).toBeInTheDocument();

    cleanup();
    render(<Projects reader={MEMBER} />);
    await waitFor(() => expect(screen.getByText("پروژه")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /افزودن پروژه/ })).toBeNull();
    /* the control: the page still rendered, so "no button" is not "no page".
       The second row's chip carries a count beside its label, so the name is
       matched loosely — an exact string here would break on the number. */
    expect(screen.getByRole("button", { name: /همه پروژه‌ها/ })).toBeInTheDocument();
  });

  it("a project dragged to a column asks, then moves ONLY its open cards there", async () => {
    /*
     * The kanban's hand (user, 2026-09-05: "add it for the projects kanban as
     * well"). A project's column is counted off its tasks, so the drop means
     * "its unfinished work is now at this stage": the open card moves, the
     * done card stays, and nothing moves before the person confirms the
     * count. jsdom has no layout — `elementFromPoint` names the target column.
     */
    COLUMNS = [
      { id: "c-1", name: "برای انجام", tone: "grey", position: 1 },
      { id: "c-2", name: "انجام‌شده", tone: "green", position: 2 },
    ];
    LIST = [project({ id: "p-a", name: "پروژهٔ جاری", topic_id: "t-1", task_total: 2, task_done: 1 })];
    TASKS = [
      card({ id: "k-open", column_id: "c-1", topic_id: "t-1", done: false }),
      card({ id: "k-done", column_id: "c-1", topic_id: "t-1", done: true }),
    ];
    render(<Projects reader={ADMIN} />);
    const cardEl = (await screen.findByText("پروژهٔ جاری")).closest("[data-card]") as HTMLElement;
    const target = await columnOf("انجام‌شده");

    const original = document.elementFromPoint;
    document.elementFromPoint = () => target;
    try {
      fireEvent.pointerDown(cardEl, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" });
      fireEvent.pointerMove(cardEl, { clientX: 60, clientY: 12, pointerId: 1, pointerType: "mouse" });
      fireEvent.pointerMove(cardEl, { clientX: 320, clientY: 14, pointerId: 1, pointerType: "mouse" });
      fireEvent.pointerUp(cardEl, { clientX: 320, clientY: 14, pointerId: 1, pointerType: "mouse" });
    } finally {
      document.elementFromPoint = original;
    }

    /* it ASKS first, naming the count — one open card, not two */
    const confirm = await screen.findByRole("button", { name: "انتقال" });
    expect(screen.getByText(/۱ کار ناتمام/)).toBeInTheDocument();
    expect(patches).toHaveLength(0);

    await userEvent.click(confirm);
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]!.id).toBe("k-open");
    expect(Object.keys(patches[0]!.body).sort()).toEqual(["column_id", "position"]);
    expect(patches[0]!.body.column_id).toBe("c-2");
  });

  it("«مال من» keeps the projects the reader is on, leads, or MADE — and drops the rest", async () => {
    /* user report, 2026-09-16: "my projects only is not working for admins" —
       an admin who makes projects is on none of them, so membership alone
       emptied the page from their seat. The fixture's four projects are one
       of each: on it, leading it, made it, none of the three. */
    LIST = [
      project({ id: "p-a", name: "پروژهٔ من", created_by: "u-9", member_ids: ["u-1", "u-2"] }),
      project({ id: "p-l", name: "پروژهٔ سرپرستی", created_by: "u-9", lead_id: "u-1", member_ids: ["u-2"] }),
      project({ id: "p-c", name: "پروژهٔ ساخته", created_by: "u-1", member_ids: ["u-2"] }),
      project({ id: "p-b", name: "پروژهٔ دیگری", created_by: "u-9", member_ids: ["u-2"] }),
    ];
    render(<Projects reader={ADMIN} />);
    await waitFor(() => expect(screen.getByText("پروژهٔ من")).toBeInTheDocument());
    expect(screen.getByText("پروژهٔ دیگری")).toBeInTheDocument();

    /* «پروژه‌های من» is a CHECK ROW in the «فیلتر» menu (design «ج», 2026-09-17) */
    await userEvent.click(screen.getByRole("button", { name: /^فیلتر/ }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "پروژه‌های من" }));
    await waitFor(() => expect(screen.queryByText("پروژهٔ دیگری")).toBeNull());
    expect(screen.getByText("پروژهٔ من")).toBeInTheDocument();
    expect(screen.getByText("پروژهٔ سرپرستی")).toBeInTheDocument();
    expect(screen.getByText("پروژهٔ ساخته")).toBeInTheDocument();
  });

  it("«مال من» with nothing of mine says WHICH nothing", async () => {
    LIST = [project({ id: "p-b", name: "پروژهٔ دیگری", created_by: "u-9", member_ids: ["u-2"] })];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ دیگری");
    /* «پروژه‌های من» is a CHECK ROW in the «فیلتر» menu (design «ج», 2026-09-17) */
    await userEvent.click(screen.getByRole("button", { name: /^فیلتر/ }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "پروژه‌های من" }));
    await userEvent.click(screen.getByRole("button", { name: "لیست" }));
    expect(await screen.findByText("پروژه‌ای که ساخته‌اید، سرپرست آن هستید یا در آن عضوید، نیست.")).toBeInTheDocument();
  });

  it("«مال من» shows NOTHING while the identity is unknown — never everything", async () => {
    /*
     * The load-bearing case, and the one a passing suite would miss: `meId`
     * is null both while /v1/me is in flight and when nobody is signed in.
     * A filter that treats null as "no filter" answers «همهٔ پروژه‌ها» to a
     * question about ONE person, and it does it for a fraction of a second on
     * every load — long enough to be read, never long enough to be reported.
     */
    LIST = [
      project({ id: "p-a", name: "پروژهٔ من", member_ids: ["u-1"] }),
      project({ id: "p-b", name: "پروژهٔ دیگری", member_ids: ["u-2"] }),
    ];
    render(<Projects reader={{ meId: null, isAdmin: true, isOwner: false }} />);
    await waitFor(() => expect(screen.getByText("پروژهٔ من")).toBeInTheDocument());

    /* «پروژه‌های من» is a CHECK ROW in the «فیلتر» menu (design «ج», 2026-09-17) */
    await userEvent.click(screen.getByRole("button", { name: /^فیلتر/ }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "پروژه‌های من" }));
    /* THE SUBJECT: neither project renders. A filter that treated null as
       "no filter" would show both, which is the defect this test is for. */
    await waitFor(() => expect(screen.queryByText("پروژهٔ من")).toBeNull());
    expect(screen.queryByText("پروژهٔ دیگری")).toBeNull();

    /* the empty-state COPY lives on the views that have one — the kanban's
       nothing is a board with empty columns (2026-09-05), because the way to
       create a project now lives inside a column and a card covering them
       would take it away. So the sentence is checked where it renders. */
    await userEvent.click(screen.getByRole("button", { name: "لیست" }));
    /* it names the FILTER rather than the organisation — "no projects yet"
       here would be a claim about the org */
    expect(await screen.findByText("با این فیلتر پروژه‌ای نیست")).toBeInTheDocument();
  });

  it("creates with the wire's shape, and never sends the creator as a member", async () => {
    render(<Projects reader={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: /افزودن پروژه/ }));

    await userEvent.type(await screen.findByLabelText("نام پروژه"), "بازطراحی");
    await userEvent.type(screen.getByLabelText("توضیح کوتاه"), "صفحهٔ اول");
    /* a colleague ON, the reader's own row is disabled and cannot be */
    await userEvent.click(screen.getByRole("button", { name: /رؤیا/ }));

    await userEvent.click(screen.getByRole("button", { name: /ساخت پروژه/ }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      name: "بازطراحی",
      summary: "صفحهٔ اول",
      tone: "blue",
      icon: "📁",
      member_ids: ["u-2"],
    });
    /* the exact key set: an extra field would be sent faithfully and ignored
       in silence, which is how an invented field ships */
    expect(Object.keys(created[0]!).sort()).toEqual(
      ["icon", "member_ids", "name", "summary", "tone"],
    );
    /* R18: the new project opens as the PANEL over the list — its address is
       the list's, with the project in the query — not a page of its own */
    expect(pushSpy).toHaveBeenCalledWith("/projects?project=p-new");
  });
});

describe("ProjectDetail", () => {
  it("lists only the tasks under THIS project's category", async () => {
    ONE = project({ id: "p-1", name: "بازطراحی سایت", topic_id: "t-1", member_ids: ["u-1"] });
    TASKS = [
      card({ id: "k-1", title: "کارِ پروژه", topic_id: "t-1" }),
      card({ id: "k-2", title: "کارِ پروژهٔ دیگر", topic_id: "t-2" }),
      /* a card with NO category at all — the board's ordinary case, and the
         one an over-eager filter lets through */
      card({ id: "k-3", title: "کارِ بی‌دسته", topic_id: null }),
    ];
    render(detail("p-1", "u-1"));
    await waitFor(() => expect(screen.getByText("کارِ پروژه")).toBeInTheDocument());
    expect(screen.queryByText("کارِ پروژهٔ دیگر")).toBeNull();
    expect(screen.queryByText("کارِ بی‌دسته")).toBeNull();
  });

  it("says a project with no category has no work, rather than showing the whole board", async () => {
    /*
     * `topic_id` is null only if a project's category was archived out from
     * under it — rare, and exactly the input where a filter spelled as "no
     * topic means no filter" would put every card in the organisation under
     * this project's heading.
     *
     * Worth recording: the implementation ALSO carried an explicit
     * `topic_id === null` early return, and deleting it left this test green
     * — the equality is already false for every card when the id is null.
     * So the line was redundant, and it is gone; this test still fails
     * against the mistake it was written for.
     */
    ONE = project({ id: "p-1", topic_id: null });
    TASKS = [card({ id: "k-1", title: "کارِ یک پروژهٔ دیگر", topic_id: "t-9" })];
    render(detail("p-1", "u-1"));
    await waitFor(() =>
      expect(screen.getByText("هنوز کاری زیر این پروژه ثبت نشده است.")).toBeInTheDocument());
    expect(screen.queryByText("کارِ یک پروژهٔ دیگر")).toBeNull();
  });
});

/**
 * THE PANEL IS THE EDITOR NOW (user directive, 2026-09-08: "in projects edit
 * mode it should edit the existing page the same way in tasks edit, not
 * popping up another window — remove the second pop up window").
 *
 * Each of these fails against the shape that shipped yesterday, which is what
 * makes them worth having: yesterday «ویرایش» opened `ProjectDialog` over the
 * panel, the roster opened a third dialog, and the rail was a read-out.
 */
describe("the project is edited in its own panel (2026-09-08)", () => {
  it("«ویرایش» makes the name and the summary writable HERE, and opens no second window", async () => {
    ONE = project({ id: "p-1", name: "بازطراحی سایت", summary: "خلاصه" });
    render(detail("p-1", "u-1"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "بازطراحی سایت" })).toBeInTheDocument());

    /* THE BOX IS INSIDE THE PANEL ITSELF, and that is the whole assertion.
       Counting dialogs was the first draft and it could not fail: a second
       dialog opens in a PORTAL, and Radix marks everything outside the open
       one `aria-hidden`, so the mutation that put yesterday's shape back was
       invisible to `getAllByRole`. Comparing the box's own dialog to the
       panel's is the question that distinguishes them. */
    const panel = screen.getByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /ویرایش/ }));

    expect(screen.getByLabelText("نام پروژه").closest("[role=\"dialog\"]")).toBe(panel);
    expect(screen.getByLabelText("نام پروژه")).toHaveValue("بازطراحی سایت");
    expect(screen.getByLabelText("توضیح کوتاه")).toHaveValue("خلاصه");
    /* and the heading is GONE while the box is open — an input beside the
       title it replaces would be the same name written twice */
    expect(screen.queryByRole("heading", { name: "بازطراحی سایت" })).toBeNull();
  });

  it("saves a renamed project on blur, and says what a rename reaches", async () => {
    ONE = project({ id: "p-1", name: "بازطراحی سایت" });
    render(detail("p-1", "u-1"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "بازطراحی سایت" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /ویرایش/ }));

    const box = screen.getByLabelText("نام پروژه");
    await userEvent.clear(box);
    await userEvent.type(box, "بازطراحی اپ");
    /* the CONSEQUENCE, said while the box is still open and the choice is
       still the person's — R21's allowed kind. The SENTENCE, not a word:
       this line read `getByText(/پوشه/)` until 2026-09-16 and was matching
       the rail's «پوشهٔ برد» label, which is always there — a test that could
       not fail for its reason; the rail's new «پوشه» row made it throw on
       two matches, which is how it was found. */
    expect(screen.getByText("با تغییر نام، دسته‌بندی این پروژه در وظایف هم همین نام را می‌گیرد.")).toBeInTheDocument();

    await userEvent.tab();
    await waitFor(() => expect(projectPatches).toHaveLength(1));
    expect(projectPatches[0]!.body).toEqual({ name: "بازطراحی اپ" });
  });

  it("sends nothing when the name comes back to what it was", async () => {
    ONE = project({ id: "p-1", name: "بازطراحی سایت" });
    render(detail("p-1", "u-1"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "بازطراحی سایت" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /ویرایش/ }));

    const box = screen.getByLabelText("نام پروژه");
    await userEvent.type(box, " ");
    await userEvent.tab();
    /* a trailing space is not a rename. Without this, "saves on blur" is
       satisfied by a version that writes a row every time the caret leaves
       the field — and every one of those is an audit line nobody caused. */
    expect(projectPatches).toHaveLength(0);
  });

  it("writes the stage and the priority from the rail", async () => {
    ONE = project({ id: "p-1", stage: "active", priority: "medium" });
    render(detail("p-1", "u-1"));
    await waitFor(() => expect(screen.getByRole("button", { name: /متوقف/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /متوقف/ }));
    await waitFor(() => expect(projectPatches).toHaveLength(1));
    expect(projectPatches[0]!.body).toEqual({ stage: "paused" });

    await userEvent.click(screen.getByRole("button", { name: /بحرانی/ }));
    await waitFor(() => expect(projectPatches).toHaveLength(2));
    expect(projectPatches[1]!.body).toEqual({ priority: "critical" });
  });

  it("names a lead from the project's OWN people, never the whole organisation", async () => {
    /* رؤیا is in the org and NOT on this project: a lead who is not a member
       is a state the roster on the same rail would contradict a line later */
    ONE = project({ id: "p-1", member_ids: ["u-1"] });
    render(detail("p-1", "u-1"));
    /* the theme's Select is Radix: its trigger carries the CHOSEN label and
       the options live in a portal until it is opened — and a Radix trigger
       opens on POINTERDOWN, which fireEvent.click does not send */
    await userEvent.click(await screen.findByLabelText("سرپرست"));
    await waitFor(() => expect(screen.getByRole("option", { name: "سینا" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "رؤیا" })).toBeNull();
  });

  it("offers «افزودن تسک» and no second door to the board", async () => {
    ONE = project({ id: "p-1", topic_id: "t-1" });
    render(detail("p-1", "u-1"));
    await waitFor(() => expect(screen.getByRole("button", { name: /افزودن تسک/ })).toBeInTheDocument());
    /* «وظایف» stood beside it and went to the same place as the rail's own
       folder row (2026-09-08). Asserted as an ABSENCE because the version
       that still renders it looks perfectly fine on its own. */
    expect(screen.queryByRole("link", { name: "وظایف" })).toBeNull();
  });

  it("shows a MEMBER the readings and none of the controls", async () => {
    ONE = project({ id: "p-1", stage: "paused", member_ids: ["u-1"] });
    render(
      <CrumbTitleProvider>
        <ProjectDetail id="p-1" reader={MEMBER} onClose={() => undefined} />
      </CrumbTitleProvider>,
    );
    await waitFor(() => expect(screen.getByText("متوقف")).toBeInTheDocument());
    /* the DISCRIMINATING half: the stage is on screen and there is no way to
       change it — a test that only asserted the absence would pass against a
       panel that renders nothing at all for a member */
    expect(screen.queryByRole("button", { name: /متوقف/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ویرایش/ })).toBeNull();
    expect(screen.queryByLabelText("سرپرست")).toBeNull();
  });

  it("shows an ADMIN who did not make it the readings too, and the OWNER the controls (db/0227)", async () => {
    ONE = project({ id: "p-1", stage: "paused", created_by: "u-9", member_ids: ["u-1"] });
    render(
      <CrumbTitleProvider>
        <ProjectDetail id="p-1" reader={ADMIN} onClose={() => undefined} />
      </CrumbTitleProvider>,
    );
    await waitFor(() => expect(screen.getByText("متوقف")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /ویرایش/ })).toBeNull();
    expect(screen.queryByLabelText("سرپرست")).toBeNull();
    /* giving work stays an admin's (0186) — the one control that is not an edit of the project */
    expect(screen.getByRole("button", { name: "افزودن تسک" })).toBeInTheDocument();

    cleanup();
    render(
      <CrumbTitleProvider>
        <ProjectDetail id="p-1" reader={{ meId: "u-1", isAdmin: true, isOwner: true }} onClose={() => undefined} />
      </CrumbTitleProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /ویرایش/ })).toBeInTheDocument());
  });
});

describe("the kanban (2026-09-05)", () => {
  /*
   * "In the kanban it will have the same columns."
   *
   * They are the BOARD'S columns, read from the board's own endpoint — and a
   * project has no column of its own, so one is derived by a rule that fits
   * in a sentence: a project sits where its EARLIEST unfinished work sits.
   * Every case below is a different reading of that sentence, and each one
   * fails differently: a rule that took the LAST column would put a project
   * with one card left to do beside the finished ones, and a rule that
   * ignored `done` would never let anything reach the end.
   */
  it("puts a project in the column of its earliest unfinished card", async () => {
    COLUMNS = [
      { id: "c-1", name: "برای انجام", tone: "blue", position: 1 },
      { id: "c-2", name: "در حال انجام", tone: "amber", position: 2 },
      { id: "c-3", name: "انجام‌شده", tone: "green", position: 3 },
    ];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف", topic_id: "top-a" })];
    TASKS = [
      /* the LATER column first in the array, so a version that took the first
         match rather than the earliest column would pass by luck */
      card({ id: "t-2", topic_id: "top-a", column_id: "c-2", done: false }),
      card({ id: "t-1", topic_id: "top-a", column_id: "c-1", done: false }),
    ];
    render(<Projects reader={ADMIN} />);

    const column = await columnOf("برای انجام");
    expect(within(column).getByText("پروژهٔ الف")).toBeInTheDocument();
    expect(within(await columnOf("در حال انجام")).queryByText("پروژهٔ الف")).toBeNull();
  });

  it("moves it to the LAST column once nothing is left undone", async () => {
    COLUMNS = [
      { id: "c-1", name: "برای انجام", tone: "blue", position: 1 },
      { id: "c-3", name: "انجام‌شده", tone: "green", position: 3 },
    ];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف", topic_id: "top-a" })];
    /* the card still SITS in the first column and is done — which is the case
       that separates "where the cards are" from "where the work got to" */
    TASKS = [card({ id: "t-1", topic_id: "top-a", column_id: "c-1", done: true })];
    render(<Projects reader={ADMIN} />);

    expect(within(await columnOf("انجام‌شده")).getByText("پروژهٔ الف")).toBeInTheDocument();
    expect(within(await columnOf("برای انجام")).queryByText("پروژهٔ الف")).toBeNull();
  });

  it("puts a project with NO work in the first column, not the last", async () => {
    /* nothing-to-do and everything-done are different states, and the version
       that treats "no unfinished cards" as "finished" reports a project
       nobody has started as complete */
    COLUMNS = [
      { id: "c-1", name: "برای انجام", tone: "blue", position: 1 },
      { id: "c-3", name: "انجام‌شده", tone: "green", position: 3 },
    ];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف", topic_id: "top-a" })];
    TASKS = [];
    render(<Projects reader={ADMIN} />);

    expect(within(await columnOf("برای انجام")).getByText("پروژهٔ الف")).toBeInTheDocument();
  });
});

describe("the way in: the column's row AND the row's end (2026-09-05, 2026-09-17)", () => {
  it("offers «افزودن پروژه» inside each kanban column AND «پروژهٔ جدید» at the row's end", async () => {
    /*
     * 2026-09-05: "remove the add new project on top and add it like tasks in
     * the column with the name add project, with the same style the add cards
     * has." 2026-09-17: "add a new project and new tasks in the sub-menu top
     * for each page, the related one, at the end of the first sub-menu top" —
     * the later ruling names every page, so the kanban carries BOTH doors:
     * the in-column row where a project will sit, and the row's-end create
     * every page keeps. Both halves asserted; the strip's `+` stays the
     * FOLDERS' («پوشهٔ جدید»), which is what the last line holds.
     */
    COLUMNS = [
      { id: "c-1", name: "برای انجام", tone: "blue", position: 1 },
      { id: "c-2", name: "انجام‌شده", tone: "green", position: 2 },
    ];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف", topic_id: "top-a" })];
    render(<Projects reader={ADMIN} />);

    /* one per column — a project is made where it will sit */
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /افزودن پروژه/ })).toHaveLength(2));
    const top = screen.getByRole("button", { name: /پروژهٔ جدید/ });
    expect(top.className, "the row's-end create is not in the page's one coat").toContain("btn-primary");
    /* in row one's END slot: the same row the views' track stands in */
    const track = screen.getByRole("button", { name: "کانبان" }).parentElement!;
    expect(top.parentElement!.parentElement, "the create is not at the end of row one").toBe(track.parentElement!.parentElement);
    expect(screen.getByRole("button", { name: "پوشهٔ جدید" })).toBeInTheDocument();
  });

  it("keeps the top button on the views that HAVE no column, and it opens the project dialog", async () => {
    /* the control, and the reason the rule is written down: list, calendar
       and archive have nowhere to put an in-column row, so they keep the
       button. A version that removed it everywhere leaves an admin unable to
       create a project from three of the four views. */
    COLUMNS = [{ id: "c-1", name: "برای انجام", tone: "blue", position: 1 }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ الف");

    await userEvent.click(screen.getByRole("button", { name: "لیست" }));
    const button = await screen.findByRole("button", { name: /پروژهٔ جدید/ });
    expect(button.className).toContain("btn-primary");
    expect(screen.queryByRole("button", { name: /افزودن پروژه/ })).toBeNull();
    /* the WHOLE dialog — a project is people and a tone as well as a name */
    await userEvent.click(button);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("نام پروژه")).toBeInTheDocument();
  });

  it("shows a MEMBER neither control", async () => {
    COLUMNS = [{ id: "c-1", name: "برای انجام", tone: "blue", position: 1 }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects reader={MEMBER} />);
    await screen.findByText("پروژهٔ الف");

    expect(screen.queryByRole("button", { name: /افزودن پروژه/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /پروژهٔ جدید/ })).toBeNull();
  });
});

describe("nothing the author wrote to themselves", () => {
  it("renders no comment syntax as text, on the list or the detail", async () => {
    /* the sibling of TaskDetail's check, and the reason it is here too: the
       leak that shipped was introduced by the same edit that restructured
       this page, so both panels carry the assertion rather than the one that
       happened to be caught. */
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ الف");
    expect(document.body.textContent ?? "").not.toContain("/*");

    cleanup();
    ONE = project({ id: "p-a", name: "پروژهٔ الف" });
    render(detail("p-a", "u-1"));
    /* the HEADING, not the text: the name appears twice on the detail — as
       the title and as the rail's board-folder link — and `findByText` threw
       on the arity rather than telling me anything about comments. The first
       version of this line read as a leak and was my own query. */
    await screen.findByRole("heading", { name: "پروژهٔ الف" });
    const text = document.body.textContent ?? "";
    for (const fragment of ["/*", "*/", "px, measured"]) {
      expect(text).not.toContain(fragment);
    }
  });
});

describe("a refused write keeps the dialog (2026-09-06)", () => {
  /*
   * THE ASSERTION MOVED OUT OF THE DIALOG on 2026-09-08, and the FEATURE did
   * not. What this test is about is the draft surviving a refusal — the old
   * code closed the dialog and lost the name, the summary, the tone and the
   * roster. That is unchanged and is still checked below.
   *
   * What changed is which element says so. The sentence used to be a line
   * inside this dialog; it is now the platform's toast, which rises in the
   * middle of the screen — OVER the dialog rather than inside it, so it is
   * still on top of the draft it refused. `within(dialog)` would now be
   * asserting where the message is mounted rather than whether the person
   * is told, so it asks the screen instead.
   */
  it("says so over the draft it refused, and leaves the draft to be sent again", async () => {
    createRefused = true;
    render(<Projects reader={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: /افزودن پروژه/ }));
    await userEvent.type(await screen.findByLabelText("نام پروژه"), "بازطراحی");
    await userEvent.click(screen.getByRole("button", { name: /ساخت پروژه/ }));

    const dialog = await screen.findByRole("dialog");
    expect((await screen.findByRole("alert")).textContent).toBe("ذخیره نشد — دوباره تلاش کنید.");
    /* the old code CLOSED the dialog on refusal — name, summary, tone and
       roster gone, with a line at the top of a page nobody was reading */
    expect(within(dialog).getByLabelText("نام پروژه")).toHaveValue("بازطراحی");
    expect(within(dialog).getByRole("button", { name: /ساخت پروژه/ })).not.toBeDisabled();
  });
});

describe("a project card carries its own delete (2026-09-15)", () => {
  /*
   * User directive: "add the small delete icon on the tasks cards and
   * projects cards". The same control the task board's card wears
   * (BoardCardDelete, R17's one module), on every view that shows a project
   * — and for an ADMIN only, because deleting a project is (0191); a member
   * is offered nothing rather than a control the server would refuse.
   */
  it("shows an admin the trash on the kanban card and on the list row, and a member neither", async () => {
    COLUMNS = [{ id: "c-1", name: "برای انجام", tone: "blue", position: 1 }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ الف");
    const cardEl = screen.getByText("پروژهٔ الف").closest("a") as HTMLElement;
    expect(within(cardEl).getByRole("button", { name: "حذف" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "لیست" }));
    const row = (await screen.findByText("پروژهٔ الف")).closest("a") as HTMLElement;
    expect(within(row).getByRole("button", { name: "حذف" })).toBeInTheDocument();
    /* and the row IS a row: `.tile` is a column unless it says `tile-row`,
       and this one rendered as a seven-line stack on production (2026-09-15) */
    expect(row.className.split(/\s+/)).toContain("tile-row");

    cleanup();
    render(<Projects reader={MEMBER} />);
    await screen.findByText("پروژهٔ الف");
    expect(screen.queryByRole("button", { name: "حذف" })).toBeNull();
  });

  it("an admin sees the trash on the project they MADE and not on another admin's; the owner sees both (db/0227)", async () => {
    COLUMNS = [{ id: "c-1", name: "برای انجام", tone: "blue", position: 1 }];
    LIST = [
      project({ id: "p-a", name: "پروژهٔ الف", created_by: "u-1" }),
      project({ id: "p-b", name: "پروژهٔ ب", created_by: "u-9" }),
    ];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ ب");
    const mine = screen.getByText("پروژهٔ الف").closest("a") as HTMLElement;
    const theirs = screen.getByText("پروژهٔ ب").closest("a") as HTMLElement;
    expect(within(mine).getByRole("button", { name: "حذف" })).toBeInTheDocument();
    expect(within(theirs).queryByRole("button", { name: "حذف" })).toBeNull();

    cleanup();
    render(<Projects reader={{ meId: "u-1", isAdmin: true, isOwner: true }} />);
    await screen.findByText("پروژهٔ ب");
    expect(within(screen.getByText("پروژهٔ ب").closest("a") as HTMLElement).getByRole("button", { name: "حذف" })).toBeInTheDocument();
  });

  it("asks in the platform's dialog — a no deletes nothing, a yes deletes exactly that project", async () => {
    COLUMNS = [{ id: "c-1", name: "برای انجام", tone: "blue", position: 1 }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ الف");

    await userEvent.click(screen.getByRole("button", { name: "حذف" }));
    const dialog = (await screen.findByText("حذف پروژه؟"))
      .closest("[role='alertdialog'], [role='dialog']") as HTMLElement;
    /* the body names what STAYS — the folder and the room — because that is
       what decides whether the press is safe */
    expect(within(dialog).getByText(/پوشهٔ آن‌ها روی برد می‌ماند/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    await waitFor(() => expect(screen.queryByText("حذف پروژه؟")).toBeNull());
    expect(deleted).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "حذف" }));
    const again = (await screen.findByText("حذف پروژه؟"))
      .closest("[role='alertdialog'], [role='dialog']") as HTMLElement;
    await userEvent.click(within(again).getByRole("button", { name: "حذف" }));
    await waitFor(() => expect(deleted).toEqual(["p-a"]));
  });
});

/**
 * THE PAGE IS THE BOARD'S TWO ROWS (user, 2026-09-16: "my projects and today
 * due must go up in the first sub menu like in the tasks with the same first
 * row style; and after all projects in the second sub menu should be the
 * plus like the tasks for a new folder, with the same style and function,
 * and when created have the three-dot button to edit and delete in it").
 *
 * Row one: the two toggles in the board's own grey rail, beside the views.
 * Row two: the kit's TopicStrip — «همه پروژه‌ها» with its count, a chip per
 * project carrying its OPEN work, a ⋯ for an admin (edit → the panel, delete
 * → the one confirm dialog), and the dashed `+` opening the project dialog.
 * Each case fails against the shape that shipped the morning before, where
 * the two toggles sat on row two's tinted rail and there was no strip.
 */
describe("the projects page is the board's two rows (2026-09-16)", () => {
  it("keeps «پروژه‌های من» and «مهلت امروز» in ROW ONE, as check rows in the «فیلتر» menu whose badge counts them", async () => {
    /* design «ج» (the user's choice, 2026-09-17): the two toggles left the
       rail for the «فیلتر» menu beside the views. The BADGE is the
       load-bearing half — a filter behind a closed menu is invisible, and
       the count is what keeps a narrowed page from reading as the whole
       page. Asserted as identity with the views' own ancestors: the menu
       button stands in the Toolbar the views' segmented track is in. */
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ الف");

    const filters = screen.getByRole("button", { name: /^فیلتر/ });
    const kanban = screen.getByRole("button", { name: "کانبان" });
    expect(kanban.parentElement!.className).toBe(TAB_TRACK);
    expect(filters.parentElement).toBe(kanban.parentElement!.parentElement);
    /* nothing on: no count on the button */
    expect(filters.textContent).not.toMatch(/[0-9۰-۹]/);

    await userEvent.click(filters);
    const mine = await screen.findByRole("menuitemcheckbox", { name: "پروژه‌های من" });
    const today = screen.getByRole("menuitemcheckbox", { name: "مهلت امروز" });
    expect(mine).toHaveAttribute("aria-checked", "false");
    expect(today).toHaveAttribute("aria-checked", "false");
    /* on with a press, and the menu STAYS OPEN so the second filter is the
       same visit; the badge counts the one that is on */
    await userEvent.click(mine);
    expect(screen.getByRole("menuitemcheckbox", { name: "پروژه‌های من" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /^فیلتر/ }).textContent).toContain("۱");
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "مهلت امروز" }));
    expect(screen.getByRole("button", { name: /^فیلتر/ }).textContent).toContain("۲");
    /* off with the next press */
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "پروژه‌های من" }));
    expect(screen.getByRole("button", { name: /^فیلتر/ }).textContent).toContain("۱");
  });

  it("draws ROW TWO as the FOLDERS: «همه» with the project count, a chip per folder with how many projects sit in it, a press filtering to it", async () => {
    /* corrected the same day (user: "the bar in project second sub menu is
       just folder and new folder button, not the new projects") — the chips
       are FOLDERS (0226), and no chip wears a project's name */
    COLUMNS = [{ id: "c-1", name: "برای انجام", tone: "blue", position: 1 }];
    FOLDERS = [{ id: "f-a", name: "مشتریان" }, { id: "f-b", name: "داخلی" }];
    LIST = [
      project({ id: "p-a", name: "پروژهٔ الف", folder_id: "f-a" }),
      project({ id: "p-b", name: "پروژهٔ ب", folder_id: "f-a" }),
      project({ id: "p-c", name: "پروژهٔ پ", folder_id: null }),
    ];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ الف");

    const all = screen.getByRole("button", { name: /^همه پروژه‌ها/ });
    const customers = screen.getByRole("button", { name: /^مشتریان/ });
    const internal = screen.getByRole("button", { name: /^داخلی/ });
    expect(within(all).getByText("۳")).toBeInTheDocument();
    expect(within(customers).getByText("۲")).toBeInTheDocument();
    expect(within(internal).getByText("۰")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^پروژهٔ الف/ })).toBeNull();
    expect(all).toHaveAttribute("aria-pressed", "true");

    /* a press keeps the folder's projects and drops the rest; the chip shows
       it is lit; a second press lifts the filter again */
    await userEvent.click(customers);
    await waitFor(() => expect(screen.queryByText("پروژهٔ پ")).toBeNull());
    expect(screen.getByText("پروژهٔ الف")).toBeInTheDocument();
    expect(customers).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(customers);
    await waitFor(() => expect(screen.getByText("پروژهٔ پ")).toBeInTheDocument());
    expect(all).toHaveAttribute("aria-pressed", "true");
  });

  it("the `+` is a NEW FOLDER — the board's inline box and its write, not the project dialog", async () => {
    FOLDERS = [{ id: "f-a", name: "مشتریان" }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ الف");

    await userEvent.click(screen.getByRole("button", { name: "پوشهٔ جدید" }));
    /* the BOX, not a dialog: a folder is a name */
    expect(screen.queryByRole("dialog")).toBeNull();
    const field = await screen.findByPlaceholderText("نام پوشه…");
    await userEvent.type(field, "فروش{Enter}");
    await waitFor(() => expect(folderWrites).toEqual([["create", "فروش"]]));
    /* the box leaves with the write, and the `+` is back */
    await waitFor(() => expect(screen.queryByPlaceholderText("نام پوشه…")).toBeNull());
    expect(screen.getByRole("button", { name: "پوشهٔ جدید" })).toBeInTheDocument();
  });

  it("a chip's ⋯ renames in the same box and archives — both through the folder route, never the project's delete", async () => {
    FOLDERS = [{ id: "f-a", name: "مشتریان" }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف", folder_id: "f-a" })];
    render(<Projects reader={ADMIN} />);
    await screen.findByText("پروژهٔ الف");

    await userEvent.click(screen.getByRole("button", { name: "گزینه‌ها" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "ویرایش نام موضوع" }));
    const field = await screen.findByPlaceholderText("نام پوشه…");
    expect(field).toHaveValue("مشتریان");
    await userEvent.clear(field);
    await userEvent.type(field, "مشتریان کلیدی{Enter}");
    await waitFor(() => expect(folderWrites).toEqual([["update", "f-a:مشتریان کلیدی"]]));

    await userEvent.click(screen.getByRole("button", { name: "گزینه‌ها" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "حذف موضوع" }));
    await waitFor(() => expect(folderWrites).toEqual([
      ["update", "f-a:مشتریان کلیدی"], ["update", "f-a:archived"],
    ]));
    /* archiving a folder is not deleting what sits in it */
    expect(deleted).toEqual([]);
  });

  it("shows a MEMBER the chips and neither the ⋯ nor the `+`", async () => {
    FOLDERS = [{ id: "f-a", name: "مشتریان" }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف", folder_id: "f-a" })];
    render(<Projects reader={MEMBER} />);
    await screen.findByText("پروژهٔ الف");

    /* the DISCRIMINATING half: the chip is there — a strip that renders
       nothing for a member would pass the two absences below */
    expect(screen.getByRole("button", { name: /^مشتریان/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "گزینه‌ها" })).toBeNull();
    expect(screen.queryByRole("button", { name: "پوشهٔ جدید" })).toBeNull();
  });
});
