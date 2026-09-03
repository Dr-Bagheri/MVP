import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OrgPersonRecord, TaskColumnRecord, TaskDetailRecord, TaskLabelRecord, TaskTopicRecord,
} from "@/api/types";

/**
 * THE RED BUTTON DELETES (user directive, 2026-09-02: "the task red button
 * should truly delete"). It used to archive — a reversible act wearing a
 * trash icon — and db/0162 gave the board a real door.
 *
 * Two properties, and the first is the one that would rot: the press ASKS
 * and writes nothing. A test that only checked "the card is gone" passes
 * against a control wired straight to the delete, which is the shape the
 * platform's confirm rule exists to forbid.
 *
 * The third case is the CONTROL that makes the other two mean something:
 * archiving is still on the menu and is a different call. Without it, a
 * version that had quietly replaced archive with delete — or delete with
 * archive, which is where this started — satisfies every assertion above.
 */
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

const deleteTask = vi.fn();
const updateTask = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    deleteTask: (...a: unknown[]) => deleteTask(...a),
    updateTask: (...a: unknown[]) => updateTask(...a),
    addTaskChecklistItem: vi.fn(), updateTaskChecklistItem: vi.fn(),
    deleteTaskChecklistItem: vi.fn(), addTaskComment: vi.fn(),
    setTaskLabel: vi.fn(), setTaskAssignee: vi.fn(),
  },
}));

const { TaskDetail } = await import("./TaskDetail");

const COLUMNS: TaskColumnRecord[] = [{ id: "col-todo", name: "برای انجام", tone: "blue", position: 1 }];
const TOPICS: TaskTopicRecord[] = [];
const LABELS: TaskLabelRecord[] = [];
const PEOPLE: OrgPersonRecord[] = [
  { id: "u-me", display_name: "سینا", display_name_en: null, role: "owner" },
];

const TASK: TaskDetailRecord = {
  id: "t-1", column_id: "col-todo", topic_id: null, call_id: null, call_title: null,
  title: "اجرای اسکریپت مهاجرت", priority: "medium", labels: [], due_at: null,
  done: false, position: 1, archived: false, created_by: "u-me", assignee_ids: [],
  label_ids: [], checklist_done: 0, checklist_total: 0, comment_count: 0,
  created_at: "2026-09-01T10:00:00Z", description: "", checklist: [], comments: [], events: [],
};

function open() {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <TaskDetail
      task={TASK} columns={COLUMNS} topics={TOPICS} labels={LABELS} people={PEOPLE}
      onClose={onClose} onChanged={onChanged} onLabelsChanged={vi.fn()}
    />,
  );
  return { onClose, onChanged };
}

/* a Radix trigger opens on POINTERDOWN, which fireEvent.click does not send */
const press = async (name: string) => {
  await userEvent.click(await screen.findByRole("button", { name }));
};

beforeEach(() => {
  deleteTask.mockReset().mockResolvedValue(undefined);
  updateTask.mockReset().mockResolvedValue(TASK);
});

describe("TaskDetail — the red button", () => {
  it("asks before it deletes, and the press itself writes nothing", async () => {
    open();
    await press("more");
    await userEvent.click(await screen.findByRole("menuitem", { name: "deleteTask" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(deleteTask).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "deleteConfirm" })).toBeTruthy();
  });

  it("deletes the card on confirm, then closes the screen it was on", async () => {
    const { onClose, onChanged } = open();
    await press("more");
    await userEvent.click(await screen.findByRole("menuitem", { name: "deleteTask" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "deleteConfirm" }));

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("t-1"));
    /* the board must re-read and the modal must go: a deleted card left on
       screen is a row the next click sends a write to */
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    /* THE DISCRIMINATING HALF: it deleted, it did not archive */
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("the control — archiving is still its own item, and its own call", async () => {
    open();
    await press("more");
    await userEvent.click(await screen.findByRole("menuitem", { name: "archiveTask" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "archiveConfirm" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t-1", { archived: true }));
    expect(deleteTask).not.toHaveBeenCalled();
  });
});
