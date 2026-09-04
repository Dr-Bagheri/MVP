import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgPersonRecord, ProjectRecord, TaskCardRecord } from "@/api/types";

/**
 * PROJECTS (0181) — the contract facts, and every one of them is a place the
 * screen could look right while saying something false.
 *
 *  1. PROGRESS IS A DASH when there is no work. A project with no tasks has
 *     no completion, and «۰ از ۰» is a claim about the WORK where the truth
 *     is a claim about the board being empty. (Verified red by rendering the
 *     numbers unconditionally: the empty project reported «۰ از ۰».)
 *  2. «مال من» DOES NOTHING UNTIL THE IDENTITY LANDS — and does nothing by
 *     showing nothing, never by showing everything. `meId === null` is both
 *     "still loading" and "nobody"; a filter that falls back to the whole
 *     list on either is a screen quietly answering a different question.
 *  3. CREATE writes the wire's shape, and the CREATOR is not in `member_ids`:
 *     the server adds them unconditionally, so sending them too is a second
 *     opinion about a fact the server owns.
 *  4. The detail's work list is the project's OWN category, never the board.
 */
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
  Link: ({ href, children, className }: { href: unknown; children: React.ReactNode; className?: string }) => (
    <a href={typeof href === "string" ? href : "#"} className={className}>{children}</a>
  ),
}));

const pushSpy = vi.fn();
const created: Record<string, unknown>[] = [];

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
    orgPeople: async () => PEOPLE,
    me: async () => ({ id: "u-1" }),
    /* the detail reads BOTH of these to draw the order dialog and the
       workload panel. Without them the component throws inside a promise and
       the failure arrives wearing an assertion's costume — the exact shape
       this suite's sibling minted a rule about hours ago. */
    taskLabels: async () => [],
    projectWorkload: async () => [],
    taskBoard: async () => ({
      columns: [{ id: "c-1", name: "انجام‌شده", tone: "green", position: 1 }],
      topics: [],
      tasks: TASKS,
    }),
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
  <CrumbTitleProvider><ProjectDetail id={id} meId={meId} isAdmin /></CrumbTitleProvider>
);

beforeEach(() => {
  LIST = [];
  TASKS = [];
  ONE = project({});
  created.length = 0;
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

  it("offers «پروژهٔ جدید» to an admin and to nobody else", async () => {
    /*
     * 0186: "the admins only can make projects". ABSENT rather than
     * disabled — a greyed button is a promise the product will not keep for
     * this person, and pressing it explains nothing. The wall itself is the
     * policy; this asserts the screen agrees with it.
     */
    LIST = [project({ id: "p-a", name: "پروژه" })];
    render(<Projects isAdmin meId="u-1" />);
    expect(await screen.findByRole("button", { name: /پروژهٔ جدید/ })).toBeInTheDocument();

    cleanup();
    render(<Projects isAdmin={false} meId="u-1" />);
    await waitFor(() => expect(screen.getByText("پروژه")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /پروژهٔ جدید/ })).toBeNull();
    /* the control: the page still rendered, so "no button" is not "no page" */
    expect(screen.getByRole("button", { name: "همه" })).toBeInTheDocument();
  });

  it("«مال من» keeps only the projects the reader is on", async () => {
    LIST = [
      project({ id: "p-a", name: "پروژهٔ من", member_ids: ["u-1", "u-2"] }),
      project({ id: "p-b", name: "پروژهٔ دیگری", member_ids: ["u-2"] }),
    ];
    render(<Projects isAdmin meId="u-1" />);
    await waitFor(() => expect(screen.getByText("پروژهٔ من")).toBeInTheDocument());
    expect(screen.getByText("پروژهٔ دیگری")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "مال من" }));
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

    await userEvent.click(screen.getByRole("button", { name: "مال من" }));
    await waitFor(() => expect(screen.queryByText("پروژهٔ من")).toBeNull());
    expect(screen.queryByText("پروژهٔ دیگری")).toBeNull();
    /* and the empty state names the FILTER rather than the organisation —
       "no projects yet" here would be a claim about the org */
    expect(screen.getByText("با این فیلتر پروژه‌ای نیست")).toBeInTheDocument();
  });

  it("creates with the wire's shape, and never sends the creator as a member", async () => {
    render(<Projects isAdmin meId="u-1" />);
    await userEvent.click(await screen.findByRole("button", { name: /پروژهٔ جدید/ }));

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
    expect(pushSpy).toHaveBeenCalledWith("/projects/p-new");
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
