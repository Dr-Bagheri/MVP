import { personFixture } from "@/test/fixtures";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatChannelRecord, OrgPersonRecord, TaskColumnRecord, TaskDetailRecord, TaskLabelRecord, TaskTopicRecord,
} from "@/api/types";

/**
 * THE TASK'S ROOM (db/0227; user directive, 2026-09-16: "assign tasks to a
 * chatroom … people assigned in that task automatically will be assigned to
 * the chatroom as well … only admin can do it").
 *
 * What the panel owns: an admin gets the kit's dropdown over the org's
 * rooms and a «new room» key; a member gets the room's name as a door and
 * no control at all (the trigger would answer 403 — a control the server
 * refuses is worse than none). The SEATING is the database's, so it is
 * asserted in db/test/130, not here; what is asserted here is that the two
 * writes the panel can make are the ones the server expects — a PATCH with
 * `channel_id`, and the one-transaction create.
 */
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params?.room !== undefined ? `${key}:${params.room}` : key,
  useLocale: () => "fa",
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, className }: { href: unknown; children: React.ReactNode; className?: string }) => (
    <a href={typeof href === "string" ? href : "#"} className={className}>{children}</a>
  ),
}));

const updateTask = vi.fn();
const createTaskRoom = vi.fn();
const chatChannels = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    updateTask: (...a: unknown[]) => updateTask(...a),
    createTaskRoom: (...a: unknown[]) => createTaskRoom(...a),
    chatChannels: () => chatChannels(),
    deleteTask: vi.fn(), addTaskChecklistItem: vi.fn(), updateTaskChecklistItem: vi.fn(),
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
/* producer-shaped (core/src/api/chat.ts ChatChannelRecord) — no cast: a cast
   against a wire type is a drift report somebody decided not to file */
const ROOMS: ChatChannelRecord[] = [
  { id: "r-1", name: "تیم فنی", topic: "", project_id: null, archived_at: null, created_by: "u-me",
    created_at: "2026-09-16T00:00:00Z", joined: true, muted: false, last_seq: 0, last_read_seq: 0,
    mention_count: 0 },
  { id: "r-old", name: "اتاق قدیمی", topic: "", project_id: null, archived_at: "2026-09-10T00:00:00Z",
    created_by: "u-me", created_at: "2026-09-01T00:00:00Z", joined: false, muted: false, last_seq: 0,
    last_read_seq: 0, mention_count: 0 },
];

const TASK: TaskDetailRecord = {
  id: "t-1", column_id: "col-todo", topic_id: null, call_id: null, call_title: null,
  meeting_id: null, meeting_title: null,
  title: "بررسی پلتفرم", priority: "medium", labels: [], due_at: null,
  done: false, position: 1, archived: false, created_by: "u-me", assignee_ids: [],
  label_ids: [], checklist_done: 0, checklist_total: 0, comment_count: 0,
  created_at: "2026-09-01T10:00:00Z", description: "", checklist: [], comments: [], events: [],
  recurrence_id: null, recurrence: null, channel_id: null, channel_name: null,
};

function open(task: TaskDetailRecord, isAdmin: boolean) {
  const onChanged = vi.fn();
  render(
    <TaskDetail
      task={task} columns={COLUMNS} topics={TOPICS} labels={LABELS} people={PEOPLE}
      isAdmin={isAdmin} onClose={vi.fn()} onChanged={onChanged} onLabelsChanged={vi.fn()}
    />,
  );
  return { onChanged };
}

beforeEach(() => {
  updateTask.mockReset().mockResolvedValue(TASK);
  createTaskRoom.mockReset().mockResolvedValue({ ...TASK, channel_id: "r-new", channel_name: "بررسی پلتفرم" });
  chatChannels.mockReset().mockResolvedValue(ROOMS);
});

describe("the task's room — an admin's control", () => {
  it("offers the org's LIVE rooms in the kit's dropdown, «no room» first, and never an archived one", async () => {
    open(TASK, true);
    const control = await screen.findByRole("combobox", { name: "fieldRoom" });
    expect(control).toHaveTextContent("noRoom");
    await userEvent.click(control);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["noRoom", "تیم فنی"]);
    /* the archived room is not an answer: a task put in a closed room would
       seat its people where nobody talks */
    expect(screen.queryByRole("option", { name: "اتاق قدیمی" })).toBeNull();
  });

  it("picking a room is a PATCH with `channel_id`, and «no room» is null — the server's own contract", async () => {
    const { onChanged } = open(TASK, true);
    await userEvent.click(await screen.findByRole("combobox", { name: "fieldRoom" }));
    await userEvent.click(await screen.findByRole("option", { name: "تیم فنی" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t-1", { channel_id: "r-1" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    updateTask.mockClear();
    open({ ...TASK, channel_id: "r-1", channel_name: "تیم فنی" }, true);
    const controls = await screen.findAllByRole("combobox", { name: "fieldRoom" });
    await userEvent.click(controls[controls.length - 1]!);
    await userEvent.click(await screen.findByRole("option", { name: "noRoom" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t-1", { channel_id: null }));
  });

  it("«new room» is the one-transaction create, named after the card by the server", async () => {
    const { onChanged } = open(TASK, true);
    await userEvent.click(await screen.findByRole("button", { name: "roomNew" }));
    await waitFor(() => expect(createTaskRoom).toHaveBeenCalledWith("t-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    /* and it is not a PATCH: the create is the server's transaction, never a
       channel the panel made and then pointed at in two requests */
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("a card with a room keeps its own room in the list even before the rooms land, and offers the door", async () => {
    chatChannels.mockReturnValue(new Promise(() => undefined)); // never lands
    open({ ...TASK, channel_id: "r-x", channel_name: "اتاق بررسی" }, true);
    expect(await screen.findByRole("combobox", { name: "fieldRoom" })).toHaveTextContent("اتاق بررسی");
    expect(screen.getByRole("link", { name: "openRoom" })).toHaveAttribute("href", "/chat?room=r-x");
  });
});

describe("the task's room — a member's reading", () => {
  it("a member sees the room's name as a door into it, and NO control", async () => {
    open({ ...TASK, channel_id: "r-1", channel_name: "تیم فنی" }, false);
    const door = await screen.findByRole("link", { name: "تیم فنی" });
    expect(door).toHaveAttribute("href", "/chat?room=r-1");
    expect(screen.queryByRole("combobox", { name: "fieldRoom" })).toBeNull();
    expect(screen.queryByRole("button", { name: "roomNew" })).toBeNull();
    /* and the rooms are never read for a member — a list nobody is offered */
    expect(chatChannels).not.toHaveBeenCalled();
  });

  it("a member sees «no room» as a reading, not as a choice", async () => {
    open(TASK, false);
    expect(await screen.findByText("noRoom")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "fieldRoom" })).toBeNull();
  });

  it("the history says which room, from the event's own detail", async () => {
    open({ ...TASK, events: [
      { id: "e-1", kind: "room_set", actor_id: "u-me", detail: { room: "تیم فنی" }, created_at: "2026-09-16T10:00:00Z" },
    ] }, false);
    await userEvent.click(await screen.findByRole("tab", { name: /history/ }));
    expect(await screen.findByText(/event_room_set:تیم فنی/)).toBeInTheDocument();
  });
});
