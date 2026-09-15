import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  /* the two keys with a placeholder render it, so an assertion can see
     WHICH owner the hint names — a key-only stub would pass for any name */
  useTranslations: () => (key: string, vars?: Record<string, string>) =>
    vars === undefined ? key : `${key}:${Object.values(vars).join(",")}`,
  useLocale: () => "fa",
}));

const meetingItems = vi.fn();
const addMeetingItem = vi.fn();
const updateMeetingItem = vi.fn();
const deleteMeetingItem = vi.fn();
const createTask = vi.fn();
const orgPeople = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    meetingItems: (...a: unknown[]) => meetingItems(...a),
    addMeetingItem: (...a: unknown[]) => addMeetingItem(...a),
    updateMeetingItem: (...a: unknown[]) => updateMeetingItem(...a),
    deleteMeetingItem: (...a: unknown[]) => deleteMeetingItem(...a),
    createTask: (...a: unknown[]) => createTask(...a),
    orgPeople: (...a: unknown[]) => orgPeople(...a),
  },
}));

const { ItemsPanel } = await import("./ItemsPanel");

const row = (over: Record<string, unknown> = {}) => ({
  id: "i1", kind: "decision", body: "قرارداد امضا شود", source: "user",
  done: false, owner: null, at_ms: null, created_at: "2026-09-02T10:00:00Z",
  /* 0211's four, at the column defaults — a fixture without them would be a
     row shape the server never sends */
  owner_id: null, due_on: null, supersedes_id: null, status: "standing", ...over,
});

beforeEach(() => {
  meetingItems.mockReset();
  addMeetingItem.mockReset();
  updateMeetingItem.mockReset();
  deleteMeetingItem.mockReset();
  createTask.mockReset();
  orgPeople.mockReset();
  orgPeople.mockResolvedValue([]);
});

describe("ItemsPanel", () => {
  it("adopts the SERVER's row on add, not the draft the person typed", async () => {
    /*
     * The distinction that makes this worth a test: if the panel appended the
     * DRAFT, every assertion about "the item appears" would still pass, and
     * the screen would silently disagree with the record the moment the
     * server normalised anything. So the stub returns text that is NOT what
     * was typed, and the assertion is on the server's version.
     */
    meetingItems.mockResolvedValue([]);
    addMeetingItem.mockResolvedValue(row({ id: "i9", body: "SERVER TEXT" }));
    render(<ItemsPanel meetingId="m1" locale="fa" />);
    await screen.findByText("itemEmpty_decision");

    /* the composer is CLOSED at rest now — the dashed button opens it */
    fireEvent.click(screen.getByRole("button", { name: "itemAddLabel_decision" }));
    fireEvent.change(screen.getByLabelText("itemAdd_decision"), { target: { value: "typed text" } });
    fireEvent.click(screen.getByRole("button", { name: "add" }));

    await screen.findByText("SERVER TEXT");
    expect(screen.queryByText("typed text")).toBeNull();
    expect(addMeetingItem).toHaveBeenCalledWith("m1", { kind: "decision", body: "typed text" });
  });

  it("badges the assistant's rows and ONLY the assistant's", async () => {
    /*
     * The negative control is the whole check. "The badge renders" passes
     * against a component that badges everything, which would be a lie in the
     * one direction that matters — a person's decision presented as the
     * machine's. Two rows, one of each source, and the count must be one.
     */
    meetingItems.mockResolvedValue([
      row({ id: "a", body: "person wrote this", source: "user" }),
      row({ id: "b", body: "assistant wrote this", source: "ai" }),
    ]);
    render(<ItemsPanel meetingId="m1" locale="fa" />);
    await screen.findByText("person wrote this");
    expect(screen.getAllByText("itemByAssistant")).toHaveLength(1);
  });

  it("puts a tick back when the write is refused", async () => {
    /*
     * THE LOAD-BEARING CASE. An optimistic tick that survives a refused write
     * is a checkbox that says "done" about an action item the database never
     * recorded — and nothing corrects it until a reload, which is exactly
     * when nobody is looking. Verified red by deleting the catch's restore.
     */
    meetingItems.mockResolvedValue([row({ id: "t", kind: "action", body: "امضای قرارداد" })]);
    updateMeetingItem.mockRejectedValue(new Error("refused"));
    render(<ItemsPanel meetingId="m1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    const box = await screen.findByRole("checkbox", { name: "itemDone" });
    expect(box.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(box);
    /* anchored on the FAILURE line, not merely awaited: aria-checked is
       "false" before the click too, so waiting for it alone would pass in the
       state this test is not about */
    await screen.findByText("itemWriteFailed");
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the tick when the write succeeds", async () => {
    /* the permitted twin — without it the test above passes against a
       checkbox that never ticks at all */
    meetingItems.mockResolvedValue([row({ id: "t", kind: "action", body: "امضای قرارداد" })]);
    updateMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    const box = await screen.findByRole("checkbox", { name: "itemDone" });
    fireEvent.click(box);
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("true"));
    expect(updateMeetingItem).toHaveBeenCalledWith("m1", "t", { done: true });
  });

  it("removes a row the assistant added — through the dialog, and only through it", async () => {
    /*
     * Two properties in one, and the first is the one that would rot: the
     * trash press ASKS and does not write. A test that only asserted the row
     * disappears would pass against a control wired straight to the delete,
     * which is the shape the platform's confirm rule exists to forbid.
     */
    meetingItems.mockResolvedValue([row({ id: "b", body: "assistant wrote this", source: "ai" })]);
    deleteMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" locale="fa" />);
    await screen.findByText("assistant wrote this");

    fireEvent.click(screen.getByRole("button", { name: "itemRemove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(deleteMeetingItem).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "itemRemove" }));
    await waitFor(() => expect(screen.queryByText("assistant wrote this")).toBeNull());
    expect(deleteMeetingItem).toHaveBeenCalledWith("m1", "b");
  });

  it("turns only the UNFINISHED action items into tasks, and ticks each as it lands", async () => {
    /*
     * "All remaining" is the reference's word and the honest one: an action
     * item somebody already ticked does not need a task, and creating one
     * would put closed work back on the board. The fixture therefore has one
     * of each — a version that converted everything passes any count-only
     * assertion and is wrong in the one way that matters.
     */
    meetingItems.mockResolvedValue([
      row({ id: "open", kind: "action", body: "هنوز مانده", done: false }),
      row({ id: "shut", kind: "action", body: "انجام شده", done: true }),
    ]);
    createTask.mockResolvedValue({ id: "t1" });
    updateMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" callId="c1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    fireEvent.click(await screen.findByRole("button", { name: "convertRemainingToTasks" }));

    /*
     * ANCHORED ON THE END STATE, not on the count. The first version awaited
     * `toHaveBeenCalledTimes(1)` and passed against a version that converted
     * BOTH items — waitFor is satisfied the instant the first call lands and
     * stops looking, so a loop making a second call a tick later was
     * invisible. The verify-red went green, which is how the trap was found.
     *
     * The convert button disappears only once every action item is ticked, so
     * waiting for THAT waits for the loop to finish, and the assertions after
     * it are about a settled system.
     */
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "convertRemainingToTasks" })).toBeNull());
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "هنوز مانده", call_id: "c1" }));
    /* and the task says where it came from — the description names the
       meeting's own page, which is what the board's chip leads back to */
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({ description: expect.stringContaining("/meetings/m1") });
    /* said the other way round too — the count alone would pass if the loop
       converted the finished item INSTEAD of the outstanding one */
    expect(createTask).not.toHaveBeenCalledWith(expect.objectContaining({ title: "انجام شده" }));
    /* and the item is ticked, so the two surfaces agree about what is still
       outstanding — without this the button could be pressed forever, making
       a new task each time */
    expect(updateMeetingItem).toHaveBeenCalledWith("m1", "open", { done: true });
  });

  it("makes ONE task from ONE action item, assigned to the owner the directory matches exactly", async () => {
    /*
     * 2026-09-08: the owner the summary wrote («— مسئول: سینا») becomes the
     * task's assignee — through the same exact-match resolver the assistant's
     * tools use. Two rows, only one pressed: a per-item button that converted
     * the neighbour too would pass a count of "at least one".
     */
    meetingItems.mockResolvedValue([
      row({ id: "a1", kind: "action", body: "مهاجرت حساب‌ها", owner: "سینا" }),
      row({ id: "a2", kind: "action", body: "تست A/B", owner: null }),
    ]);
    orgPeople.mockResolvedValue([
      { id: "u-2", display_name: "سینا", display_name_en: null, username: "sina" },
      /* the LOOSE neighbour — a name that CONTAINS the owner must not win */
      { id: "u-3", display_name: "سینا احمدی", display_name_en: null, username: "sina2" },
    ]);
    createTask.mockResolvedValue({ id: "t1" });
    updateMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" callId="c1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    const [first] = await screen.findAllByRole("button", { name: "itemMakeTask" });
    fireEvent.click(first!);

    await waitFor(() => expect(updateMeetingItem).toHaveBeenCalledWith("m1", "a1", { done: true }));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "مهاجرت حساب‌ها", call_id: "c1", assignees: ["u-2"],
    }));
    expect(createTask).not.toHaveBeenCalledWith(expect.objectContaining({ title: "تست A/B" }));
    /* the owner resolved, so no hand-assign hint */
    expect(screen.queryByRole("note")).toBeNull();
    /* the pressed item's button is gone (it is ticked); the neighbour keeps its own */
    expect(screen.getAllByRole("button", { name: "itemMakeTask" })).toHaveLength(1);
  });

  it("still makes the task when the owner is nobody in the directory — and says whose name it was", async () => {
    /*
     * An owner the summary wrote who is not a member (an outside invitee, a
     * misspelling) must not block the task and must not be GUESSED: the task
     * lands unassigned and the hint names the string so the presenter can
     * assign by hand without re-reading the summary.
     */
    meetingItems.mockResolvedValue([
      row({ id: "a1", kind: "action", body: "مهاجرت حساب‌ها", owner: "رضا" }),
    ]);
    orgPeople.mockResolvedValue([
      { id: "u-2", display_name: "رضا کریمی", display_name_en: null, username: "reza" },
    ]);
    createTask.mockResolvedValue({ id: "t1" });
    updateMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" callId="c1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    fireEvent.click(await screen.findByRole("button", { name: "itemMakeTask" }));

    await screen.findByRole("note");
    expect(screen.getByRole("note").textContent).toBe("itemOwnerUnresolved:رضا");
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0]?.[0]).not.toHaveProperty("assignees");
    expect(updateMeetingItem).toHaveBeenCalledWith("m1", "a1", { done: true });
  });

  it("uses the SERVER's owner_id, and does not then claim the owner was unmatched", async () => {
    /*
     * 0211, fixed 2026-09-10 — ONE ROW CONTRADICTING ITSELF.
     *
     * The extraction already resolves a spoken name against the org roster, WITH
     * a fold, and stores who it meant in `owner_id`; that column is the whole
     * reason db/0211's fields were grafted into this panel. `makeTask` ignored it
     * and re-resolved the free-text `owner` through `resolveColleague`, which is
     * an UNFOLDED EXACT match — so a row displaying «سینا محمدی» (displaying it
     * only because `owner_id` had resolved it) produced a task with no assignee
     * and painted "the owner could not be matched" beside that very name.
     *
     * THE FIXTURE IS BUILT SO THE TWO PATHS DISAGREE, which is the only way this
     * can be a test. The meeting heard «سینا»; the roster holds two colleagues
     * whose names merely CONTAIN it, so `resolveColleague` refuses by design (a
     * loose match is never chosen — a wrong assignee looks exactly like a right
     * one). `owner_id` is the only source that can answer, so an assignee here
     * proves which one was read.
     */
    meetingItems.mockResolvedValue([
      row({ id: "a1", kind: "action", body: "مهاجرت حساب‌ها", owner: "سینا", owner_id: "u-2" }),
    ]);
    orgPeople.mockResolvedValue([
      { id: "u-2", display_name: "سینا محمدی", display_name_en: null, username: "sinam" },
      { id: "u-3", display_name: "سینا احمدی", display_name_en: null, username: "sinaa" },
    ]);
    createTask.mockResolvedValue({ id: "t1" });
    updateMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" callId="c1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    fireEvent.click(await screen.findByRole("button", { name: "itemMakeTask" }));

    await waitFor(() => expect(updateMeetingItem).toHaveBeenCalledWith("m1", "a1", { done: true }));
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ assignees: ["u-2"] }));
    /* THE HALF THAT WAS THE VISIBLE DEFECT. The task landing assigned and the
       note appearing anyway were one bug with two faces, and a test that only
       checked the assignee would have left the sentence on screen. */
    expect(screen.queryByRole("note"), "a resolved owner is not an unmatched one").toBeNull();
  });

  it("falls back to the spoken name only when the server resolved NOBODY", async () => {
    /*
     * The negative control for the test above, and it is what makes `owner_id`
     * mean something: a reading that simply stopped looking at `owner` would
     * satisfy that test and would lose every row the prose slicer wrote, which
     * fills `owner` and leaves `owner_id` null. Same roster, same spoken name —
     * only the column changes, and now the exact-match refusal is the answer.
     */
    meetingItems.mockResolvedValue([
      row({ id: "a1", kind: "action", body: "مهاجرت حساب‌ها", owner: "سینا", owner_id: null }),
    ]);
    orgPeople.mockResolvedValue([
      { id: "u-2", display_name: "سینا محمدی", display_name_en: null, username: "sinam" },
      { id: "u-3", display_name: "سینا احمدی", display_name_en: null, username: "sinaa" },
    ]);
    createTask.mockResolvedValue({ id: "t1" });
    updateMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" callId="c1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    fireEvent.click(await screen.findByRole("button", { name: "itemMakeTask" }));

    await screen.findByRole("note");
    expect(screen.getByRole("note").textContent).toBe("itemOwnerUnresolved:سینا");
    expect(createTask.mock.calls[0]?.[0]).not.toHaveProperty("assignees");
  });

  it("convert-all carries each item's owner too", async () => {
    meetingItems.mockResolvedValue([
      row({ id: "a1", kind: "action", body: "الف", owner: "سینا" }),
      row({ id: "a2", kind: "action", body: "ب", owner: null }),
    ]);
    orgPeople.mockResolvedValue([{ id: "u-2", display_name: "سینا", display_name_en: null, username: "sina" }]);
    createTask.mockResolvedValue({ id: "t1" });
    updateMeetingItem.mockResolvedValue(undefined);
    render(<ItemsPanel meetingId="m1" callId="c1" locale="fa" />);

    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    fireEvent.click(await screen.findByRole("button", { name: "convertRemainingToTasks" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "convertRemainingToTasks" })).toBeNull());

    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "الف", assignees: ["u-2"] }));
    const second = createTask.mock.calls.find((c) => (c[0] as { title: string }).title === "ب")?.[0];
    expect(second).toBeTruthy();
    expect(second).not.toHaveProperty("assignees");
  });

  it("offers no convert button when nothing is outstanding", async () => {
    /* the control: a button that renders unconditionally would satisfy the
       test above and would also offer to convert an empty list */
    meetingItems.mockResolvedValue([
      row({ id: "shut", kind: "action", body: "انجام شده", done: true }),
    ]);
    render(<ItemsPanel meetingId="m1" locale="fa" />);
    fireEvent.click(await screen.findByRole("tab", { name: /item_action/ }));
    await screen.findByText("انجام شده");
    expect(screen.queryByRole("button", { name: "convertRemainingToTasks" })).toBeNull();
  });

  it("offers to play from a moment only when the row has one", async () => {
    /* at_ms null means a person typed it, which is not "at zero" — a seek
       button on such a row would send the audio to the start and look like a
       feature (rule 12: the absent thing is a legitimate value) */
    const onSeek = vi.fn();
    meetingItems.mockResolvedValue([
      row({ id: "a", body: "typed by hand", at_ms: null }),
      row({ id: "b", body: "heard at 90s", at_ms: 90_000, source: "ai" }),
    ]);
    render(<ItemsPanel meetingId="m1" onSeek={onSeek} locale="fa" />);
    await screen.findByText("typed by hand");

    const seeks = screen.getAllByTitle("playFromHere");
    expect(seeks).toHaveLength(1);
    fireEvent.click(seeks[0]!);
    expect(onSeek).toHaveBeenCalledWith(90_000);
  });
});

/**
 * 0211 — what a row gained: the colleague who owes it, the day, and whether
 * it still stands.
 *
 * Each of these fails against the panel that shipped this morning, which drew
 * `row.owner` as a bare grey word and nothing else.
 */
