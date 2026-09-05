import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  Link: ({ href, children, className }: { href: unknown; children: React.ReactNode; className?: string }) => (
    <a href={typeof href === "string" ? href : "#"} className={className}>{children}</a>
  ),
}));

const pushSpy = vi.fn();
const created: Record<string, unknown>[] = [];
const deleted: string[] = [];

function project(over: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: "p-1", name: "بازطراحی سایت", summary: "", tone: "blue", icon: null,
    archived_at: null, created_by: "u-1", created_at: "2026-09-01T08:00:00.000Z",
    topic_id: "t-1", member_ids: [], task_total: 0, task_done: 0,
    ...over,
  };
}

function card(over: Partial<TaskCardRecord>): TaskCardRecord {
  return {
    id: "k-1", column_id: "c-1", topic_id: "t-1", call_id: null, call_title: null,
    title: "کارت", priority: "medium", labels: [], due_at: null, done: false,
    position: 1, archived: false, created_by: "u-1", assignee_ids: [],
    label_ids: [], checklist_done: 0, checklist_total: 0, comment_count: 0,
    created_at: "2026-09-01T08:00:00.000Z", recurrence_id: null,
    ...over,
  };
}

const PEOPLE: OrgPersonRecord[] = [
  { id: "u-1", display_name: "سینا", display_name_en: null, role: "owner", username: "u-1" },
  { id: "u-2", display_name: "رؤیا", display_name_en: null, role: "member", username: "u-2" },
];

let LIST: ProjectRecord[] = [];
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
      created.push(input);
      return project({ id: "p-new", name: String(input.name) });
    },
    updateProject: async (id: string, patch: Record<string, unknown>) => project({ id, ...patch }),
    setProjectMember: vi.fn(async () => undefined),
    deleteProject: async (id: string) => { deleted.push(id); },
    orgPeople: async () => PEOPLE,
    me: async () => ({ id: "u-1" }),
    /* the detail reads BOTH of these to draw the order dialog and the
       workload panel. Without them the component throws inside a promise and
       the failure arrives wearing an assertion's costume — the exact shape
       this suite's sibling minted a rule about hours ago. */
    taskLabels: async () => [],
    projectWorkload: async () => [],
    taskBoard: async () => ({ columns: COLUMNS, topics: [], tasks: TASKS }),
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
  <CrumbTitleProvider><ProjectDetail id={id} meId={meId} isAdmin onClose={() => undefined} /></CrumbTitleProvider>
);

/** the kanban column's own box — the element carrying its project cards */
async function columnOf(name: string): Promise<HTMLElement> {
  const heading = await screen.findByText(name);
  const section = heading.closest("section");
  if (section === null) throw new Error("no <section> around " + name);
  return section;
}

beforeEach(() => {
  LIST = [];
  TASKS = [];
  COLUMNS = [{ id: "c-1", name: "انجام‌شده", tone: "green", position: 1 }];
  ONE = project({});
  created.length = 0;
  deleted.length = 0;
  pushSpy.mockClear();
});

describe("Projects", () => {
  it("renders a DASH for a project with no work, and the count for one with work", async () => {
    LIST = [
      project({ id: "p-a", name: "پروژهٔ خالی", task_total: 0, task_done: 0 }),
      project({ id: "p-b", name: "پروژهٔ جاری", task_total: 5, task_done: 2 }),
    ];
    render(<Projects isAdmin meId="u-1" />);
    await waitFor(() => expect(screen.getByText("پروژهٔ خالی")).toBeInTheDocument());

    /* scoped to each card, so a dash anywhere else on the page cannot make
       this pass — the card is the subject, not the screen */
    const empty = screen.getByText("پروژهٔ خالی").closest("a")!;
    const running = screen.getByText("پروژهٔ جاری").closest("a")!;
    expect(within(empty).getByText("—")).toBeInTheDocument();
    expect(within(empty).queryByText(/۰ از ۰/)).toBeNull();
    expect(within(running).getByText("۲ از ۵")).toBeInTheDocument();
  });

  it("offers the sort as a SUB-MENU of chips, never a dropdown", async () => {
    /*
     * User directive, 2026-09-04: "make the sort dropdown become the second
     * sub menu top". Asserted on the RENDERED CONTROL rather than on the
     * absence of an import, because the failure this guards is somebody
     * reaching for `<Select>` again — which looks perfectly reasonable in a
     * diff and puts a full-width panel back under a toolbar of chips.
     */
    LIST = [project({ id: "p-a", name: "پروژه" })];
    render(<Projects isAdmin meId="u-1" />);
    await waitFor(() => expect(screen.getByText("پروژه")).toBeInTheDocument());

    for (const label of ["تازه‌ترین", "بر اساس نام", "بر اساس پیشرفت"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    /* the current answer is VISIBLE, which is the whole reason a chip row
       beats a select here */
    expect(screen.getByRole("button", { name: "تازه‌ترین" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "بر اساس نام" })).toHaveAttribute("aria-pressed", "false");
    /* and the control: no combobox anywhere on the toolbar */
    expect(screen.queryByRole("combobox")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "بر اساس نام" }));
    expect(screen.getByRole("button", { name: "بر اساس نام" })).toHaveAttribute("aria-pressed", "true");
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
    render(<Projects isAdmin meId="u-1" />);
    expect(await screen.findByRole("button", { name: /افزودن پروژه/ })).toBeInTheDocument();

    cleanup();
    render(<Projects isAdmin={false} meId="u-1" />);
    await waitFor(() => expect(screen.getByText("پروژه")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /افزودن پروژه/ })).toBeNull();
    /* the control: the page still rendered, so "no button" is not "no page".
       The second row's chip carries a count beside its label, so the name is
       matched loosely — an exact string here would break on the number. */
    expect(screen.getByRole("button", { name: /همه پروژه‌ها/ })).toBeInTheDocument();
  });

  it("«مال من» keeps only the projects the reader is on", async () => {
    LIST = [
      project({ id: "p-a", name: "پروژهٔ من", member_ids: ["u-1", "u-2"] }),
      project({ id: "p-b", name: "پروژهٔ دیگری", member_ids: ["u-2"] }),
    ];
    render(<Projects isAdmin meId="u-1" />);
    await waitFor(() => expect(screen.getByText("پروژهٔ من")).toBeInTheDocument());
    expect(screen.getByText("پروژهٔ دیگری")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "پروژه‌های من" }));
    await waitFor(() => expect(screen.queryByText("پروژهٔ دیگری")).toBeNull());
    expect(screen.getByText("پروژهٔ من")).toBeInTheDocument();
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
    render(<Projects isAdmin meId={null} />);
    await waitFor(() => expect(screen.getByText("پروژهٔ من")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "پروژه‌های من" }));
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
    render(<Projects isAdmin meId="u-1" />);
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
    render(<Projects isAdmin meId="u-1" />);

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
    render(<Projects isAdmin meId="u-1" />);

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
    render(<Projects isAdmin meId="u-1" />);

    expect(within(await columnOf("برای انجام")).getByText("پروژهٔ الف")).toBeInTheDocument();
  });
});

describe("the way in moved into the column (2026-09-05)", () => {
  it("offers «افزودن پروژه» inside each kanban column, and no button on top", async () => {
    /*
     * User directive: "remove the add new project on top and add it like
     * tasks in the column with the name add project, with the same style the
     * add cards has."
     *
     * Both halves asserted, because the version that added the in-column row
     * and left the top button is the likely half-done state and looks fine.
     */
    COLUMNS = [
      { id: "c-1", name: "برای انجام", tone: "blue", position: 1 },
      { id: "c-2", name: "انجام‌شده", tone: "green", position: 2 },
    ];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف", topic_id: "top-a" })];
    render(<Projects isAdmin meId="u-1" />);

    /* one per column — a project is made where it will sit */
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /افزودن پروژه/ })).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /پروژهٔ جدید/ })).toBeNull();
  });

  it("keeps the top button on the views that HAVE no column", async () => {
    /* the control, and the reason the rule is written down: list, calendar
       and archive have nowhere to put an in-column row, so they keep the
       button. A version that removed it everywhere leaves an admin unable to
       create a project from three of the four views. */
    COLUMNS = [{ id: "c-1", name: "برای انجام", tone: "blue", position: 1 }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects isAdmin meId="u-1" />);
    await screen.findByText("پروژهٔ الف");

    await userEvent.click(screen.getByRole("button", { name: "لیست" }));
    expect(await screen.findByRole("button", { name: /پروژهٔ جدید/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /افزودن پروژه/ })).toBeNull();
  });

  it("shows a MEMBER neither control", async () => {
    COLUMNS = [{ id: "c-1", name: "برای انجام", tone: "blue", position: 1 }];
    LIST = [project({ id: "p-a", name: "پروژهٔ الف" })];
    render(<Projects isAdmin={false} meId="u-1" />);
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
    render(<Projects isAdmin meId="u-1" />);
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
