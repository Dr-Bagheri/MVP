/**
 * M33 — the surface executor. Model-authored args are validated like human
 * input; the interesting assertions are the REFUSALS (a wrong tool or a
 * malformed arg must come back as an honest result the model can read, not
 * as a throw and not as a silent no-op), and that navigation goes through
 * the surface's OWN push — the locale-aware router, never a raw location.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const members = vi.fn();
const setUserStatus = vi.fn();
const setUserRole = vi.fn();
const listCalls = vi.fn();
const setCallTitle = vi.fn();
const deleteCall = vi.fn();
const agentSessions = vi.fn();
const archiveSession = vi.fn();
const setLocale = vi.fn();
const taskBoard = vi.fn();
const updateTask = vi.fn();
const projects = vi.fn();
const createProject = vi.fn();
const deleteProject = vi.fn();
const updateTaskTopic = vi.fn();
const taskDetail = vi.fn();
const createTask = vi.fn();
const orgPeople = vi.fn();
const addMeetingAttendees = vi.fn();
const meetingDetail = vi.fn();
const updateMeeting = vi.fn();
const meetings = vi.fn();
const sendMemberMessage = vi.fn();
const editSegment = vi.fn();
const editSummary = vi.fn();
const connectorAction = vi.fn();
const translateCall = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    createTask: (...args: unknown[]) => createTask(...args),
    orgPeople: (...args: unknown[]) => orgPeople(...args),
    addMeetingAttendees: (...args: unknown[]) => addMeetingAttendees(...args),
    meetingDetail: (...args: unknown[]) => meetingDetail(...args),
    updateMeeting: (...args: unknown[]) => updateMeeting(...args),
    meetings: (...args: unknown[]) => meetings(...args),
    sendMemberMessage: (...args: unknown[]) => sendMemberMessage(...args),
    members: (...args: unknown[]) => members(...args),
    projects: (...args: unknown[]) => projects(...args),
    createProject: (...args: unknown[]) => createProject(...args),
    deleteProject: (...args: unknown[]) => deleteProject(...args),
    updateTaskTopic: (...args: unknown[]) => updateTaskTopic(...args),
    taskDetail: (...args: unknown[]) => taskDetail(...args),
    setUserStatus: (...args: unknown[]) => setUserStatus(...args),
    setUserRole: (...args: unknown[]) => setUserRole(...args),
    listCalls: (...args: unknown[]) => listCalls(...args),
    setCallTitle: (...args: unknown[]) => setCallTitle(...args),
    deleteCall: (...args: unknown[]) => deleteCall(...args),
    agentSessions: (...args: unknown[]) => agentSessions(...args),
    archiveSession: (...args: unknown[]) => archiveSession(...args),
    setLocale: (...args: unknown[]) => setLocale(...args),
    taskBoard: (...args: unknown[]) => taskBoard(...args),
    updateTask: (...args: unknown[]) => updateTask(...args),
    editSegment: (...args: unknown[]) => editSegment(...args),
    editSummary: (...args: unknown[]) => editSummary(...args),
    connectorAction: (...args: unknown[]) => connectorAction(...args),
    translateCall: (...args: unknown[]) => translateCall(...args),
  },
}));

import { executeClientTool, SURFACE_TOOLS } from "./agentSurface";
import { recorderControls, type RecorderHandle } from "@/components/echo/recorderControls";

function surface() {
  const push = vi.fn();
  return { push, ctx: { push } };
}

function liveRecorder(phase: "recording" | "paused"): {
  handle: RecorderHandle;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
} {
  const pause = vi.fn();
  const resume = vi.fn();
  const finish = vi.fn(async () => undefined);
  return { handle: { phase: () => phase, pause, resume, finish }, pause, resume, finish };
}

beforeEach(() => {
  members.mockReset();
  setUserStatus.mockReset();
  setUserRole.mockReset();
  listCalls.mockReset();
  setCallTitle.mockReset();
  deleteCall.mockReset();
  agentSessions.mockReset();
  archiveSession.mockReset();
  setLocale.mockReset();
  recorderControls.current = null;
});

describe("executeClientTool", () => {
  it("navigates only to routes a human could click to — and through the router", async () => {
    const { push, ctx } = surface();
    expect((await executeClientTool("navigate", { path: "/echo/records" }, ctx)).ok).toBe(true);
    expect(push).toHaveBeenCalledWith("/echo/records");
    // a model-authored path outside the product is a refusal, not a jump
    const evil = await executeClientTool("navigate", { path: "https://evil.example" }, ctx);
    expect(evil.ok).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("start_recording rides the agentStart param — the recorder's own start path", async () => {
    const { push, ctx } = surface();
    const result = await executeClientTool("start_recording", { title: "call 1" }, ctx);
    expect(result.ok).toBe(true);
    expect(push).toHaveBeenCalledWith("/echo/record?agentStart=call%201");
  });

  it("pause/resume reach the LIVE recorder or refuse honestly", async () => {
    const { ctx } = surface();
    expect(await executeClientTool("pause_recording", {}, ctx)).toEqual({
      ok: false, detail: "no recording is in progress on this screen",
    });
    const rec = liveRecorder("recording");
    recorderControls.current = rec.handle;
    expect((await executeClientTool("pause_recording", {}, ctx)).ok).toBe(true);
    expect(rec.pause).toHaveBeenCalled();
    // resuming a RECORDING take is a refusal — the phases are not interchangeable
    expect((await executeClientTool("resume_recording", {}, ctx)).ok).toBe(false);
    const paused = liveRecorder("paused");
    recorderControls.current = paused.handle;
    expect((await executeClientTool("resume_recording", {}, ctx)).ok).toBe(true);
    expect(paused.resume).toHaveBeenCalled();
  });

  it("finish_recording ends a live OR paused take — and refuses with none", async () => {
    const { ctx } = surface();
    expect((await executeClientTool("finish_recording", {}, ctx)).ok).toBe(false);
    const rec = liveRecorder("paused");
    recorderControls.current = rec.handle;
    const result = await executeClientTool("finish_recording", {}, ctx);
    expect(result.ok).toBe(true);
    expect(rec.finish).toHaveBeenCalled();
  });

  it("set_member_status resolves the person and presses the SAME api the screen does", async () => {
    const { ctx } = surface();
    members.mockResolvedValue([{ id: "u-1", username: "amir", email: "amir@x.ir", display_name: "امیر" }]);
    setUserStatus.mockResolvedValue({});
    const result = await executeClientTool("set_member_status", { member: "amir", status: "disabled" }, ctx);
    expect(result.ok).toBe(true);
    expect(members).toHaveBeenCalledWith({ search: "amir" });
    expect(setUserStatus).toHaveBeenCalledWith("u-1", "disabled");
  });

  it("ambiguity is a refusal, never a guess — two Amirs disable nobody", async () => {
    const { ctx } = surface();
    members.mockResolvedValue([
      { id: "u-1", username: "amir", email: "a@x.ir", display_name: "امیر رضایی" },
      { id: "u-2", username: "amir2", email: "b@x.ir", display_name: "امیر محمدی" },
    ]);
    const result = await executeClientTool("set_member_status", { member: "امیر", status: "disabled" }, ctx);
    expect(result.ok).toBe(false);
    expect(setUserStatus).not.toHaveBeenCalled();
    // …but an EXACT username among several matches is not ambiguous
    const exact = await executeClientTool("set_member_status", { member: "amir2", status: "disabled" }, ctx);
    expect(exact.ok).toBe(true);
    expect(setUserStatus).toHaveBeenCalledWith("u-2", "disabled");
  });

  it("a 403 comes back as the ROLE refusal — the wall is the server's, worded plainly", async () => {
    const { ctx } = surface();
    members.mockResolvedValue([{ id: "u-1", username: "amir", email: "a@x.ir", display_name: "امیر" }]);
    setUserRole.mockRejectedValue({ status: 403, detail: "forbidden" });
    const result = await executeClientTool("set_member_role", { member: "amir", role: "admin" }, ctx);
    expect(result).toEqual({ ok: false, detail: "the server refused: this needs an admin role" });
  });

  it("rename_record resolves a TITLE against the table's own list", async () => {
    const { ctx } = surface();
    listCalls.mockResolvedValue([
      { id: "c-1", title: "call 3" },
      { id: "c-2", title: "call2" },
    ]);
    setCallTitle.mockResolvedValue({});
    const result = await executeClientTool("rename_record", { record: "call 3", title: "kickoff" }, ctx);
    expect(result.ok).toBe(true);
    expect(listCalls).toHaveBeenCalledWith({ includeArchived: true });
    expect(setCallTitle).toHaveBeenCalledWith("c-1", "kickoff");
  });

  it("two records with one title: nobody gets renamed", async () => {
    const { ctx } = surface();
    listCalls.mockResolvedValue([
      { id: "c-1", title: "call" },
      { id: "c-2", title: "call" },
    ]);
    const result = await executeClientTool("rename_record", { record: "call", title: "x" }, ctx);
    expect(result.ok).toBe(false);
    expect(setCallTitle).not.toHaveBeenCalled();
  });

  it("delete_record is the SOFT delete and says so out loud", async () => {
    const { ctx } = surface();
    listCalls.mockResolvedValue([{ id: "c-1", title: "call 3" }]);
    deleteCall.mockResolvedValue(undefined);
    const result = await executeClientTool("delete_record", { record: "call 3" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("restorable");
    // 0085: the assistant's delete carries its ledger reason — the consent
    // card was the confirm, and the line says the user approved it there
    expect(deleteCall).toHaveBeenCalledWith("c-1", "با تأیید کاربر از طریق دستیار");
  });

  it("delete_conversation archives — resolved by title, refused when unknown", async () => {
    const { ctx } = surface();
    agentSessions.mockResolvedValue([{ id: "s-1", title: "گزارش هفته" }]);
    archiveSession.mockResolvedValue(undefined);
    const result = await executeClientTool("delete_conversation", { conversation: "گزارش هفته" }, ctx);
    expect(result.ok).toBe(true);
    expect(archiveSession).toHaveBeenCalledWith("s-1", true);
    const missing = await executeClientTool("delete_conversation", { conversation: "نیست" }, ctx);
    expect(missing.ok).toBe(false);
  });

  it("set_language flips the UI through the shell's own switch and persists it", async () => {
    const push = vi.fn();
    const switchLocale = vi.fn();
    setLocale.mockResolvedValue({});
    const result = await executeClientTool("set_language", { language: "fa" }, { push, switchLocale });
    expect(result.ok).toBe(true);
    expect(switchLocale).toHaveBeenCalledWith("fa");
    // an invented locale is a refusal, not a guess
    const bad = await executeClientTool("set_language", { language: "de" }, { push, switchLocale });
    expect(bad.ok).toBe(false);
    expect(switchLocale).toHaveBeenCalledTimes(1);
  });

  it("open_call demands a real id — a model cannot navigate by prose", async () => {
    const { ctx } = surface();
    expect((await executeClientTool("open_call", { call_id: "the meeting" }, ctx)).ok).toBe(false);
    expect(
      (await executeClientTool("open_call", { call_id: "11111111-1111-4111-8111-111111111111" }, ctx)).ok,
    ).toBe(true);
  });

  it("an unknown tool is a refusal result — never a throw, never a silent nothing", async () => {
    const { ctx } = surface();
    expect(await executeClientTool("self_destruct", {}, ctx)).toEqual({
      ok: false, detail: "this surface cannot perform that tool",
    });
  });

  it("advertises exactly what it can execute — the list and the switch cannot drift", async () => {
    const { ctx } = surface();
    members.mockResolvedValue([]);
    for (const tool of SURFACE_TOOLS) {
      // every advertised tool must be HANDLED (refusals fine; "cannot
      // perform" means the advertisement lied)
      const result = await executeClientTool(tool, {}, ctx);
      expect(result.detail).not.toBe("this surface cannot perform that tool");
    }
  });
});

/**
 * MOVING A CARD (user report, 2026-09-04: asked to put a task «در حال انجام»,
 * the agent answered that the task system had errored).
 *
 * It had not. `update_task` took a title, a description, a priority and a
 * deadline, and a COLUMN was not among them — so there was no way to say the
 * one thing a board is for, and the miss surfaced as a transport-sounding
 * sentence. That is the worst shape a missing capability can take: it reads
 * as "try again later" for something that was never going to work.
 */
describe("update_task moves a card", () => {
  const BOARD = {
    columns: [
      { id: "col-todo", name: "برای انجام", tone: "blue", position: 1 },
      { id: "col-doing", name: "در حال انجام", tone: "amber", position: 2 },
    ],
    topics: [],
    tasks: [],
  };

  beforeEach(() => {
    taskBoard.mockReset();
    updateTask.mockReset();
    taskDetail.mockReset();
    taskBoard.mockResolvedValue(BOARD);
    updateTask.mockResolvedValue({});
    /* the task's identity: every id-addressed call carries the title and
       the surface reads the card to compare (2026-09-06) */
    taskDetail.mockResolvedValue({ id: "t-1", title: "کار" });
  });

  it("resolves the column by the name a person says", async () => {
    const { ctx } = surface();
    const result = await executeClientTool(
      "update_task", { task_id: "t-1", title: "کار", column: "در حال انجام" }, ctx,
    );
    expect(result.ok).toBe(true);
    expect(updateTask).toHaveBeenCalledWith("t-1", { column_id: "col-doing" });
  });

  it("refuses a column the board does not have, and says what it does have", async () => {
    const { ctx } = surface();
    const result = await executeClientTool(
      "update_task", { task_id: "t-1", title: "کار", column: "Done" }, ctx,
    );
    expect(result.ok).toBe(false);
    /* the real list, not a guess at the nearest column: moving a card to the
       wrong place is worse than not moving it, and the model can retry with a
       name that exists */
    expect(result.detail).toContain("در حال انجام");
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("still patches the other fields, and sends ONLY what was given", async () => {
    const { ctx } = surface();
    await executeClientTool("update_task", { task_id: "t-1", title: "کار", priority: "high" }, ctx);
    /* the control for the column branch: no column means no board read and no
       column_id — a version that always set one would move every edited card */
    expect(taskBoard).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith("t-1", { priority: "high" });
  });

  it("a patch with nothing in it is a refusal, not an empty write", async () => {
    const { ctx } = surface();
    expect((await executeClientTool("update_task", { task_id: "t-1", title: "کار" }, ctx)).ok).toBe(false);
    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe("a task tool must NAME the task it touches (2026-09-06)", () => {
  beforeEach(() => {
    taskDetail.mockReset();
    deleteProject.mockReset();
    updateTask.mockReset();
    taskDetail.mockResolvedValue({ id: "t-1", title: "جمع‌آوری صدای خام" });
  });

  it("delete_task refuses an id whose title is not the one named, and says whose it is", async () => {
    const deleteTask = vi.fn();
    (await import("@/api/client")).api.deleteTask = deleteTask as never;
    const { ctx } = surface();
    const wrong = await executeClientTool("delete_task", { task_id: "t-1", title: "تهیهٔ گزارش فروش" }, ctx);
    expect(wrong.ok).toBe(false);
    expect(wrong.detail).toContain("جمع‌آوری صدای خام");
    expect(deleteTask).not.toHaveBeenCalled();

    const right = await executeClientTool("delete_task", { task_id: "t-1", title: "جمع‌آوری صدای خام" }, ctx);
    expect(right.ok).toBe(true);
    expect(deleteTask).toHaveBeenCalledWith("t-1");
  });

  it("an id with no title is refused before anything is read or written", async () => {
    const { ctx } = surface();
    const result = await executeClientTool("update_task", { task_id: "t-1", priority: "high" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/name the task/);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("the comparison forgives the spelling a person cannot see — ZWNJ and spacing — and nothing else", async () => {
    const { ctx } = surface();
    const loose = await executeClientTool("archive_task", { task_id: "t-1", title: "جمع آوری  صدای خام" }, ctx);
    expect(loose.ok).toBe(true);
  });
});

describe("the hands of 2026-09-05 — projects and folders, named the way a person names them", () => {
  beforeEach(() => {
    members.mockReset(); projects.mockReset(); createProject.mockReset();
    deleteProject.mockReset(); taskBoard.mockReset(); updateTaskTopic.mockReset();
    createTask.mockReset(); orgPeople.mockReset();
    addMeetingAttendees.mockReset(); meetingDetail.mockReset(); updateMeeting.mockReset();
  });

  it("create_project resolves the people by name and presses the SAME create the dialog does", async () => {
    members.mockImplementation(async ({ search }: { search: string }) =>
      search === "sina"
        ? [{ id: "u-9", username: "sina", email: "s@example.test", display_name: "سینا" }]
        : []);
    createProject.mockResolvedValue({ id: "p-1", name: "آزمایش" });
    const { ctx, push } = surface();
    const result = await executeClientTool(
      "create_project", { name: "آزمایش", members: ["sina", "nobody"] }, ctx,
    );
    expect(result.ok).toBe(true);
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ name: "آزمایش", member_ids: ["u-9"] }));
    /* the unresolved person is SAID — a project quietly missing somebody
       reads as "not yet given to anyone", which is the wrong nothing */
    expect(result.detail).toMatch(/nobody/);
    expect(push).toHaveBeenCalledWith("/projects?project=p-1");
  });

  it("delete_project resolves the name against the org's own list and refuses ambiguity", async () => {
    projects.mockImplementation(async (opts?: { archived?: boolean }) =>
      opts?.archived ? [] : [{ id: "p-1", name: "آزمایش" }, { id: "p-2", name: "آزمایش" }]);
    const { ctx } = surface();
    const twice = await executeClientTool("delete_project", { project: "آزمایش" }, ctx);
    expect(twice.ok).toBe(false);
    expect(deleteProject).not.toHaveBeenCalled();

    projects.mockImplementation(async (opts?: { archived?: boolean }) =>
      opts?.archived ? [] : [{ id: "p-1", name: "آزمایش" }]);
    const once = await executeClientTool("delete_project", { project: "آزمایش" }, ctx);
    expect(once.ok).toBe(true);
    expect(deleteProject).toHaveBeenCalledWith("p-1");
  });

  /*
   * A FOLDER IS NOT A PROJECT (user, 2026-09-06). A project owns a folder of
   * its own name, so the two are told apart by WHICH LIST the name is
   * resolved against — and the card lands in the project's folder, with its
   * person, in the one create the board's own dialog makes.
   */
  it("create_task files the card in the PROJECT's folder and hands it to the person, in one create", async () => {
    projects.mockResolvedValue([{ id: "p-1", name: "دیتابیس صوتی", topic_id: "tp-9" }]);
    taskBoard.mockResolvedValue({
      columns: [{ id: "c-1", name: "برای انجام" }, { id: "c-2", name: "در حال انجام" }],
      topics: [{ id: "tp-9", name: "دیتابیس صوتی" }, { id: "tp-2", name: "شخصی" }],
      tasks: [],
    });
    orgPeople.mockResolvedValue([{ id: "u-2", display_name: "سینا", display_name_en: null, username: "sina" }]);
    createTask.mockResolvedValue({ id: "t-1" });
    const { ctx } = surface();
    const result = await executeClientTool(
      "create_task", { title: "جمع‌آوری صدای خام", project: "دیتابیس صوتی", assignee: "@sina", column: "در حال انجام" }, ctx,
    );
    expect(result.ok, result.detail).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "جمع‌آوری صدای خام", topic_id: "tp-9", column_id: "c-2", assignees: ["u-2"],
    }));
    expect(result.detail).toContain("دیتابیس صوتی");
    expect(result.detail).toContain("سینا");
  });

  it("an unknown project refuses and NAMES the projects — it never files the card under a folder that merely sounds alike", async () => {
    projects.mockResolvedValue([{ id: "p-1", name: "الف", topic_id: "tp-1" }]);
    taskBoard.mockResolvedValue({ columns: [{ id: "c-1", name: "برای انجام" }], topics: [{ id: "tp-x", name: "ب" }], tasks: [] });
    const { ctx } = surface();
    const result = await executeClientTool("create_task", { title: "x", project: "ب" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("الف");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("`folder` resolves against the board's own folders, and a person nobody matches refuses the whole create", async () => {
    taskBoard.mockResolvedValue({ columns: [{ id: "c-1", name: "برای انجام" }], topics: [{ id: "tp-2", name: "شخصی" }], tasks: [] });
    orgPeople.mockResolvedValue([{ id: "u-2", display_name: "سینا", display_name_en: null, username: "sina" }]);
    createTask.mockResolvedValue({ id: "t-2" });
    const { ctx } = surface();
    const filed = await executeClientTool("create_task", { title: "یادداشت", folder: "شخصی" }, ctx);
    expect(filed.ok).toBe(true);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ topic_id: "tp-2", column_id: "c-1" }));
    expect(projects, "a folder is resolved on the board, not among the projects").not.toHaveBeenCalled();

    const orphan = await executeClientTool("create_task", { title: "y", assignee: "کسی" }, ctx);
    expect(orphan.ok).toBe(false);
    expect(createTask, "an unresolved person filed an unowned card").toHaveBeenCalledTimes(1);
  });

  /**
   * A COLLEAGUE IS AN ACCOUNT (db/0202, user directive 2026-09-06: "the
   * agents add members based on the knowledge that they have and their
   * names ... in case of adding members to a task or invitation for chat or
   * meetings those names are useless and the user name and member name in
   * user management should be used").
   *
   * `invite_to_meeting` used to write whatever string the model produced
   * into `meeting.invitees` — a name on a list, no account, nobody told —
   * so an agent could add «دکتر باقری» to a meeting that already had
   * «drbagheri» on it and report success.
   */
  it("invite_to_meeting adds a colleague BY ACCOUNT and never writes their name down", async () => {
    orgPeople.mockResolvedValue([
      { id: "u-2", display_name: "سینا سپاسی", display_name_en: "Sina Sepasi", username: "sina" },
    ]);
    addMeetingAttendees.mockResolvedValue({ id: "m-1" });
    const { ctx } = surface();
    const result = await executeClientTool(
      "invite_to_meeting", { meeting_id: "m-1", invitees: ["@sina"] }, ctx,
    );
    expect(result.ok, result.detail).toBe(true);
    expect(addMeetingAttendees).toHaveBeenCalledWith("m-1", ["u-2"]);
    /* the text array is for people with NO account — a colleague must never
       reach it, which is the defect this replaced */
    expect(updateMeeting).not.toHaveBeenCalled();
    /* and the person is named BACK: "invited 1" is a success report you
       cannot check */
    expect(result.detail).toContain("سینا سپاسی");
  });

  it("a name that matches no member REFUSES and names the near misses — it is never written down as an invitee", async () => {
    orgPeople.mockResolvedValue([
      { id: "u-2", display_name: "سینا سپاسی", display_name_en: null, username: "sina" },
    ]);
    /*
     * THE WRITE PATH IS OPEN ON PURPOSE. Without these, a version that DID
     * write the unmatched name down still failed — on an unmocked read
     * throwing — and the test reported the refusal it was written for while
     * measuring a broken fixture. Verify-red caught it: the mutation stayed
     * green. The fixture has to let the wrong answer succeed, or it cannot
     * tell the two apart.
     */
    meetingDetail.mockResolvedValue({ id: "m-1", invitees: [] });
    updateMeeting.mockResolvedValue({ id: "m-1" });
    const { ctx } = surface();
    const result = await executeClientTool(
      "invite_to_meeting", { meeting_id: "m-1", invitees: ["سینا سپاسی نژاد"] }, ctx,
    );
    expect(result.ok).toBe(false);
    expect(addMeetingAttendees).not.toHaveBeenCalled();
    expect(updateMeeting).not.toHaveBeenCalled();
  });

  it("an EMAIL still reaches the text list, appended to what is already there", async () => {
    /* somebody with no account here has no row to add, which is the whole
       reason 0145's text array survives — and the read is what makes this
       an ADD rather than a whole-array write that uninvites everybody */
    orgPeople.mockResolvedValue([]);
    meetingDetail.mockResolvedValue({ id: "m-1", invitees: ["old@example.com"] });
    updateMeeting.mockResolvedValue({ id: "m-1" });
    const { ctx } = surface();
    const result = await executeClientTool(
      "invite_to_meeting", { meeting_id: "m-1", invitees: ["new@example.com"] }, ctx,
    );
    expect(result.ok, result.detail).toBe(true);
    expect(updateMeeting).toHaveBeenCalledWith("m-1", { invitees: ["old@example.com", "new@example.com"] });
    expect(addMeetingAttendees).not.toHaveBeenCalled();
  });

  it("update_task_topic renames a folder by its current name, and names the folders when none matches", async () => {
    taskBoard.mockResolvedValue({ columns: [], topics: [{ id: "tp-1", name: "فروش" }], tasks: [] });
    const { ctx } = surface();
    const renamed = await executeClientTool("update_task_topic", { topic: "فروش", name: "فروش ۱۴۰۵" }, ctx);
    expect(renamed.ok).toBe(true);
    expect(updateTaskTopic).toHaveBeenCalledWith("tp-1", { name: "فروش ۱۴۰۵" });

    const missing = await executeClientTool("update_task_topic", { topic: "بازاریابی", name: "x" }, ctx);
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain("فروش");
  });
});

describe("a name resolves exactly or not at all (2026-09-06, the check-up)", () => {
  beforeEach(() => {
    members.mockReset(); orgPeople.mockReset(); meetings.mockReset();
    sendMemberMessage.mockReset(); setUserStatus.mockReset(); taskBoard.mockReset();
  });

  it("a lone PARTIAL match is not a person — «ali» with only Alireza refuses and names the candidate", async () => {
    /* the server's search is a prefix filter, and this used to accept its
       single row whatever it was; the consent card names the handle the
       model PASSED, so the yes covered somebody else */
    const { ctx } = surface();
    members.mockResolvedValue([{ id: "u-1", username: "alireza", email: "a@x.ir", display_name: "علیرضا" }]);
    const result = await executeClientTool("set_member_status", { member: "ali", status: "disabled" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("@alireza");
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  it("a message goes only to an EXACT colleague; a substring names the closest and sends nothing", async () => {
    const { ctx } = surface();
    orgPeople.mockResolvedValue([{ id: "u-2", display_name: "سینا محمدی", display_name_en: null, username: "sina" }]);
    const loose = await executeClientTool("send_member_message", { member: "سینا", message: "سلام" }, ctx);
    expect(loose.ok).toBe(false);
    expect(loose.detail).toContain("@sina");
    expect(sendMemberMessage).not.toHaveBeenCalled();
    /* THE CONTROL: the handle is exact, and the message goes */
    sendMemberMessage.mockResolvedValue(undefined);
    const exact = await executeClientTool("send_member_message", { member: "@sina", message: "سلام" }, ctx);
    expect(exact.ok, exact.detail).toBe(true);
    expect(sendMemberMessage).toHaveBeenCalledWith("u-2", "سلام");
  });

  it("open_meeting: one partial title opens, several ask by name — never the first of the list", async () => {
    const { ctx, push } = surface();
    meetings.mockResolvedValue([
      { id: "m-1", title: "جلسهٔ هفتگی تیم" },
      { id: "m-2", title: "جلسهٔ هفتگی مدیران" },
      { id: "m-3", title: "بودجه" },
    ]);
    const several = await executeClientTool("open_meeting", { meeting: "هفتگی" }, ctx);
    expect(several.ok).toBe(false);
    expect(several.detail).toContain("جلسهٔ هفتگی تیم");
    expect(several.detail).toContain("جلسهٔ هفتگی مدیران");
    expect(push).not.toHaveBeenCalled();
    const one = await executeClientTool("open_meeting", { meeting: "بودج" }, ctx);
    expect(one.ok).toBe(true);
    expect(push).toHaveBeenCalledWith("/meetings/m-3");
  });

  it("list_task_columns asks for an UNSEEDED board — a read tool must not write", async () => {
    const { ctx } = surface();
    taskBoard.mockResolvedValue({ columns: [], topics: [], tasks: [] });
    const result = await executeClientTool("list_task_columns", {}, ctx);
    expect(result.ok).toBe(true);
    expect(taskBoard).toHaveBeenCalledWith({ seed: false });
  });
});

/**
 * THE RECORD EDITS THAT REPLACED THE PROPOSALS (2026-09-06). `correct_transcript`
 * and `edit_summary` were server-side write tools whose result was a card in
 * the thread and a confirm route; they are hands now — the person's own
 * segment edit and summary version, on their own session, behind the consent
 * card like every other write. The assertions are the seam: the right api
 * method with the resolved record, and a refusal that performs nothing.
 */
describe("correct_transcript and edit_summary — the person's own record edits", () => {
  beforeEach(() => {
    listCalls.mockReset();
    editSegment.mockReset();
    editSummary.mockReset();
    listCalls.mockResolvedValue([{ id: "c-1", title: "call 3" }]);
  });

  it("correct_transcript resolves the record and edits ONE segment through the person's route", async () => {
    const { ctx } = surface();
    editSegment.mockResolvedValue(undefined);
    const result = await executeClientTool("correct_transcript", { record: "call 3", segment_id: "s-9", text: "پروژهٔ نورای" }, ctx);
    expect(result.ok).toBe(true);
    expect(editSegment).toHaveBeenCalledWith("c-1", "s-9", "پروژهٔ نورای");
  });

  it("an empty correction edits nothing — a blank line is a deletion wearing an edit", async () => {
    const { ctx } = surface();
    const result = await executeClientTool("correct_transcript", { record: "call 3", segment_id: "s-9", text: "   " }, ctx);
    expect(result.ok).toBe(false);
    expect(editSegment).not.toHaveBeenCalled();
  });

  it("edit_summary writes a new version and says which", async () => {
    const { ctx } = surface();
    editSummary.mockResolvedValue({ version: 4 });
    const result = await executeClientTool("edit_summary", { record: "call 3", body: "خلاصهٔ تازه" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("4");
    expect(editSummary).toHaveBeenCalledWith("c-1", "خلاصهٔ تازه");
  });

  it("a record the person cannot see refuses before any edit", async () => {
    const { ctx } = surface();
    listCalls.mockResolvedValue([]);
    const result = await executeClientTool("edit_summary", { record: "call 3", body: "x" }, ctx);
    expect(result.ok).toBe(false);
    expect(editSummary).not.toHaveBeenCalled();
  });
});

/**
 * THE CONNECTORS' HANDS (2026-09-06). Each is one action on an outside
 * service through the person's own grant, reached through the BFF's action
 * door. The seam is the assertion — provider, action and the arguments as
 * core's registry names them — plus the two refusals only this side can make
 * before anything is spent: an MCP arguments string that is not a JSON
 * object, and a provider the person never connected (a 404), which must read
 * as an offer of the integrations page rather than as a failure.
 */
describe("the connectors' hands — one action through the person's own grant", () => {
  /* BRACES, not an expression body: `mockReset()` returns the mock, and a
     function returned from beforeEach is a CLEANUP vitest calls after the
     test — which invoked the mock once more with nobody awaiting it, and the
     refusal case below failed with its own fixture's rejection while the
     executor had answered correctly. */
  beforeEach(() => { connectorAction.mockReset(); });

  it("send_slack_message posts through slack's send_message with channel and text", async () => {
    const { ctx } = surface();
    connectorAction.mockResolvedValue({ channel: "C123", ts: "1725000000.000100" });
    const result = await executeClientTool("send_slack_message", { channel: "#general", text: "سلام تیم" }, ctx);
    expect(connectorAction).toHaveBeenCalledWith("slack", "send_message", { channel: "#general", text: "سلام تیم" });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("1725000000.000100");
  });

  it("create_jira_issue and create_github_issue reach their own doors and relay the reference", async () => {
    const { ctx } = surface();
    connectorAction.mockResolvedValueOnce({ key: "NEU-42", url: "https://neurai.atlassian.net/browse/NEU-42" });
    const jira = await executeClientTool("create_jira_issue", { project: "NEU", summary: "باگ ورود" }, ctx);
    expect(connectorAction).toHaveBeenCalledWith("jira", "create_issue", { project: "NEU", summary: "باگ ورود" });
    expect(jira.ok).toBe(true);
    expect(jira.detail).toContain("NEU-42");

    connectorAction.mockResolvedValueOnce({ number: 7, url: "https://github.com/o/r/issues/7" });
    const github = await executeClientTool("create_github_issue", { repository: "o/r", title: "خطا", body: " " }, ctx);
    /* a blank optional is not sent — the registry would store an empty body */
    expect(connectorAction).toHaveBeenLastCalledWith("github", "create_issue", { repository: "o/r", title: "خطا" });
    expect(github.detail).toContain("#7");
  });

  it("call_mcp_tool parses arguments_json into an object, and refuses what is not one BEFORE any call", async () => {
    const { ctx } = surface();
    const notJson = await executeClientTool("call_mcp_tool", { tool: "search", arguments_json: "{oops" }, ctx);
    expect(notJson.ok).toBe(false);
    const notObject = await executeClientTool("call_mcp_tool", { tool: "search", arguments_json: "[1,2]" }, ctx);
    expect(notObject.ok).toBe(false);
    expect(connectorAction).not.toHaveBeenCalled();

    connectorAction.mockResolvedValue({ text: "3 results", is_error: false });
    const ok = await executeClientTool("call_mcp_tool", { tool: "search", arguments_json: "{\"q\":\"نورای\"}" }, ctx);
    expect(connectorAction).toHaveBeenCalledWith("mcp", "call_tool", { tool: "search", arguments: { q: "نورای" } });
    expect(ok.ok).toBe(true);
    expect(ok.detail).toBe("3 results");

    /* the remote tool's own error is a refusal, carried in its words */
    connectorAction.mockResolvedValue({ text: "index offline", is_error: true });
    const failed = await executeClientTool("call_mcp_tool", { tool: "search" }, ctx);
    expect(failed.ok).toBe(false);
    expect(failed.detail).toBe("index offline");
  });

  it("a provider the person never connected reads as an offer of the integrations page, not a failure", async () => {
    const { ctx } = surface();
    /* rejected at CALL time, as the wire does — a promise rejected when the
       mock is armed is an unhandled rejection by the time the executor's
       dynamic import of the client resolves, and vitest fails the test with
       the fixture's own error rather than with what the code did */
    connectorAction.mockImplementation(async () => { throw Object.assign(new Error("not found"), { status: 404 }); });
    const result = await executeClientTool("send_telegram_message", { chat: "@neurai", text: "x" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("telegram");
    expect(result.detail).toContain("/integrations");
  });
});

/**
 * translate_record after C4 (2026-09-06): the SUMMARY's translation is text
 * the model receives; the TRANSCRIPT's is a job — the seam asserts which
 * door was opened and that the model is told to send the person to the
 * record rather than being handed a sentence that is not there yet.
 */
describe("translate_record — text for the summary, a job for the transcript", () => {
  beforeEach(() => {
    listCalls.mockReset();
    translateCall.mockReset();
    listCalls.mockResolvedValue([{ id: "c-1", title: "call 3" }]);
  });

  it("returns the summary's translated text", async () => {
    const { ctx } = surface();
    translateCall.mockResolvedValue({ text: "Budget for next year", model: "m" });
    const result = await executeClientTool("translate_record", { record: "call 3", what: "summary" }, ctx);
    expect(translateCall).toHaveBeenCalledWith("c-1", "summary");
    expect(result).toEqual({ ok: true, detail: "Budget for next year" });
  });

  it("asks for the transcript's translation as a job and says it is being prepared — or ready", async () => {
    const { ctx } = surface();
    translateCall.mockResolvedValue({ status: "queued", language: "en" });
    const queued = await executeClientTool("translate_record", { record: "call 3", what: "transcript" }, ctx);
    expect(translateCall).toHaveBeenCalledWith("c-1", "transcript");
    expect(queued.ok).toBe(true);
    expect(queued.detail).toContain("being prepared");

    translateCall.mockResolvedValue({ status: "ready", language: "en" });
    const ready = await executeClientTool("translate_record", { record: "call 3", what: "transcript" }, ctx);
    expect(ready.detail).toContain("ready");
  });
});
