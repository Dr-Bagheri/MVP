import { personFixture } from "@/test/fixtures";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  personFixture({ id: "u-me", display_name: "سینا", display_name_en: null, role: "owner", username: "u-me" }),
];

const TASK: TaskDetailRecord = {
  id: "t-1", column_id: "col-todo", topic_id: null, call_id: null, call_title: null,
  meeting_id: null, meeting_title: null,
  title: "اجرای اسکریپت مهاجرت", priority: "medium", labels: [], due_at: null,
  done: false, position: 1, archived: false, created_by: "u-me", assignee_ids: [],
  label_ids: [], checklist_done: 0, checklist_total: 0, comment_count: 0,
  created_at: "2026-09-01T10:00:00Z", description: "", checklist: [], comments: [], events: [],
  recurrence_id: null, recurrence: null, channel_id: null, channel_name: null,
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

describe("TaskDetail — nothing the author wrote to themselves", () => {
  it("renders no comment syntax as text", () => {
    /*
     * THIS SHIPPED. A note about the rail was written as a bare block comment
     * in JSX CHILD position, where a comment is not a comment — it is
     * content. The whole paragraph, `283px, measured …`, rendered on the page
     * above the rail in production. Typecheck passed. Every test passed. A
     * user found it and sent a screenshot.
     *
     * The reason no existing check could see it is worth stating: a leaked
     * comment is VALID JSX and valid TypeScript, so it is invisible to the
     * compiler; and no test asserted the absence of text nobody expected to
     * be there. A source grep cannot help either — the shape is a comment in
     * one position and identical to a comment in twenty legitimate ones, and
     * the sweep I first wrote for it returned three hundred false positives.
     *
     * So it is checked where the defect actually exists: in the RENDERED
     * text. Cheap, exact, and it fires on any file this suite renders.
     */
    open();
    const text = document.body.textContent ?? "";
    for (const fragment of ["/*", "*/", "px, measured"]) {
      expect(text).not.toContain(fragment);
    }
  });
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

describe("the acts are all in one menu (2026-09-19)", () => {
  /*
   * User directive: "put edit and sign it as complete inside the three dots
   * as well for both tasks and projects."
   *
   * Both halves are asserted, and the second is the one that makes this a
   * test of the DIRECTIVE rather than of the menu: a version that added the
   * two items and left the buttons on the bar satisfies every "is it in the
   * menu" line and is exactly what was asked to stop — two doors to one act,
   * side by side, and a person wondering which is real.
   */
  it("edit and «mark done» are menu items, and neither is a button on the bar", async () => {
    open();
    /* BEFORE the menu opens: no act is reachable as a bar control. The done
       toggle was a bordered `.btn btn-sm` here until today. */
    expect(screen.queryByRole("button", { name: "edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "markDone" })).toBeNull();

    await press("more");
    expect(await screen.findByRole("menuitem", { name: "edit" })).toBeTruthy();
    expect(await screen.findByRole("menuitem", { name: "markDone" })).toBeTruthy();
  });

  it("«mark done» writes the flag, and says the opposite word once it is set", async () => {
    open();
    await press("more");
    await userEvent.click(await screen.findByRole("menuitem", { name: "markDone" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t-1", { done: true }));

    /* the label follows the STATE — a menu row that still reads "mark as
       done" on a finished card is a control that lies about what it does */
    cleanup();
    render(
      <TaskDetail
        task={{ ...TASK, done: true }} columns={COLUMNS} topics={TOPICS} labels={LABELS} people={PEOPLE}
        onClose={vi.fn()} onChanged={vi.fn()} onLabelsChanged={vi.fn()}
      />,
    );
    await press("more");
    expect(await screen.findByRole("menuitem", { name: "markUndone" })).toBeTruthy();
  });

  it("«edit» opens the editor in THIS panel, and the row then offers the way out", async () => {
    open();
    await press("more");
    await userEvent.click(await screen.findByRole("menuitem", { name: "edit" }));

    /* the panel is the editor (R18) — the title becomes a field in the card
       that was already open, never a second window */
    const panel = screen.getByRole("dialog");
    const field = await screen.findByDisplayValue("اجرای اسکریپت مهاجرت");
    expect(field.closest("[role=\"dialog\"]")).toBe(panel);

    await press("more");
    expect(await screen.findByRole("menuitem", { name: "done" })).toBeTruthy();
  });
});

describe("the record chip (2026-09-06)", () => {
  it("opens the RECORD's own page — never the meetings list with a parameter nothing reads", () => {
    render(
      <TaskDetail
        task={{ ...TASK, call_id: "c-9", call_title: "جلسهٔ هفتگی" }}
        columns={COLUMNS} topics={TOPICS} labels={LABELS} people={PEOPLE}
        onClose={vi.fn()} onChanged={vi.fn()} onLabelsChanged={vi.fn()}
      />,
    );
    const chip = screen.getByRole("link", { name: /جلسهٔ هفتگی/ });
    expect(chip.getAttribute("href")).toBe("/calls/c-9");
  });

  it("leads to the MEETING's page, under the meeting's name, when the record has one (2026-09-08)", () => {
    /* the call above is the control: a task from a plain upload still opens
       the record, and only a task whose call belongs to a meeting opens the
       meeting — the wire says which (meeting_id from the producer's join) */
    render(
      <TaskDetail
        task={{ ...TASK, call_id: "c-9", call_title: "ضبط ۹", meeting_id: "m-4", meeting_title: "جلسهٔ محصول" }}
        columns={COLUMNS} topics={TOPICS} labels={LABELS} people={PEOPLE}
        onClose={vi.fn()} onChanged={vi.fn()} onLabelsChanged={vi.fn()}
      />,
    );
    const chip = screen.getByRole("link", { name: /جلسهٔ محصول/ });
    expect(chip.getAttribute("href")).toBe("/meetings/m-4");
    expect(screen.queryByRole("link", { name: /ضبط ۹/ })).toBeNull();
  });
});
