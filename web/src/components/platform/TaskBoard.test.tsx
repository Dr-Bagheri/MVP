import { personFixture } from "@/test/fixtures";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OrgPersonRecord, TaskCardRecord, TaskColumnRecord, TaskDetailRecord,
  TaskLabelRecord, TaskTopicRecord,
} from "@/api/types";
import { HOLD_MS } from "./board/holdDrag";

/* jsdom ships no PointerEvent. A MouseEvent carries clientX/clientY and
   button, which is everything the hold-drag hook reads; pointerId rides on
   top so the (guarded) capture calls see a number. */
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
  personFixture({ id: "u-me", display_name: "سینا", display_name_en: null, role: "owner", username: "u-me" }),
];

/** producer-shaped (core/src/api/tasks.ts CARD_ROWS) */
function card(over: Partial<TaskCardRecord>): TaskCardRecord {
  return {
    id: "t-1", column_id: "col-todo", topic_id: null, call_id: null,
    call_title: null, meeting_id: null, meeting_title: null, title: "اجرای اسکریپت", priority: "medium", labels: [],
    due_at: null, done: false, position: 1, archived: false,
    created_by: "u-me", assignee_ids: [], label_ids: [], checklist_done: 0,
    checklist_total: 0, comment_count: 0, created_at: "2026-08-31T10:00:00Z",
    recurrence_id: null,
    channel_id: null, channel_name: null,
    ...over,
  };
}

let boardTasks: TaskCardRecord[] = [];
let patches: { id: string; body: Record<string, unknown> }[] = [];
let boardReads = 0;
let refuseNextPatch = false;
/** watched, because a card drag that moves a COLUMN is the bug below */
const updateTaskColumn = vi.fn();
/** watched and steerable: «کپی» makes one create per person, and the copy
    tests refuse one of them mid-way (2026-09-19) */
const createTask = vi.fn();
/** what only the DETAIL carries — a description, the steps, a schedule —
    merged into `taskDetail`'s answer; the copy tests read all three off it */
let detailExtras: Partial<TaskDetailRecord> = {};

/* the reader, mutable: the board grew two ADMIN-only controls on 2026-09-05
   and a fixture that can only be one role cannot test an absence. */
let ME: { id: string; org_name?: string; role?: string } = { id: "u-me", org_name: "نورای" };
const createdProjects: Record<string, unknown>[] = [];

vi.mock("@/api/client", () => {
  class BffError extends Error {
    constructor(public status: number) { super("bff " + status); }
  }
  return {
  BffError,
  api: {
    me: async () => ME,
    orgPeople: async () => PEOPLE,
    taskLabels: async () => LABELS,
    taskBoard: async (opts?: { archived?: boolean }) => {
      boardReads += 1;
      /* the archive is the OTHER half of the fixture (2026-09-05) */
      const archived = opts?.archived === true;
      return { columns: COLUMNS, topics: TOPICS, tasks: boardTasks.filter((t) => t.archived === archived) };
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
    taskDetail: async (id: string): Promise<TaskDetailRecord> => {
      const hit = boardTasks.find((t) => t.id === id);
      /* a task the server no longer has answers 404 — the archive tests
         below open exactly such a row */
      if (hit === undefined) throw new BffError(404);
      return {
        ...card({ id }), ...hit,
        description: "", checklist: [], comments: [], events: [], recurrence: null,
        ...detailExtras,
      };
    },
    createTask: (...a: unknown[]) => createTask(...a), createTaskColumn: vi.fn(), createTaskTopic: vi.fn(),
    /* the folder strip splits folders from projects by reading the projects
       (2026-09-05) — the mock must answer, or the effect throws */
    projects: async () => [],
    /* the board's `+` opens the project dialog now (2026-09-05), and the
       dialog is the projects page's own component — so the board's mock has
       to answer what that component asks, or it throws inside a promise and
       the failure arrives wearing an assertion's costume */
    createProject: async (input: Record<string, unknown>) => {
      createdProjects.push(input);
      return { id: "p-new", name: String(input.name) };
    },
    updateTaskColumn: (...a: unknown[]) => updateTaskColumn(...a), addTaskChecklistItem: vi.fn(),
    updateTaskChecklistItem: vi.fn(), deleteTaskChecklistItem: vi.fn(),
    addTaskComment: vi.fn(), setTaskLabel: vi.fn(), setTaskAssignee: vi.fn(),
    /* 0227: the detail reads the org's rooms for an admin's room row — a
       mock that omits a method the component calls does not fake "no
       rooms", it throws, and the failure arrives as whatever rendered last */
    chatChannels: async () => [], createTaskRoom: vi.fn(),
    createTaskLabel: vi.fn(), updateTaskLabel: vi.fn(), deleteTaskLabel: vi.fn(),
    /* the archive's delete (2026-09-05): the row leaves the fixture the way
       it leaves the server */
    deleteTask: async (id: string) => { boardTasks = boardTasks.filter((t) => t.id !== id); },
  },
  };
});

import { TaskBoard } from "./TaskBoard";

beforeEach(() => {
  boardTasks = [];
  patches = [];
  boardReads = 0;
  refuseNextPatch = false;
  ME = { id: "u-me", org_name: "نورای", role: "admin" };
  createdProjects.length = 0;
  updateTaskColumn.mockReset();
  updateTaskColumn.mockResolvedValue({});
  detailExtras = {};
  createTask.mockReset();
  createTask.mockResolvedValue(card({ id: "t-new" }));
});

/** the column's own container — the element carrying its cards */
function columnRegion(name: string): HTMLElement {
  const heading = screen.getByText(name);
  let node: HTMLElement | null = heading;
  while (node && node.dataset.column === undefined) node = node.parentElement;
  if (!node) throw new Error("no [data-column] ancestor for " + name);
  return node;
}

/**
 * HOLD, MOVE, RELEASE — the gesture that moves a card (2026-09-05). jsdom
 * has no layout, so the hit-test the hook uses to find the column under the
 * pointer is answered here: `elementFromPoint` says "the target column" for
 * the duration of the gesture and is put back afterwards.
 */
async function holdAndDrop(cardEl: HTMLElement, target: HTMLElement): Promise<void> {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => target;
  try {
    fireEvent.pointerDown(cardEl, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 40)); });
    fireEvent.pointerMove(cardEl, { clientX: 320, clientY: 14, pointerId: 1 });
    fireEvent.pointerUp(cardEl, { clientX: 320, clientY: 14, pointerId: 1 });
  } finally {
    document.elementFromPoint = original;
  }
}

/**
 * A LIFT THAT IS STILL IN THE AIR — the half of the gesture `holdAndDrop`
 * skips past. Returns the release, so a test can look at the board while a
 * card is being carried and then put it down.
 */
async function liftOver(cardEl: HTMLElement, target: HTMLElement): Promise<() => void> {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => target;
  fireEvent.pointerDown(cardEl, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 40)); });
  await act(async () => { fireEvent.pointerMove(cardEl, { clientX: 320, clientY: 14, pointerId: 1 }); });
  return () => {
    fireEvent.pointerUp(cardEl, { clientX: 320, clientY: 14, pointerId: 1 });
    document.elementFromPoint = original;
  };
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

    const labelled = screen.getByText("با برچسب").closest("[data-card]") as HTMLElement;
    const bare = screen.getByText("بی‌برچسب").closest("[data-card]") as HTMLElement;
    expect(within(labelled).getByText("فوری")).toBeInTheDocument();
    // the org's OTHER label is not on this card, and neither is on the bare one
    expect(within(labelled).queryByText("محصول")).toBeNull();
    expect(within(bare).queryByText("فوری")).toBeNull();
  });

  it("a drop writes {column_id, position} and nothing else", async () => {
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    const target = columnRegion("در حال انجام");
    await holdAndDrop(cardEl, target);

    await waitFor(() => expect(patches).toHaveLength(1));
    const wrote = patches[0]!;
    expect(wrote.id).toBe("t-1");
    expect(Object.keys(wrote.body).sort()).toEqual(["column_id", "position"]);
    expect(wrote.body.column_id).toBe("col-doing");
    expect(typeof wrote.body.position).toBe("number");
  });

  it("a click opens the card and moves nothing — a release before the hold is a click", async () => {
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    fireEvent.pointerDown(cardEl, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(cardEl, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.click(cardEl); // what the browser fires after an unmoved press
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });

  it("a FINGER that moves before the hold ends is scrolling, not lifting", async () => {
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => columnRegion("در حال انجام");
    try {
      fireEvent.pointerDown(cardEl, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "touch" });
      fireEvent.pointerMove(cardEl, { clientX: 40, clientY: 10, pointerId: 1, pointerType: "touch" }); // 30px inside the hold window
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 40)); });
      fireEvent.pointerMove(cardEl, { clientX: 320, clientY: 14, pointerId: 1, pointerType: "touch" });
      fireEvent.pointerUp(cardEl, { clientX: 320, clientY: 14, pointerId: 1, pointerType: "touch" });
    } finally {
      document.elementFromPoint = original;
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(patches).toHaveLength(0);
    expect(within(columnRegion("برای انجام")).getByText("اجرای اسکریپت")).toBeInTheDocument();
  });

  it("the COLUMN is not draggable — its header is — and a card refuses the browser's drag", async () => {
    /*
     * Proven in a real browser with a recorder on the window (2026-09-05,
     * scratch fixture, a real mouse): press on a card inside a draggable
     * section, first move → `dragstart` whose TARGET IS THE SECTION, then
     * `pointercancel`. The browser walks up from the pressed element to the
     * nearest draggable ancestor and dispatches dragstart THERE, so the
     * previous guard — "refuse when target !== currentTarget" — could never
     * fire for a press on a card: target and currentTarget were both the
     * section. The synthetic test that covered it dispatched the event AT
     * THE CARD, which is not where the browser dispatches it, and was green
     * against the shipped bug. Rule 9, in a pointer event.
     *
     * So the section is not draggable at all now: the HEADER is the handle
     * (the control below proves a column still moves), and a card refuses
     * any drag that starts inside it — an image, a link, a selection.
     */
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());
    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    const column = columnRegion("برای انجام");

    expect(column.getAttribute("draggable"), "the section is a draggable ancestor of every card in it").not.toBe("true");
    expect(column.querySelector("header")?.getAttribute("draggable"), "the header is the column's handle").toBe("true");

    const dt = { setData: vi.fn(), getData: () => "", setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" };
    /* fireEvent returns false when a handler called preventDefault */
    expect(fireEvent.dragStart(cardEl, { dataTransfer: dt })).toBe(false);
    expect(dt.setData, "a drag from inside a card reached the column's transfer").not.toHaveBeenCalled();
  });

  it("a MOUSE that moves past the slop lifts at once — a drag needs no wait", async () => {
    /* the first hold-only version threw every real mouse drag away as a
       scroll, because a hand moves the moment it presses (user, 2026-09-05:
       "moving cards by hand is not working") */
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => columnRegion("در حال انجام");
    try {
      fireEvent.pointerDown(cardEl, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" });
      fireEvent.pointerMove(cardEl, { clientX: 50, clientY: 12, pointerId: 1, pointerType: "mouse" }); // no wait at all
      fireEvent.pointerMove(cardEl, { clientX: 320, clientY: 14, pointerId: 1, pointerType: "mouse" });
      fireEvent.pointerUp(cardEl, { clientX: 320, clientY: 14, pointerId: 1, pointerType: "mouse" });
    } finally {
      document.elementFromPoint = original;
    }
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]!.body.column_id).toBe("col-doing");
  });

  it("a refused move reloads the truth instead of keeping the optimistic lie", async () => {
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());
    const readsBefore = boardReads;

    refuseNextPatch = true;
    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    const target = columnRegion("در حال انجام");
    await holdAndDrop(cardEl, target);

    await waitFor(() => expect(boardReads).toBeGreaterThan(readsBefore));
    await waitFor(() =>
      expect(within(columnRegion("برای انجام")).getByText("اجرای اسکریپت")).toBeInTheDocument());
    expect(patches).toHaveLength(0);
  });

  it("'just mine' keeps what is ASSIGNED to me — a card I made for somebody else is not mine (2026-09-19)", async () => {
    /*
     * The DISCRIMINATING card is «ساختهٔ من»: made by me, assigned to nobody.
     * The rule before today kept it ("assigned or created"), and from an
     * admin's seat that made the filter a no-op — they made most of the
     * board. A version that still keeps it passes every other line here,
     * which is why that line is the one asserted as an ABSENCE. «هم ساخته
     * هم سپرده» is the control on the other side: making a card does not
     * disqualify it when it is also in my hands.
     */
    boardTasks = [
      card({ id: "t-a", title: "سپرده به من", created_by: "u-other", assignee_ids: ["u-me"] }),
      card({ id: "t-b", title: "ساختهٔ من", created_by: "u-me", assignee_ids: [] }),
      card({ id: "t-c", title: "مال دیگری", created_by: "u-other", assignee_ids: ["u-other"] }),
      card({ id: "t-d", title: "هم ساخته هم سپرده", created_by: "u-me", assignee_ids: ["u-me", "u-other"] }),
    ];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("مال دیگری")).toBeInTheDocument());

    /* the filter is a CHECK ROW in the «فیلتر» menu (design «ج», 2026-09-17) */
    await userEvent.click(screen.getByRole("button", { name: /^فیلتر/ }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "فقط تسک‌های من" }));

    await waitFor(() => expect(screen.queryByText("مال دیگری")).toBeNull());
    expect(screen.getByText("سپرده به من")).toBeInTheDocument();
    expect(screen.getByText("هم ساخته هم سپرده")).toBeInTheDocument();
    expect(screen.queryByText("ساختهٔ من"), "a card I made and handed to nobody is not in my hands").toBeNull();
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

  it("moving a CARD moves the card — not the column it came out of", async () => {
    /*
     * User report, 2026-09-04: "for moving cards by hand they all move
     * together." — with the browser's drag, `dragstart` bubbled from the card
     * to its draggable column and the drop read the column id first.
     *
     * Cards moved by HOLD since 2026-09-05 (holdDrag), which is a different
     * mechanism from the column's HTML5 drag: a press on a card cannot start
     * the column's dragstart at all. This is kept as the guard on the join —
     * a card gesture must leave the column write untouched — and the control
     * below proves the column's own drag still moves the column.
     */
    boardTasks = [card({ id: "t-1", title: "اجرای اسکریپت", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    await holdAndDrop(cardEl, columnRegion("در حال انجام"));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]!.body.column_id, "the card did not move").toBe("col-doing");
    expect(
      updateTaskColumn,
      "dragging one card repositioned its whole column",
    ).not.toHaveBeenCalled();
  });

  it("the carried card rides ON THE BODY, not inside its column", async () => {
    /*
     * User report, 2026-09-09: "dragging a task should animate to be hover on
     * top of the cards and not inside the container cards."
     *
     * The card used to be transformed WHERE IT SAT with a `z-50`, and neither
     * half of that could work on this board: the column's card list is
     * `overflow-y-auto`, so the card was clipped at its edge, and every column
     * wears `.glass` — a `backdrop-filter` is a stacking context, so no
     * z-index inside one can rise above the column beside it. Both are facts
     * about LAYOUT, which jsdom does not have; what this test can hold is the
     * fact that makes them irrelevant — the thing under the hand is parked on
     * the body, outside every column. If it is ever put back inside one, the
     * clipping and the stacking come back with it.
     */
    boardTasks = [card({ id: "t-1", title: "اجرای اسکریپت", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    const release = await liftOver(cardEl, columnRegion("در حال انجام"));

    const ghost = document.querySelector("[data-drag-ghost]");
    expect(ghost, "nothing was raised for the hand to carry").not.toBeNull();
    expect(ghost!.parentElement, "the carried card is still inside a column").toBe(document.body);
    expect(ghost!.closest("[data-column]")).toBeNull();
    /* and it is not a second card as far as anything reading the page is
       concerned — the real one is still in the tree */
    expect(ghost!.getAttribute("aria-hidden")).toBe("true");
    expect(ghost!.querySelector("[data-card]")).toBeNull();

    await act(async () => { release(); });
    expect(document.querySelector("[data-drag-ghost]"), "the ghost outlived the drop").toBeNull();
  });

  it("the column under the pointer MAKES SPACE, and gives it back", async () => {
    /* the other half of the same report: "should make space for it in the
       other columns". The space is the card's own measured height, held open
       at the top of the column — which is where a dropped card lands, since
       `moveTask` writes a position ahead of everything already there. */
    boardTasks = [
      card({ id: "t-1", title: "اجرای اسکریپت", column_id: "col-todo" }),
      card({ id: "t-2", title: "بازبینی قرارداد", column_id: "col-doing" }),
    ];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[data-card]") as HTMLElement;
    const doing = columnRegion("در حال انجام");
    expect(doing.querySelector("[data-slot]"), "a slot before anything was lifted").toBeNull();

    const release = await liftOver(cardEl, doing);
    expect(doing.querySelector("[data-slot]"), "the column made no room").not.toBeNull();
    /* the column it CAME from keeps the card's own box instead of a second
       slot — one card in the air, one space, wherever the pointer has it */
    expect(columnRegion("برای انجام").querySelector("[data-slot]")).toBeNull();

    await act(async () => { release(); });
    await waitFor(() => expect(doing.querySelector("[data-slot]")).toBeNull());
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
      setDragImage: () => {},
      effectAllowed: "", dropEffect: "",
    };
    /* the HEADER is the handle (see the test above) — a drag begins there */
    fireEvent.dragStart(columnRegion("برای انجام").querySelector("header")!, { dataTransfer: dt });
    fireEvent.drop(columnRegion("در حال انجام"), { dataTransfer: dt });

    await waitFor(() => expect(updateTaskColumn).toHaveBeenCalledTimes(1));
    expect(updateTaskColumn.mock.calls[0]![0]).toBe("col-todo");
    expect(patches, "a column drag wrote a task").toHaveLength(0);
  });
});

describe("the board's two doors into projects (2026-09-05)", () => {
  it("opens the PROJECT dialog from the folder row's «+», for an admin only", async () => {
    /*
     * User directive: "the plus in the second top sub menu in tasks will open
     * the new project pop up window."
     *
     * The row's folders ARE projects' categories (0181), so a bare category
     * was the half of a project with no members, no summary and no page. The
     * `+` asks the whole question now — and only an admin may answer it,
     * because 0186 made creating a project an admin's act.
     */
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await screen.findByText("برای انجام");

    await userEvent.click(await screen.findByRole("button", { name: "پروژهٔ تازه" }));
    /* the PROJECT dialog specifically, named by its own label rather than by
       the button that opened it: the two read differently on purpose («پروژهٔ
       تازه» on the board's row, «پروژهٔ جدید» on the dialog), and asserting
       the button's own text back would pass against a dialog that never
       opened. */
    expect(await screen.findByRole("dialog", { name: "پروژهٔ جدید" })).toBeInTheDocument();
    /* and it is the WHOLE question — the field the bare folder composer this
       replaced never had */
    expect(screen.getByText("توضیح کوتاه")).toBeInTheDocument();
  });

  it("shows a MEMBER neither the «+» nor the projects link", async () => {
    /*
     * Absent rather than disabled, and asserted against a control: the board
     * still renders for a member, so "no button" is not "no page". The cost
     * is real and recorded — a member can no longer add a folder to the
     * board, because on this board a folder is a project.
     */
    ME = { id: "u-me", org_name: "نورای", role: "member" };
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await screen.findByText("برای انجام");

    expect(screen.queryByRole("button", { name: "پروژهٔ تازه" })).toBeNull();
    expect(screen.queryByRole("link", { name: /پروژه‌ها/ })).toBeNull();
    /* the control */
    expect(screen.getByRole("button", { name: /کانبان/ })).toBeInTheDocument();
  });

  it("carries NO link to the projects page in its first row — the rail is the door (2026-09-16)", async () => {
    /*
     * From 2026-09-05 to 2026-09-16 an admin reached /projects through a
     * LINK in this row ("a new button in the first sub menu before
     * only-my-tasks with the name projects"). The user then put projects
     * back in the main menu above tasks and asked for it out of this row —
     * two doors to one room is the shape nav.ts keeps warning about.
     * Asserted as an ABSENCE, because the version that kept the link renders
     * perfectly and is only wrong beside the rail. The projects SECTION of
     * the strip below (a project's folders, the project `+`) is data, not a
     * door, and stays.
     */
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await screen.findByText("برای انجام");

    expect(screen.queryByRole("link", { name: /پروژه‌ها/ })).toBeNull();
    /* the control: the strip's project `+` is still an admin's door to a NEW project */
    expect(screen.getByRole("button", { name: "پروژهٔ تازه" })).toBeTruthy();
  });
});

describe("the archive keeps up with its own writes (2026-09-05)", () => {
  /*
   * User report: "task in the archive is deleted, but its table doesn't
   * refresh by itself and gave an error even when it was already deleted."
   * The archive list was read once, on entering the view; every write path
   * ended in `load()`, which re-read the LIVE board alone.
   */
  it("a task deleted from the ARCHIVE view leaves the archive list", async () => {
    boardTasks = [card({ id: "t-old", title: "کار بایگانی", archived: true })];
    render(<TaskBoard />);
    await userEvent.click(await screen.findByRole("button", { name: "آرشیو" }));
    await userEvent.click(await screen.findByText("کار بایگانی"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "بیشتر" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /حذف تسک/ }));
    await userEvent.click(await screen.findByRole("button", { name: "حذف برای همیشه" }));

    await waitFor(() => expect(screen.queryByText("کار بایگانی"), "the deleted row stayed in the archive").toBeNull());
    expect(screen.getByText("بایگانی خالی است.")).toBeInTheDocument();
    expect(screen.queryByRole("alert"), "an error about a task that was deleted on purpose").toBeNull();
  });

  it("a row whose task is already gone SAYS so — and leaves", async () => {
    boardTasks = [card({ id: "t-old", title: "کار بایگانی", archived: true })];
    render(<TaskBoard />);
    await userEvent.click(await screen.findByRole("button", { name: "آرشیو" }));
    await screen.findByText("کار بایگانی");
    /* deleted elsewhere — another tab, a colleague — while this list stood */
    boardTasks = [];
    await userEvent.click(screen.getByText("کار بایگانی"));

    expect(await screen.findByRole("alert")).toHaveTextContent("این کار دیگر وجود ندارد.");
    expect(screen.queryByText("این تغییر ذخیره نشد."), "a missing task reported as a failed save").toBeNull();
    await waitFor(() => expect(screen.queryByText("کار بایگانی")).toBeNull());
  });
});

import { __setPreferencesForTest } from "@/lib/preferences";

describe("«مهلت امروز» is the platform's today (2026-09-06)", () => {
  afterEach(() => { vi.useRealTimers(); __setPreferencesForTest({ timezone: "auto" }); });

  it("keeps a card due today in the STORED zone and drops one due yesterday there — whatever the browser's clock says", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-17T12:00:00.000Z")); // 02:00 on the 18th in Kiritimati (UTC+14)
    __setPreferencesForTest({ timezone: "Pacific/Kiritimati" });
    boardTasks = [
      card({ id: "t-today", title: "امروزِ سکو", due_at: "2026-05-18T05:00:00.000Z" }),                          // 19:00 on the 18th there
      card({ id: "t-gone", title: "دیروزِ سکو", column_id: "col-doing", due_at: "2026-05-17T09:00:00.000Z" }), // 23:00 on the 17th there
    ];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("امروزِ سکو")).toBeInTheDocument());
    /* the filter is a check row in the «فیلتر» menu (design «ج»); the
       pointer's own waits ride the fake clock */
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /^فیلتر/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /مهلت امروز/ }));
    /* the old code took browser midnight: on any machine west of the date
       line it kept the yesterday card and dropped today's */
    expect(screen.getByText("امروزِ سکو")).toBeInTheDocument();
    expect(screen.queryByText("دیروزِ سکو")).toBeNull();
  });
});

describe("a card carries its own delete, and a column carries none (2026-09-15)", () => {
  /*
   * User directive: "remove the delete button for the columns so you have
   * solid columns always, and add the small delete icon on the tasks cards".
   * A column is structure; a card is a thing. Asserted as a PAIR — the
   * column's control GONE and the card's PRESENT — because either half alone
   * passes against a version that merely lost every trash icon on the page.
   */
  const cardOf = (title: string): HTMLElement =>
    screen.getByText(title).closest("[role=button]") as HTMLElement;

  it("shows the trash on a card the reader may delete, and on no column header", async () => {
    boardTasks = [card({ id: "t-1", title: "اجرای اسکریپت", column_id: "col-todo", created_by: "u-me" })];
    render(<TaskBoard />);
    await screen.findByText("اجرای اسکریپت");

    const header = columnRegion("برای انجام").querySelector("header") as HTMLElement;
    expect(within(header).queryByRole("button", { name: /بایگانی/ })).toBeNull();
    expect(within(cardOf("اجرای اسکریپت")).getByRole("button", { name: "حذف تسک" })).toBeInTheDocument();
  });

  it("asks first in the platform's dialog — a no deletes nothing, a yes deletes and re-reads the board", async () => {
    boardTasks = [card({ id: "t-1", title: "اجرای اسکریپت", column_id: "col-todo", created_by: "u-me" })];
    render(<TaskBoard />);
    await screen.findByText("اجرای اسکریپت");
    const readsBefore = boardReads;

    await userEvent.click(within(cardOf("اجرای اسکریپت")).getByRole("button", { name: "حذف تسک" }));
    const title = await screen.findByText("تسک «اجرای اسکریپت» حذف شود؟");
    const dialog = title.closest("[role='alertdialog'], [role='dialog']") as HTMLElement;
    /* the press opened the dialog and touched nothing: the card is still on
       the board and the detail panel did not open under it */
    expect(boardTasks).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    await waitFor(() => expect(screen.queryByText("تسک «اجرای اسکریپت» حذف شود؟")).toBeNull());
    expect(boardTasks).toHaveLength(1);
    expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument();

    await userEvent.click(within(cardOf("اجرای اسکریپت")).getByRole("button", { name: "حذف تسک" }));
    const again = (await screen.findByText("تسک «اجرای اسکریپت» حذف شود؟"))
      .closest("[role='alertdialog'], [role='dialog']") as HTMLElement;
    await userEvent.click(within(again).getByRole("button", { name: "حذف برای همیشه" }));
    /* gone from the wire AND from the screen, by a re-read rather than a
       hopeful splice */
    await waitFor(() => expect(screen.queryByText("اجرای اسکریپت")).toBeNull());
    expect(boardTasks).toHaveLength(0);
    expect(boardReads).toBeGreaterThan(readsBefore);
  });

  it("offers a member no trash on a colleague's card — the door (0162) would refuse it", async () => {
    ME = { id: "u-me", org_name: "نورای", role: "member" };
    boardTasks = [
      card({ id: "t-1", title: "کارت خودم", column_id: "col-todo", created_by: "u-me" }),
      card({ id: "t-2", title: "کارت همکار", column_id: "col-todo", created_by: "u-other" }),
    ];
    render(<TaskBoard />);
    await screen.findByText("کارت همکار");

    /* the control: their OWN card still carries it, so "no trash" is a
       decision and not a missing feature */
    expect(within(cardOf("کارت خودم")).getByRole("button", { name: "حذف تسک" })).toBeInTheDocument();
    expect(within(cardOf("کارت همکار")).queryByRole("button", { name: "حذف تسک" })).toBeNull();
  });

  it("draws no add-column slot: the lane is exactly its columns (2026-09-16)", async () => {
    /* user: "remove the add column in tasks as well". Asserted as STRUCTURE
       rather than by the slot's name — its key left the catalogue with it,
       and a text query for a string that no longer exists is vacuous in a new
       way (2026-09-15). The lane is the parent of a column's section; every
       child of it is a section, and there are as many as the board has
       columns — the version with the strip had one more child, a button. */
    render(<TaskBoard />);
    const addRows = await screen.findAllByRole("button", { name: "افزودن تسک" });
    const lane = addRows[0]!.closest("section")!.parentElement!;
    expect(lane.children.length).toBeGreaterThan(0);
    expect(Array.from(lane.children).every((el) => el.tagName === "SECTION")).toBe(true);
    expect(lane.children).toHaveLength(addRows.length);
  });
});

/**
 * ROW ONE ENDS WITH «تسک جدید» (user, 2026-09-17: "add a new project and new
 * tasks in the sub-menu top for each page, the related one, at the end of
 * the first sub-menu top"). The page's create at the row's END in the coat
 * every page's create wears, beside the columns' own «افزودن تسک» rows; it
 * opens the dialog on the FIRST column, and the dialog's chips move it.
 * Asserted as structure (jsdom lays nothing out): the button shares the
 * views' row and stands in its end slot, and the dialog it opens has the
 * first column checked.
 */
describe("the row's-end create (2026-09-17)", () => {
  it("ends row one with «تسک جدید» in the page's coat, which opens the new-task dialog on the first column", async () => {
    boardTasks = [card({ id: "t-1", title: "اجرای اسکریپت" })];
    render(<TaskBoard />);
    await screen.findByText("اجرای اسکریپت");

    const create = screen.getByRole("button", { name: /تسک جدید/ });
    expect(create.className, "the create is not in the page's one coat").toMatch(/\bbtn-primary\b/);
    /* the same row as the views' track, in its END slot */
    const track = screen.getByRole("button", { name: "کانبان" }).parentElement!;
    expect(create.parentElement!.parentElement, "the create is not at the end of row one").toBe(track.parentElement!.parentElement);
    /* the columns keep their own door as well */
    expect(screen.getAllByRole("button", { name: /افزودن تسک/ }).length).toBeGreaterThan(0);

    await userEvent.click(create);
    const dialog = await screen.findByRole("dialog", { name: "تسک جدید" });
    expect(within(dialog).getByRole("radio", { name: "برای انجام" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("radio", { name: "در حال انجام" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("«کپی» — one card per person (2026-09-19)", () => {
  /*
   * User directive: "build the duplicate task option with one card per
   * person, name it کپی" — after the ask that started it: "if there is a
   * task I want for a couple of members I don't do it from the beginning".
   *
   * The properties, and why each is a property rather than a screenshot: the
   * dialog opens FILLED from the source (a copy that asked for the title
   * again is a new-task dialog with a different heading); the source's own
   * people are NOT carried (the hands are the one thing the person came to
   * change — a copy that kept Sina on it would hand Sina a duplicate); the
   * copies are ONE PER PERSON, each with that person ALONE (one card with
   * three people is the thing the feature exists to replace); the checklist
   * rides along and nothing else does — the exact KEY SET of each create is
   * pinned, because "the copy has the title" is true of every wrong version
   * too; and a refusal mid-way leaves a clean edge that a retry cannot
   * double.
   */
  const OTHERS = [
    personFixture({ id: "u-a", display_name: "بهناز", display_name_en: null, role: "member", username: "u-a" }),
    personFixture({ id: "u-b", display_name: "شهلا", display_name_en: null, role: "member", username: "u-b" }),
  ];
  beforeEach(() => { PEOPLE.push(...OTHERS); });
  afterEach(() => { PEOPLE.splice(PEOPLE.length - OTHERS.length, OTHERS.length); });

  const source = (over: Partial<TaskCardRecord> = {}) => card({
    id: "t-src", title: "تهیهٔ گزارش ماهانه", column_id: "col-doing", topic_id: "top-1",
    priority: "high", label_ids: ["lab-1"], assignee_ids: ["u-me"],
    due_at: "2026-09-25T13:30:00Z", checklist_total: 2, checklist_done: 1, ...over,
  });
  const STEPS: TaskDetailRecord["checklist"] = [
    { id: "l-1", label: "داده‌ها را جمع کن", done: true, position: 1 },
    { id: "l-2", label: "نمودار را بکش", done: false, position: 2 },
  ];

  /** open the card, press ⋯ → «کپی»; the copy dialog */
  async function openCopy(): Promise<HTMLElement> {
    render(<TaskBoard />);
    await userEvent.click(await screen.findByText("تهیهٔ گزارش ماهانه"));
    await userEvent.click(await screen.findByRole("button", { name: "بیشتر" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "کپی" }));
    return screen.findByRole("dialog", { name: "کپی تسک" });
  }
  /** the picker's list, opened — SCOPED, because a chosen person is also a chip */
  async function pickerList(dialog: HTMLElement): Promise<HTMLElement> {
    await userEvent.click(within(dialog).getByRole("button", { name: "افزودن مسئول" }));
    const search = await within(dialog).findByPlaceholderText("جستجوی عضو…");
    return search.parentElement!;
  }
  const bodies = () => createTask.mock.calls.map((c) => c[0] as Record<string, unknown>);

  it("opens the board's own dialog FILLED from the card, with nobody on it — and the card's panel is gone", async () => {
    boardTasks = [source()];
    detailExtras = { description: "با نمودارها", checklist: STEPS };
    const dialog = await openCopy();

    /*
     * THE PANEL CLOSED — asked by ATTRIBUTE, and the two shapes this replaced
     * are the reason (verify-red, 2026-09-19): a second dialog opened OVER
     * the panel marks the panel `aria-hidden`, so `queryByRole("dialog",
     * { name })` is null either way; and `hidden: true` does not help,
     * because a hidden node's accessible NAME is the empty string (accname
     * step 2A) — the covered panel is in the tree with no name to match. Both
     * queries stayed green against the mutation that left the panel open
     * under the copy dialog. Reading `aria-label` off every dialog in the
     * DOM, hidden or not, is the question that can answer NO.
     *
     * The copies land on the board, which is where the person should be
     * looking when they do; the control is the copy dialog itself, found by
     * name above.
     */
    const dialogLabels = screen.queryAllByRole("dialog", { hidden: true }).map((d) => d.getAttribute("aria-label"));
    expect(dialogLabels).toContain("کپی تسک");
    expect(dialogLabels).not.toContain("تهیهٔ گزارش ماهانه");
    expect(within(dialog).getByDisplayValue("تهیهٔ گزارش ماهانه")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("با نمودارها")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "در حال انجام" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("radio", { name: "زیاد" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("button", { name: "فوری" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "محصول" })).toHaveAttribute("aria-pressed", "false");
    /* THE DISCRIMINATING HALF: the source's own assignee is NOT carried */
    expect(within(dialog).queryByTitle("حذف سینا")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "ساختن یک کارت" })).toBeInTheDocument();
  });

  it("makes ONE card per chosen person, each with that person alone, the steps in order, and nothing else from the source", async () => {
    boardTasks = [source()];
    detailExtras = { description: "با نمودارها", checklist: STEPS };
    const dialog = await openCopy();
    const readsBefore = boardReads;
    const list = await pickerList(dialog);
    await userEvent.click(within(list).getByRole("button", { name: /بهناز/ }));
    await userEvent.click(within(list).getByRole("button", { name: /شهلا/ }));
    /* the key counts the cards — the one-per-person rule, said where it is
       about to happen */
    await userEvent.click(within(dialog).getByRole("button", { name: /ساختن [2۲] کارت/ }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(bodies().map((b) => b.assignees)).toEqual([["u-a"], ["u-b"]]);
    for (const body of bodies()) {
      expect(Object.keys(body).sort()).toEqual([
        "assignees", "checklist", "column_id", "description", "due_at", "label_ids", "priority", "title", "topic_id",
      ]);
      expect(body).toMatchObject({
        title: "تهیهٔ گزارش ماهانه", description: "با نمودارها", column_id: "col-doing", topic_id: "top-1",
        priority: "high", due_at: "2026-09-25T13:30:00Z", label_ids: ["lab-1"],
        /* the steps as words, in their order — ticks and ids stay with the original */
        checklist: ["داده‌ها را جمع کن", "نمودار را بکش"],
      });
    }
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "کپی تسک" })).toBeNull());
    expect(boardReads, "the board did not re-read after the copies landed").toBeGreaterThan(readsBefore);
  });

  it("with nobody chosen makes ONE plain copy — no assignees key, and no schedule the source did not have", async () => {
    boardTasks = [source()];
    detailExtras = { checklist: STEPS };
    const dialog = await openCopy();
    await userEvent.click(within(dialog).getByRole("button", { name: "ساختن یک کارت" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(bodies()[0]).not.toHaveProperty("assignees");
    expect(bodies()[0]).not.toHaveProperty("schedule");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "کپی تسک" })).toBeNull());
  });

  it("a refused card keeps the dialog open, drops the people whose card EXISTS, and a retry makes only the rest", async () => {
    createTask.mockReset()
      .mockResolvedValueOnce(card({ id: "t-c1" }))
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValue(card({ id: "t-c2" }));
    boardTasks = [source()];
    detailExtras = { checklist: STEPS };
    const dialog = await openCopy();
    const list = await pickerList(dialog);
    await userEvent.click(within(list).getByRole("button", { name: /بهناز/ }));
    await userEvent.click(within(list).getByRole("button", { name: /شهلا/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /ساختن [2۲] کارت/ }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    /* still open; بهناز's card is on the board, so her chip is gone — a
       retry must not hand her a second one; شهلا is still chosen */
    expect(screen.getByRole("dialog", { name: "کپی تسک" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByTitle("حذف بهناز")).toBeNull());
    expect(within(dialog).getByTitle("حذف شهلا")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "ساختن یک کارت" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(3));
    expect(bodies()[2]!.assignees).toEqual(["u-b"]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "کپی تسک" })).toBeNull());
  });

  it("a FINISHED card's copy starts in the first column — it is new work, not a done card twice", async () => {
    boardTasks = [source({ done: true })];
    detailExtras = { checklist: [] };
    const dialog = await openCopy();
    expect(within(dialog).getByRole("radio", { name: "برای انجام" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("radio", { name: "در حال انجام" })).toHaveAttribute("aria-checked", "false");
  });

  it("carries a LIVE schedule, shown so it can be switched off — each copy repeats as the original does", async () => {
    boardTasks = [source()];
    detailExtras = {
      checklist: [],
      recurrence: { id: "r-1", gap_days: 7, until_date: "2026-12-01", active: true, renewed: 2 },
    };
    const dialog = await openCopy();
    expect(within(dialog).getByRole("checkbox", { name: "این کار تکرار شود" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "ساختن یک کارت" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(bodies()[0]!.schedule).toEqual({ gap_days: 7, until_date: "2026-12-01" });
  });
});
