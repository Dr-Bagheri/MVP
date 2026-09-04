import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OrgPersonRecord, TaskCardRecord, TaskColumnRecord, TaskDetailRecord,
  TaskLabelRecord, TaskTopicRecord,
} from "@/api/types";

/**
 * The board's contract facts, after the 2026-09-01 rebuild against the
 * reference's own product:
 *
 *  1. Cards render under THEIR columns — grouping, not presence, is the
 *     board (a flat list satisfies any "is the title there" check).
 *  2. A drop PATCHes {column_id, position} and ONLY those — the exact key
 *     set, so a widened write fails here.
 *  3. A refused write RELOADS the truth instead of keeping the lie.
 *  4. "Just mine" keeps both kinds of mine (assignee OR creator).
 *  5. LABELS are org entities: the card wears the ones its label_ids name,
 *     and a label the org has that this card does not wear is NOT on it.
 *  6. The calendar's scale switch is real: the month grid and the week
 *     strip are different shapes, and the day view names an empty day.
 *
 * Verified red, each by its own lever — (2) by widening the expected body,
 * (5) by rendering every org label on every card, (6) by pinning the month
 * view's cell count while the week view rendered.
 */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>{children}</a>
  ),
}));

const COLUMNS: TaskColumnRecord[] = [
  { id: "col-todo", name: "برای انجام", tone: "blue", position: 1 },
  { id: "col-doing", name: "در حال انجام", tone: "amber", position: 2 },
];
const TOPICS: TaskTopicRecord[] = [{ id: "top-1", name: "راه‌اندازی" }];
const LABELS: TaskLabelRecord[] = [
  { id: "lab-1", name: "فوری", color: "red" },
  { id: "lab-2", name: "محصول", color: "blue" },
];
const PEOPLE: OrgPersonRecord[] = [
  { id: "u-me", display_name: "سینا", display_name_en: null, role: "owner", username: "u-me" },
];

/** producer-shaped (core/src/api/tasks.ts CARD_ROWS) */
function card(over: Partial<TaskCardRecord>): TaskCardRecord {
  return {
    id: "t-1", column_id: "col-todo", topic_id: null, call_id: null,
    call_title: null, title: "اجرای اسکریپت", priority: "medium", labels: [],
    due_at: null, done: false, position: 1, archived: false,
    created_by: "u-me", assignee_ids: [], label_ids: [], checklist_done: 0,
    checklist_total: 0, comment_count: 0, created_at: "2026-08-31T10:00:00Z",
    recurrence_id: null,
    ...over,
  };
}

let boardTasks: TaskCardRecord[] = [];
let patches: { id: string; body: Record<string, unknown> }[] = [];
let boardReads = 0;
let refuseNextPatch = false;
/** watched, because a card drag that moves a COLUMN is the bug below */
const updateTaskColumn = vi.fn();

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {
    constructor(public status: number) { super("bff " + status); }
  },
  api: {
    me: async () => ({ id: "u-me", org_name: "نورای" }),
    orgPeople: async () => PEOPLE,
    taskLabels: async () => LABELS,
    taskBoard: async () => {
      boardReads += 1;
      return { columns: COLUMNS, topics: TOPICS, tasks: boardTasks };
    },
    updateTask: async (id: string, body: Record<string, unknown>) => {
      if (refuseNextPatch) { refuseNextPatch = false; throw new Error("refused"); }
      patches.push({ id, body });
      const hit = boardTasks.find((t) => t.id === id);
      if (hit) Object.assign(hit, body);
      return { ...card({ id }), ...(hit ?? {}) };
    },
    /* the detail a person opens is the row the board is showing — merged the
       way updateTask does, so a fixture cannot set a field on the card and
       have the modal quietly disagree with it */
    taskDetail: async (id: string): Promise<TaskDetailRecord> => ({
      ...card({ id }), ...(boardTasks.find((t) => t.id === id) ?? {}),
      description: "", checklist: [], comments: [], events: [], recurrence: null,
    }),
    createTask: vi.fn(), createTaskColumn: vi.fn(), createTaskTopic: vi.fn(),
    updateTaskColumn: (...a: unknown[]) => updateTaskColumn(...a), addTaskChecklistItem: vi.fn(),
    updateTaskChecklistItem: vi.fn(), deleteTaskChecklistItem: vi.fn(),
    addTaskComment: vi.fn(), setTaskLabel: vi.fn(), setTaskAssignee: vi.fn(),
    createTaskLabel: vi.fn(), updateTaskLabel: vi.fn(), deleteTaskLabel: vi.fn(),
  },
}));

import { TaskBoard } from "./TaskBoard";

beforeEach(() => {
  boardTasks = [];
  patches = [];
  boardReads = 0;
  refuseNextPatch = false;
  updateTaskColumn.mockReset();
  updateTaskColumn.mockResolvedValue({});
});

/** the column's own container — the element carrying its cards */
function columnRegion(name: string): HTMLElement {
  const heading = screen.getByText(name);
  let node: HTMLElement | null = heading;
  while (node && node.dataset.column === undefined) node = node.parentElement;
  if (!node) throw new Error("no [data-column] ancestor for " + name);
  return node;
}

describe("TaskBoard", () => {
  it("renders each card inside ITS column, with the counts the wire sent", async () => {
    boardTasks = [
      card({ id: "t-1", title: "اجرای اسکریپت", column_id: "col-todo", checklist_done: 1, checklist_total: 4 }),
      card({ id: "t-2", title: "بازبینی قرارداد", column_id: "col-doing" }),
    ];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    expect(within(columnRegion("برای انجام")).getByText("اجرای اسکریپت")).toBeInTheDocument();
    expect(within(columnRegion("در حال انجام")).getByText("بازبینی قرارداد")).toBeInTheDocument();
    expect(within(columnRegion("در حال انجام")).queryByText("اجرای اسکریپت")).toBeNull();
    expect(within(columnRegion("برای انجام")).getByText("۱/۴")).toBeInTheDocument();
  });

  it("a card wears ONLY the labels its label_ids name", async () => {
    boardTasks = [
      card({ id: "t-1", title: "با برچسب", label_ids: ["lab-1"] }),
      card({ id: "t-2", title: "بی‌برچسب", column_id: "col-doing" }),
    ];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("با برچسب")).toBeInTheDocument());

    const labelled = screen.getByText("با برچسب").closest("[draggable]") as HTMLElement;
    const bare = screen.getByText("بی‌برچسب").closest("[draggable]") as HTMLElement;
    expect(within(labelled).getByText("فوری")).toBeInTheDocument();
    // the org's OTHER label is not on this card, and neither is on the bare one
    expect(within(labelled).queryByText("محصول")).toBeNull();
    expect(within(bare).queryByText("فوری")).toBeNull();
  });

  it("a drop writes {column_id, position} and nothing else", async () => {
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[draggable]") as HTMLElement;
    const target = columnRegion("در حال انجام");
    const dt = {
      getData: (kind: string) => (kind === "text/task-id" ? "t-1" : ""),
      setData: vi.fn(), effectAllowed: "", dropEffect: "",
    };
    fireEvent.dragStart(cardEl, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    await waitFor(() => expect(patches).toHaveLength(1));
    const wrote = patches[0]!;
    expect(wrote.id).toBe("t-1");
    expect(Object.keys(wrote.body).sort()).toEqual(["column_id", "position"]);
    expect(wrote.body.column_id).toBe("col-doing");
    expect(typeof wrote.body.position).toBe("number");
  });

  it("a refused move reloads the truth instead of keeping the optimistic lie", async () => {
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());
    const readsBefore = boardReads;

    refuseNextPatch = true;
    const cardEl = screen.getByText("اجرای اسکریپت").closest("[draggable]") as HTMLElement;
    const target = columnRegion("در حال انجام");
    const dt = {
      getData: (kind: string) => (kind === "text/task-id" ? "t-1" : ""),
      setData: vi.fn(), effectAllowed: "", dropEffect: "",
    };
    fireEvent.dragStart(cardEl, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    await waitFor(() => expect(boardReads).toBeGreaterThan(readsBefore));
    await waitFor(() =>
      expect(within(columnRegion("برای انجام")).getByText("اجرای اسکریپت")).toBeInTheDocument());
    expect(patches).toHaveLength(0);
  });

  it("'just mine' keeps both kinds of mine and drops the rest", async () => {
    boardTasks = [
      card({ id: "t-a", title: "سپرده به من", created_by: "u-other", assignee_ids: ["u-me"] }),
      card({ id: "t-b", title: "ساختهٔ من", created_by: "u-me", assignee_ids: [] }),
      card({ id: "t-c", title: "مال دیگری", created_by: "u-other", assignee_ids: ["u-other"] }),
    ];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("مال دیگری")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "فقط تسک‌های من" }));

    await waitFor(() => expect(screen.queryByText("مال دیگری")).toBeNull());
    expect(screen.getByText("سپرده به من")).toBeInTheDocument();
    expect(screen.getByText("ساختهٔ من")).toBeInTheDocument();
  });

  it("the calendar's scale switch renders different shapes, and the list groups by deadline", async () => {
    boardTasks = [card({ id: "t-1", title: "اجرای اسکریپت" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "تقویم" }));
    // month is the opening scale: a whole month of cells, never seven
    const monthCells = document.querySelectorAll("li.min-h-24");
    expect(monthCells.length).toBeGreaterThan(27);

    await userEvent.click(screen.getByRole("tab", { name: "هفته" }));
    await waitFor(() => expect(document.querySelectorAll("li.min-h-24").length).toBe(0));

    await userEvent.click(screen.getByRole("button", { name: "لیست" }));
    // an undated card lands in the no-deadline group, named
    await waitFor(() => expect(screen.getByText(/بدون مهلت/)).toBeInTheDocument());
  });
  /*
   * WHO A TASK IS FOR — reported 2026-09-04: "the task is already assigned to
   * Sina but it does not show it; when I press the plus button it loads that
   * Sina is assigned."
   *
   * The picker kept its own copy of the roster and fetched it when the popover
   * OPENED, so an assigned task looked exactly like an unassigned one until
   * somebody clicked `+`. Both assertions below are about the same fact seen
   * from the two places a person looks at it.
   */
  it("names the assignee in the detail, before anyone opens the picker", async () => {
    boardTasks = [card({ id: "t-1", title: "پایگاه داده", assignee_ids: ["u-me"] })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("پایگاه داده")).toBeInTheDocument());
    await userEvent.click(screen.getByText("پایگاه داده"));

    /*
     * The chip's OWN affordance. Asserting the name alone would be satisfied
     * by «سینا» appearing anywhere in the modal — a history line, the card
     * still rendered behind it — and this must be the chip or it is not the
     * bug. Nothing else in the tree carries this title.
     */
    await waitFor(() =>
      expect(screen.getByTitle("حذف سینا"), "the assignee chip is missing").toBeInTheDocument());

    /* and the `+` was never pressed — the whole point */
    expect(screen.queryByPlaceholderText("جستجوی عضو…"), "the picker opened by itself").toBeNull();
  });

  it("names the assignee on the card, and only on the card that has one", async () => {
    boardTasks = [
      card({ id: "t-1", title: "پایگاه داده", column_id: "col-todo", assignee_ids: ["u-me"] }),
      card({ id: "t-2", title: "بی‌مسئول", column_id: "col-doing" }),
    ];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("پایگاه داده")).toBeInTheDocument());

    expect(within(columnRegion("برای انجام")).getByText("سینا")).toBeInTheDocument();
    /* the control: a version that names somebody on every card — or names the
       whole roster — passes the assertion above and fails this one */
    expect(within(columnRegion("در حال انجام")).queryByText("سینا")).toBeNull();
  });

  it("keeps the count true when the roster cannot name everybody", async () => {
    /* two assigned, one of whom the roster does not carry — a colleague who
       has left. "+۱" is a fact about the task; dropping it would report one
       owner for a task that has two. */
    boardTasks = [card({ id: "t-1", title: "پایگاه داده", assignee_ids: ["u-me", "u-gone"] })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("پایگاه داده")).toBeInTheDocument());

    const column = within(columnRegion("برای انجام"));
    expect(column.getByText("سینا")).toBeInTheDocument();
    expect(column.getByText("+۱"), "the second assignee vanished from the count").toBeInTheDocument();
  });

  it("dragging a CARD moves the card — not the column it came out of", async () => {
    /*
     * User report, 2026-09-04: "for moving cards by hand they all move
     * together."
     *
     * `dragstart` BUBBLES. A card sits inside its column and both are
     * draggable, so picking up a card fired the card's handler and then the
     * column's — the transfer left carrying a task id AND a column id, and the
     * drop read the column first. One dragged card repositioned the whole
     * column, which on screen is every card in it moving at once.
     *
     * THE FIXTURE IS THE POINT. The drop tests above hand in a `getData` that
     * answers "" to anything but `text/task-id`, so the column id could not be
     * on the transfer and the bug was unreachable — a fake agreeing with the
     * belief the code was written on. This one RECORDS what `setData` writes
     * and reads it back, which is what a DataTransfer does.
     */
    boardTasks = [card({ id: "t-1", title: "اجرای اسکریپت", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const store = new Map<string, string>();
    const dt = {
      setData: (kind: string, value: string) => { store.set(kind, value); },
      getData: (kind: string) => store.get(kind) ?? "",
      effectAllowed: "", dropEffect: "",
    };
    const cardEl = screen.getByText("اجرای اسکریپت").closest("[draggable]") as HTMLElement;
    fireEvent.dragStart(cardEl, { dataTransfer: dt });
    fireEvent.drop(columnRegion("در حال انجام"), { dataTransfer: dt });

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]!.body.column_id, "the card did not move").toBe("col-doing");
    expect(
      updateTaskColumn,
      "dragging one card repositioned its whole column",
    ).not.toHaveBeenCalled();
  });

  it("THE CONTROL: dragging a COLUMN still moves the column", async () => {
    /* without this, "never move a column" passes the test above and takes the
       board's own reordering with it */
    boardTasks = [card({ id: "t-1", title: "اجرای اسکریپت", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const store = new Map<string, string>();
    const dt = {
      setData: (kind: string, value: string) => { store.set(kind, value); },
      getData: (kind: string) => store.get(kind) ?? "",
      effectAllowed: "", dropEffect: "",
    };
    fireEvent.dragStart(columnRegion("برای انجام"), { dataTransfer: dt });
    fireEvent.drop(columnRegion("در حال انجام"), { dataTransfer: dt });

    await waitFor(() => expect(updateTaskColumn).toHaveBeenCalledTimes(1));
    expect(updateTaskColumn.mock.calls[0]![0]).toBe("col-todo");
    expect(patches, "a column drag wrote a task").toHaveLength(0);
  });
});
