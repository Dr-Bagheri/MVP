import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskCardRecord, TaskColumnRecord, TaskDetailRecord, TaskTopicRecord } from "@/api/types";

/**
 * The board's contract facts, as things that run:
 *
 *  1. Cards render under THEIR columns — grouping, not presence, is the
 *     board (a flat list would satisfy any "is the title there" check).
 *  2. A drop PATCHes {column_id, position} and ONLY those — the position
 *     puts the card on top of its new column, and nothing else may ride
 *     along in the write (asserted on the body's exact key set).
 *  3. A refused write RELOADS the board rather than keeping the lie on
 *     screen: the card is back in its real column afterwards.
 *  4. "Just mine" filters by assignee OR creator; the two kinds of mine
 *     are both mine (each direction asserted — a card that is neither
 *     leaves the screen, each that is one of them stays).
 *  5. The empty board is a NAMED state, not a blank region.
 *
 * Verified red, each by its own lever: (1) asserting the card inside the
 * WRONG column's scope fails; (2) widening the expected body fails; (3) with
 * the reload deleted the moved card stayed put; (4) flipping the creator
 * check off dropped the created-but-unassigned card; (5) asserting the
 * empty copy against a seeded board fails.
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
  { id: "col-todo", name: "برای انجام", tone: "blue", position: 2 },
  { id: "col-doing", name: "در حال انجام", tone: "amber", position: 1 },
];
const TOPICS: TaskTopicRecord[] = [{ id: "top-1", name: "راه‌اندازی" }];

/** producer-shaped (core/src/api/tasks.ts CARD_ROWS): every field the wire
    carries, including the counts the card renders as chips */
function card(over: Partial<TaskCardRecord>): TaskCardRecord {
  return {
    id: "t-1", column_id: "col-todo", topic_id: null, call_id: null,
    call_title: null, title: "اجرای اسکریپت", priority: "medium", labels: [],
    due_at: null, done: false, position: 1, archived: false,
    created_by: "u-me", assignee_ids: [], checklist_done: 0,
    checklist_total: 0, comment_count: 0, created_at: "2026-08-31T10:00:00Z",
    ...over,
  };
}

let boardTasks: TaskCardRecord[] = [];
let patches: { id: string; body: Record<string, unknown> }[] = [];
let boardReads = 0;
let refuseNextPatch = false;

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {
    constructor(public status: number) { super("bff " + status); }
  },
  api: {
    me: async () => ({ id: "u-me", org_name: "نورای" }),
    taskBoard: async () => {
      boardReads += 1;
      return { columns: COLUMNS, topics: TOPICS, tasks: boardTasks };
    },
    updateTask: async (id: string, body: Record<string, unknown>) => {
      if (refuseNextPatch) { refuseNextPatch = false; throw new Error("refused"); }
      patches.push({ id, body });
      const hit = boardTasks.find((t) => t.id === id);
      if (hit) Object.assign(hit, body);
      // the component ADOPTS the returned row (save-then-adopt), so the fake
      // must return the row as the server would now hold it — returning a
      // stale shape here once moved the card straight back
      return { ...card({ id }), ...(hit ?? {}) };
    },
    taskDetail: async (id: string): Promise<TaskDetailRecord> => ({
      ...card({ id }), description: "", checklist: [], comments: [],
    }),
    createTask: vi.fn(), createTaskColumn: vi.fn(), createTaskTopic: vi.fn(),
    addTaskChecklistItem: vi.fn(), updateTaskChecklistItem: vi.fn(),
    deleteTaskChecklistItem: vi.fn(), addTaskComment: vi.fn(),
    assignMeToTask: vi.fn(), updateTaskColumn: vi.fn(),
  },
}));

import { TaskBoard } from "./TaskBoard";

beforeEach(() => {
  boardTasks = [];
  patches = [];
  boardReads = 0;
  refuseNextPatch = false;
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

    // grouping is the assertion: the card in the WRONG column would still
    // pass a bare presence check
    expect(within(columnRegion("برای انجام")).getByText("اجرای اسکریپت")).toBeInTheDocument();
    expect(within(columnRegion("در حال انجام")).getByText("بازبینی قرارداد")).toBeInTheDocument();
    expect(within(columnRegion("در حال انجام")).queryByText("اجرای اسکریپت")).toBeNull();

    // the checklist chip renders the producer's counts, done over total
    expect(within(columnRegion("برای انجام")).getByText("1/4")).toBeInTheDocument();
  });

  it("a drop writes {column_id, position} and nothing else", async () => {
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());

    const cardEl = screen.getByText("اجرای اسکریپت").closest("[draggable]") as HTMLElement;
    const target = columnRegion("در حال انجام");
    const dt = { getData: () => "t-1", setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(cardEl, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    await waitFor(() => expect(patches).toHaveLength(1));
    // the exact KEY SET, not containment — a widened write must fail here.
    // position's VALUE is a monotonic top-of-column stamp (-Date.now()), so
    // the shape is pinned and the clock is not.
    const wrote = patches[0]!;
    expect(wrote.id).toBe("t-1");
    expect(Object.keys(wrote.body).sort()).toEqual(["column_id", "position"]);
    expect(wrote.body.column_id).toBe("col-doing");
    expect(typeof wrote.body.position).toBe("number");
    expect(within(columnRegion("در حال انجام")).getByText("اجرای اسکریپت")).toBeInTheDocument();
  });

  it("a refused move reloads the truth instead of keeping the optimistic lie", async () => {
    boardTasks = [card({ id: "t-1", column_id: "col-todo" })];
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText("اجرای اسکریپت")).toBeInTheDocument());
    const readsBefore = boardReads;

    refuseNextPatch = true;
    const cardEl = screen.getByText("اجرای اسکریپت").closest("[draggable]") as HTMLElement;
    const target = columnRegion("در حال انجام");
    const dt = { getData: () => "t-1", setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(cardEl, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    // the refusal triggers a re-read, and the card is back where the server says
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

  it("an empty board names its state", async () => {
    render(<TaskBoard />);
    // columns arrive, no cards: the board itself renders, and the LIST view
    // names emptiness rather than showing a blank region
    await waitFor(() => expect(screen.getByText("برای انجام")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "لیست" }));
    await waitFor(() =>
      expect(screen.getByText("تسکی با این فیلترها نیست. فیلتر را عوض کن یا اولین تسک را بساز.")).toBeInTheDocument());
  });
});
