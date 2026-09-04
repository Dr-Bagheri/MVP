/**
 * CLIENT TOOLS (proposed M33) — the agent's hands on the product surface.
 *
 * A client tool is executed by the WEB CLIENT, in the user's browser, under
 * the user's own live session, through the same code path the human control
 * uses. The runtime never performs the action: it streams a
 * `client_tool_call` SSE event, and the tool's run() suspends on a broker
 * until the surface POSTs the result back (/v1/assistant/tool-result) or the
 * wait times out. The agent gains REACH, never AUTHORITY — invariant 3 is
 * not merely preserved by this design, it is the mechanism.
 *
 * Rules (M33 clauses, enforced here):
 *  - One executor per tool: everything in this registry is client-executed.
 *  - Client tools sit OUTSIDE skill declarations: a skill governs content
 *    reach; the surface's controls are governed by the autonomy dial plus
 *    what the surface ADVERTISED on this very request (`client_tools` in
 *    the ask body). A tool not advertised is never offered — an agent must
 *    not call a UI tool into a surface that cannot perform it (gateway/API
 *    callers advertise none and get none).
 *  - Effect classes decide consent: "ui" runs directly in assist mode;
 *    "write" carries requires_consent until Act (Phase C). DELETE stays
 *    out of this registry; finish_recording and the member-admin tools
 *    joined by user directive (2026-08-21: "anything the user can do or
 *    click it must be able to do as well") — every one still runs through
 *    the person's own session, so the caller's ROLE is the wall: a
 *    member's browser asking to disable an account gets the same 403 the
 *    member's own click would.
 *  - A refusal is a RESULT: mic denied, user declined, tab closed — the
 *    run continues and says so (M21: forfeits are loud, never silent).
 *  - Steps: client tools pass through the same wrapTools() wrapper as every
 *    domain tool, so each attempt lands in agent_run.steps and the audit
 *    sees ONE run.
 *
 * The broker is in-process state (this api runs as one process — see the
 * runbook's infra map). If the api is ever scaled horizontally, pending
 * calls need a shared home; the broker is the seam.
 */
import { randomUUID } from "node:crypto";
import type { DomainTool } from "./tools.ts";

/*
 * Parameters are PLAIN JSON Schema literals, deliberately not TypeBox: this
 * registry is module-level, and several suites mock ./pi.ts without its
 * Type export — a top-level Type.Object() call made importing this file
 * throw inside any such suite. TypeBox emits exactly these objects anyway;
 * writing them out removes the import-time dependency.
 */
const str = (description?: string): Record<string, unknown> =>
  ({ type: "string", ...(description ? { description } : {}) });
const strEnum = (values: readonly string[], description?: string): Record<string, unknown> =>
  ({ type: "string", enum: [...values], ...(description ? { description } : {}) });
const bool = (description?: string): Record<string, unknown> =>
  ({ type: "boolean", ...(description ? { description } : {}) });
const num = (description?: string): Record<string, unknown> =>
  ({ type: "number", ...(description ? { description } : {}) });
const arr = (description?: string): Record<string, unknown> =>
  ({ type: "array", items: { type: "string" }, ...(description ? { description } : {}) });
const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> =>
  ({ type: "object", properties, ...(required.length ? { required } : {}) });

export type ClientToolEffect = "ui" | "write";

export interface ClientToolSpec {
  name: string;
  /** shown to the person as "what the assistant is doing" — in THEIR
      language (user directive, 2026-08-21: the chips read Persian on the
      English UI); the ask's locale picks the side */
  label: { fa: string; en: string };
  description: string;
  parameters: unknown;
  effect: ClientToolEffect;
}

/** v1 registry. */
export const CLIENT_TOOLS: readonly ClientToolSpec[] = [
  {
    name: "navigate",
    label: { fa: "رفتن به صفحه", en: "Navigating" },
    /*
     * The route MAP lives in the description and the enum, deliberately:
     * without it the model guessed — "archive of calls" landed on /echo/calls
     * and "users" landed on /settings (user report, 2026-08-21). A closed
     * enum makes a wrong destination unrepresentable; the meanings make the
     * right one findable. Every entry must stay inside the web surface's
     * NAVIGABLE allow-list (web/src/lib/agentSurface.ts) — the executor
     * still refuses anything else.
     */
    description:
      "Navigate the user's screen to a page. Destinations: "
      + "/ = home dashboard. "
      + "/assistant = this assistant's own full-page conversation. "
      + "/meetings = MEETINGS — the product's meetings: plan one, run it, its "
      + "minutes and decisions. This is where a meeting lives. "
      + "/tasks = the task board. "
      + "/echo = start a RECORDING in the browser or upload an audio file. "
      + "A recording is not a meeting: use /meetings for a meeting. "
      + "/echo/records = the recorded calls. "
      + "/echo/summaries = summaries of the recordings, gathered for reading. "
      + "/echo/archive = archived records. "
      + "/conversations = past assistant conversations (history). "
      + "/search = transcript search. "
      + "/workflows = workflows. /agents = the agents and their profiles. "
      + "/integrations = connected services (Google and the rest). "
      + "/profile = the signed-in person's own profile. "
      + "/management/users = people, roles and invitations. "
      + "/management/speakers = the speaker directory. "
      + "/management/skills = assistant skills. /management/models = AI models. "
      + "/management/workflows = the organization's workflows. "
      + "/management/privileges = what each role may do. "
      + "/management/connectors = calendar/mail connectors (admin). "
      + "/management/general = the organization's own record. "
      + "/management/server = server status (admin). "
      + "/settings/general = general settings. "
      + "/settings/assistant = assistant settings (voice, agent web access). "
      + "/settings/security = security. /settings/audit-logs = audit logs. ",
    parameters: obj({
      /*
       * REBUILT FROM THE ROUTE TREE (user report, 2026-09-04: "i asked roya to
       * start a meeting but it went to echo platform that we already removed").
       *
       * The enum predated meetings, tasks and integrations entirely, so the
       * closest thing to "start a meeting" the model could reach was /echo —
       * the RECORDER. It obeyed the map it was given and the map was three
       * months old.
       *
       * `/echo/speakers` is gone from the list too: that address redirects to
       * /management/speakers now, and a destination that bounces is a tool
       * that half-works. `route-map.test.ts` compares this enum against the
       * actual app directory, which is what would have caught all of it.
       */
      path: strEnum([
        "/", "/assistant", "/meetings", "/tasks",
        "/echo", "/echo/records", "/echo/summaries", "/echo/archive",
        "/conversations", "/search", "/workflows", "/agents", "/integrations",
        "/profile",
        "/management/users", "/management/speakers", "/management/skills",
        "/management/models", "/management/workflows", "/management/privileges",
        "/management/connectors", "/management/general", "/management/server",
        "/settings/general", "/settings/assistant",
        "/settings/security", "/settings/audit-logs",
      ], "The destination route."),
    }, ["path"]),
    effect: "ui",
  },
  {
    name: "start_recording",
    label: { fa: "شروع ضبط", en: "Starting a recording" },
    description:
      "Start recording a new call through the user's microphone, optionally "
      + "with a title. The user's surface performs it and may ask them to "
      + "allow it first.",
    parameters: obj({ title: str("Title for the new call.") }),
    effect: "write",
  },
  {
    name: "pause_recording",
    label: { fa: "توقف موقت ضبط", en: "Pausing the recording" },
    description: "Pause the recording currently in progress on the user's screen.",
    parameters: obj({}),
    effect: "ui",
  },
  {
    name: "resume_recording",
    label: { fa: "ادامهٔ ضبط", en: "Resuming the recording" },
    description: "Resume the paused recording on the user's screen.",
    parameters: obj({}),
    effect: "ui",
  },
  {
    name: "open_call",
    label: { fa: "بازکردن جلسه", en: "Opening a record" },
    description: "Open one call's detail page on the user's screen.",
    parameters: obj({ call_id: str() }, ["call_id"]),
    effect: "ui",
  },
  {
    name: "set_search",
    label: { fa: "جست‌وجو در صفحه", en: "Searching" },
    description: "Run a search in the product UI and show the results page.",
    parameters: obj({ query: str() }, ["query"]),
    effect: "ui",
  },
  {
    name: "set_language",
    label: { fa: "تغییر زبان", en: "Switching language" },
    description:
      "Switch the platform interface language — fa (Persian) or en "
      + "(English). Use when the user asks to change the platform/UI "
      + "language or version.",
    parameters: obj({
      language: strEnum(["fa", "en"], "fa = Persian, en = English."),
    }, ["language"]),
    effect: "ui",
  },
  {
    name: "finish_recording",
    label: { fa: "پایان ضبط", en: "Finishing the recording" },
    description:
      "Finish the recording in progress on the user's screen and hand it to "
      + "processing (transcription and summary). Use when the user asks to "
      + "finish, stop or end the recording.",
    parameters: obj({}),
    effect: "write",
  },
  {
    name: "set_member_status",
    label: { fa: "تغییر وضعیت عضو", en: "Changing a member's status" },
    description:
      "Enable or disable a member's account, exactly as the management "
      + "screen's own button would. Identify the member by username, display "
      + "name or email. The platform enforces the CALLER's role — a "
      + "non-admin's request is refused by the server, not by you.",
    parameters: obj({
      member: str("Username, display name or email of the member."),
      status: strEnum(["active", "disabled"], "active = enable, disabled = disable."),
    }, ["member", "status"]),
    effect: "write",
  },
  /*
   * The record-row actions (user directive, 2026-08-21 round 2: "for any
   * action in tables — rename, delete, edit, any button we have").
   * `record` = a title or an id; the surface resolves it against the same
   * list the table shows and REFUSES ambiguity. delete here is M11's soft
   * delete — hidden at once, restorable for 30 days; the purge that
   * destroys remains nobody's tool.
   */
  {
    name: "rename_record",
    label: { fa: "تغییر نام ضبط", en: "Renaming a record" },
    description:
      "Rename a record (recorded call). Identify it by its current title or id.",
    parameters: obj({
      record: str("Current title or id of the record."),
      title: str("The new title."),
    }, ["record", "title"]),
    effect: "write",
  },
  {
    name: "set_record_scope",
    label: { fa: "تغییر محدودهٔ ضبط", en: "Changing a record's scope" },
    description:
      "Set a record private or shared with the organization — the row's own "
      + "scope toggle.",
    parameters: obj({
      record: str("Title or id of the record."),
      scope: strEnum(["private", "org"], "private = only the owner; org = the organization."),
    }, ["record", "scope"]),
    effect: "write",
  },
  {
    name: "archive_record",
    label: { fa: "بایگانی ضبط", en: "Archiving a record" },
    description: "Move a record to the archive (reversible).",
    parameters: obj({ record: str("Title or id of the record.") }, ["record"]),
    effect: "write",
  },
  {
    name: "unarchive_record",
    label: { fa: "خروج از بایگانی", en: "Unarchiving a record" },
    description: "Bring a record back from the archive to the records list.",
    parameters: obj({ record: str("Title or id of the record.") }, ["record"]),
    effect: "write",
  },
  {
    name: "delete_record",
    label: { fa: "حذف ضبط", en: "Deleting a record" },
    description:
      "Soft-delete a record: hidden immediately, restorable for 30 days "
      + "(the table's own Delete button). Never a permanent purge.",
    parameters: obj({ record: str("Title or id of the record.") }, ["record"]),
    effect: "write",
  },
  {
    name: "restore_record",
    label: { fa: "بازگردانی ضبط", en: "Restoring a record" },
    description: "Restore a soft-deleted record within its 30-day window.",
    parameters: obj({ record: str("Title or id of the record.") }, ["record"]),
    effect: "write",
  },
  {
    name: "delete_conversation",
    label: { fa: "حذف گفتگو", en: "Removing a conversation" },
    description:
      "Remove a conversation from the assistant history (archived under the "
      + "hood — the audit record survives). Identify it by its title.",
    parameters: obj({ conversation: str("Title of the conversation.") }, ["conversation"]),
    effect: "write",
  },
  {
    name: "add_speaker_person",
    label: { fa: "افزودن گوینده", en: "Adding a person" },
    description:
      "Add a person to the speakers directory, with an optional role title.",
    parameters: obj({
      name: str("The person's display name."),
      title: str("Their role title (optional)."),
    }, ["name"]),
    effect: "write",
  },
  {
    name: "set_member_role",
    label: { fa: "تغییر نقش عضو", en: "Changing a member's role" },
    description:
      "Change a member's role between member and admin, exactly as the "
      + "management screen would. Identify the member by username, display "
      + "name or email. The platform enforces the CALLER's role — a "
      + "non-admin's request is refused by the server.",
    parameters: obj({
      member: str("Username, display name or email of the member."),
      role: strEnum(["member", "admin"], "The role to grant."),
    }, ["member", "role"]),
    effect: "write",
  },
  {
    /**
     * SEND A COLLEAGUE A MESSAGE (user directive, 2026-09-03: "if they asked
     * to give messages to some one else in the platform they can").
     *
     * A CLIENT tool, not a server one, and that is the whole design. The
     * message is written by db/0167's definer door, which stamps the sender
     * from the session's actor — so routing it through the browser means the
     * sender is the person who approved it, established by the database rather
     * than asserted by a prompt. A server-side tool would have the model's run
     * as the actor, and "Roya says X" would arrive wearing your name with
     * nothing in the system able to tell the difference.
     *
     * `effect: "write"` earns it a consent card before anything is sent, which
     * is the user's own ruling for this pair: auto for reads, approval for
     * writes. A message to a colleague is the most outward-facing write this
     * surface has — it reaches another person's attention and cannot be taken
     * back — so it is exactly the wrong one to make an exception for.
     */
    name: "send_member_message",
    label: { fa: "فرستادن پیام به همکار", en: "Sending a colleague a message" },
    description:
      "Send a short message to another member of this organization. It arrives "
      + "in their notifications, from the user — not from you. Identify the "
      + "recipient by username, display name or email; use list_members first "
      + "if you are not certain who is meant. The user is asked to approve the "
      + "exact text before it is sent, so write the message you mean to send.",
    parameters: obj({
      member: str("Username, display name or email of the recipient."),
      message: str("The message, in the user's own voice. Up to 2000 characters."),
    }, ["member", "message"]),
    effect: "write",
  },
  {
    /*
     * THE THING ITSELF, not the page near it (user report, 2026-09-04: "i
     * asked roya to start a meeting but it went to echo platform").
     *
     * There was no tool for creating a meeting, so the best a model could do
     * with "start a meeting" was navigate somewhere plausible — and the
     * closest destination in its map was the RECORDER. A capability the
     * product has and the agents cannot reach is how an agent ends up doing
     * something adjacent and calling it done.
     */
    name: "create_meeting",
    label: { fa: "ساختن جلسه", en: "Creating a meeting" },
    description:
      "Create a meeting in the product and open it. This is what 'start a "
      + "meeting', 'set up a meeting' or 'book a call' means — NOT a recording. "
      + "Give a title; the time is optional and defaults to now, which is right "
      + "for a meeting somebody is about to hold.",
    parameters: obj({
      title: str("What the meeting is called."),
      when: str("ISO 8601 start time. Omit for a meeting starting now."),
      mode: strEnum(["online", "in_person"], "How it is held. Defaults to online."),
      /* names or addresses, not ids: an invitee may be somebody with no row
         here at all, which is why the meeting stores text (db/0145) */
      invitees: arr("Who is coming — colleagues by name, or email addresses for people outside the organisation."),
    }, ["title"]),
    effect: "write",
  },
  {
    name: "create_task",
    label: { fa: "ساختن تسک", en: "Creating a task" },
    description:
      "Add a card to the task board and open it. Use it when the user asks for "
      + "something to be tracked, assigned or remembered as work — not for a "
      + "note to themselves, which belongs on the record it is about.",
    parameters: obj({
      title: str("The task, in a few words."),
      description: str("Anything the person doing it needs. Optional."),
      due: str("ISO 8601 deadline. Optional."),
      /*
       * ONE STEP, not two. "Make a task for Sina" is a single sentence and it
       * should be a single act — creating and then telling the person to open
       * the board and assign it themselves is the product asking them to
       * finish its job. `assign_task` still exists for a task that already
       * exists; this is for the one being made.
       */
      assignee: str("Who it is for — a colleague's id from list_members. Optional."),
    }, ["title"]),
    effect: "write",
  },
  /*
   * ── EVERYTHING A PERSON CAN DO (M49, user directive 2026-09-04) ────────
   *
   * "Anything that a human can do on this platform, these 3 must do."
   *
   * WHY THESE ARE CLIENT TOOLS and not server ones, which is the whole
   * architectural answer to that directive:
   *
   * A server-side tool runs as `echo_agent`, a deliberately narrow role that
   * holds no DELETE anywhere, cannot write a task or a meeting, and cannot
   * change a member's role. Giving it those grants would move a wall that
   * three standing tests exist to hold. A CLIENT tool runs in the browser, as
   * the signed-in person, through the same BFF route their own click uses —
   * so the agent's reach is exactly the reach of whoever asked, which is M3's
   * sentence ("the agent borrows the caller's authority and never more")
   * expressed as a code path rather than as a promise.
   *
   * The honest cost, said out loud: a client tool needs a browser. An
   * unattended run — a workflow at 3am, the mail poller — is offered none of
   * these, so what an agent can do while nobody is watching stays smaller
   * than what it can do in a conversation. That is a real limit, not an
   * oversight, and closing it means minting definer doors one at a time with
   * a reason each, not widening a role.
   *
   * `effect: "write"` on everything that changes data: the surface decides
   * whether to ask first, and the server's own `requires_consent` still
   * governs what it sends.
   */

  // ── tasks ────────────────────────────────────────────────────────────
  {
    name: "complete_task",
    label: { fa: "بستن تسک", en: "Completing a task" },
    description:
      "Mark a task done, or reopen one. Use the id from list_tasks or get_task.",
    parameters: obj({
      task_id: str("The task's id."),
      done: bool("true to complete it, false to reopen. Defaults to true."),
    }, ["task_id"]),
    effect: "write",
  },
  {
    name: "assign_task",
    label: { fa: "واگذاری تسک", en: "Assigning a task" },
    description:
      "Give a task to a colleague, or take them off it. `user_id` comes from "
      + "list_members or list_colleagues — never guess one from a name.",
    parameters: obj({
      task_id: str("The task's id."),
      user_id: str("The colleague's id."),
      assigned: bool("false to remove them. Defaults to true."),
    }, ["task_id", "user_id"]),
    effect: "write",
  },
  {
    name: "update_task",
    label: { fa: "ویرایش تسک", en: "Updating a task" },
    description:
      "Change a task's title, description, priority or deadline. Send only "
      + "the fields being changed; anything omitted is left alone.",
    parameters: obj({
      task_id: str("The task's id."),
      title: str("A new title."),
      description: str("A new description."),
      priority: strEnum(["low", "medium", "high", "critical"], "How urgent it is."),
      due: str("ISO 8601 deadline."),
    }, ["task_id"]),
    effect: "write",
  },
  {
    name: "comment_on_task",
    label: { fa: "یادداشت روی تسک", en: "Commenting on a task" },
    description:
      "Add a comment to a task. Comments are append-only — nobody can edit or "
      + "delete one afterwards, including you, so write it as a record.",
    parameters: obj({
      task_id: str("The task's id."),
      body: str("What to say."),
    }, ["task_id", "body"]),
    effect: "write",
  },
  {
    name: "add_task_checklist_item",
    label: { fa: "افزودن به چک‌لیست", en: "Adding a checklist item" },
    description: "Add one line to a task's checklist.",
    parameters: obj({
      task_id: str("The task's id."),
      label: str("The item."),
    }, ["task_id", "label"]),
    effect: "write",
  },
  {
    name: "archive_task",
    label: { fa: "بایگانی تسک", en: "Archiving a task" },
    description:
      "Move a task off the board without deleting it. Prefer this to deleting: "
      + "an archived task can be found again and a deleted one cannot.",
    parameters: obj({
      task_id: str("The task's id."),
      archived: bool("false to bring it back. Defaults to true."),
    }, ["task_id"]),
    effect: "write",
  },

  // ── meetings ─────────────────────────────────────────────────────────
  {
    name: "update_meeting",
    label: { fa: "ویرایش جلسه", en: "Updating a meeting" },
    description:
      "Change a meeting's title, time, location or description. Send only what "
      + "is changing. A meeting whose minutes are CLOSED refuses every change "
      + "except archiving — that is the record of record and it is frozen.",
    parameters: obj({
      meeting_id: str("The meeting's id."),
      title: str("A new title."),
      when: str("ISO 8601 start time."),
      location: str("Where it is held."),
      description: str("What it is about."),
    }, ["meeting_id"]),
    effect: "write",
  },
  {
    name: "add_meeting_item",
    label: { fa: "افزودن مورد به جلسه", en: "Adding a meeting item" },
    description:
      "Record a decision, an action, a question or a risk against a meeting. "
      + "This is how a conversation becomes something somebody can act on.",
    parameters: obj({
      meeting_id: str("The meeting's id."),
      kind: strEnum(["decision", "action", "question", "risk", "entity"], "What kind of item."),
      body: str("The item itself, in one or two sentences."),
      owner: str("Who it belongs to, by name. Optional."),
    }, ["meeting_id", "kind", "body"]),
    effect: "write",
  },
  {
    name: "approve_minutes",
    label: { fa: "تأیید صورت‌جلسه", en: "Approving minutes" },
    description:
      "Approve a meeting's minutes. A person is agreeing that the record is "
      + "right, so do this only when they have said so — never to tidy up.",
    parameters: obj({ meeting_id: str("The meeting's id.") }, ["meeting_id"]),
    effect: "write",
  },
  {
    name: "archive_meeting",
    label: { fa: "بایگانی جلسه", en: "Archiving a meeting" },
    description: "Move a meeting out of the active list. It is not deleted.",
    parameters: obj({
      meeting_id: str("The meeting's id."),
      archived: bool("false to bring it back. Defaults to true."),
    }, ["meeting_id"]),
    effect: "write",
  },

  // ── the record ───────────────────────────────────────────────────────
  {
    name: "add_record_note",
    label: { fa: "یادداشت روی رونوشت", en: "Adding a note" },
    description:
      "Attach a note to a record — a correction, a piece of context, something "
      + "the transcript does not say. Notes are append-only.",
    parameters: obj({
      record_id: str("The record's id."),
      body: str("The note."),
      at_ms: num("Where in the recording it belongs, in milliseconds. Optional."),
    }, ["record_id", "body"]),
    effect: "write",
  },
  {
    name: "tag_record",
    label: { fa: "برچسب رونوشت", en: "Tagging a record" },
    description:
      "Replace a record's tags. Send the WHOLE list you want it to end up "
      + "with — this does not add to what is there.",
    parameters: obj({
      record_id: str("The record's id."),
      tags: arr("The complete set of tags."),
    }, ["record_id", "tags"]),
    effect: "write",
  },

  // ── people ───────────────────────────────────────────────────────────
  {
    name: "invite_member",
    label: { fa: "دعوت همکار", en: "Inviting a colleague" },
    description:
      "Invite somebody to this organisation by email. Admin only — the server "
      + "refuses otherwise, and an owner is needed to invite another admin.",
    parameters: obj({
      email: str("Their email address."),
      role: strEnum(["member", "admin"], "What they join as. Defaults to member."),
    }, ["email"]),
    effect: "write",
  },

  // ── workflows ────────────────────────────────────────────────────────
  {
    name: "run_workflow",
    label: { fa: "اجرای گردش‌کار", en: "Running a workflow" },
    description:
      "Start one of this organisation's workflows by its slug or handle. Use "
      + "list_workflows first — a workflow that does not exist is a refusal, "
      + "not a no-op.",
    parameters: obj({
      workflow: str("The workflow's slug or handle."),
    }, ["workflow"]),
    effect: "write",
  },

  // ── conversations ────────────────────────────────────────────────────
  {
    name: "rename_conversation",
    label: { fa: "تغییر نام گفت‌وگو", en: "Renaming this conversation" },
    description:
      "Give this conversation a title. Useful when a thread has drifted from "
      + "the question it was named after.",
    parameters: obj({ title: str("The new title.") }, ["title"]),
    effect: "write",
  },
  {
    name: "invite_to_meeting",
    label: { fa: "دعوت به جلسه", en: "Inviting to a meeting" },
    description:
      "Add people to a meeting's invitee list. Names for colleagues, email "
      + "addresses for anybody outside the organisation. This ADDS — whoever "
      + "is already invited stays invited.",
    parameters: obj({
      meeting_id: str("The meeting's id."),
      invitees: arr("The people to add, by name or email address."),
    }, ["meeting_id", "invitees"]),
    effect: "write",
  },
  {
    name: "open_meeting",
    label: { fa: "بازکردن جلسه", en: "Opening a meeting" },
    description:
      "Open one meeting by its title. Use it to put a meeting on the user's "
      + "screen after you have found it — the read tools give you the title.",
    parameters: obj({
      meeting: str("The meeting's title, as list_meetings returned it."),
    }, ["meeting"]),
    effect: "ui",
  },
] as const;

export const CLIENT_TOOL_NAMES: readonly string[] = CLIENT_TOOLS.map((t) => t.name);

export interface ClientToolResult {
  ok: boolean;
  /** short outcome sentence from the surface — codes/labels, never content */
  detail: string;
}

interface PendingCall {
  resolve: (result: ClientToolResult) => void;
  userId: string;
  timer: ReturnType<typeof setTimeout>;
}

/** call_id → waiter. Module-level: one api process (see header). */
const pending = new Map<string, PendingCall>();

/** How long a surface gets to perform (or decline) before the run moves on. */
export const CLIENT_TOOL_TIMEOUT_MS = 120_000;

/**
 * Deliver a surface's result. Unknown, expired and someone-else's call ids
 * are ONE answer (false) — a call id must not be probeable.
 */
export function deliverClientToolResult(
  callId: string,
  userId: string,
  result: ClientToolResult,
): boolean {
  const entry = pending.get(callId);
  if (!entry || entry.userId !== userId) return false;
  pending.delete(callId);
  clearTimeout(entry.timer);
  entry.resolve({ ok: result.ok === true, detail: String(result.detail ?? "").slice(0, 400) });
  return true;
}

/** visible for tests */
export function pendingClientCalls(): number {
  return pending.size;
}

export interface ClientToolCallEvent {
  type: "client_tool_call";
  id: string;
  tool: string;
  label: string;
  args: unknown;
  effect: ClientToolEffect;
  requires_consent: boolean;
}

/**
 * Build the DomainTools for one request: only the ADVERTISED subset, closed
 * over this run's emitter and the caller's id. `autonomy` decides consent
 * flags; "watch" callers should not reach this at all (the route offers no
 * client tools in watch), but the guard here makes that a property of the
 * code rather than of the caller.
 */
export function createClientTools(
  advertised: readonly string[],
  options: {
    userId: string;
    autonomy: "watch" | "assist" | "act";
    emit: (event: ClientToolCallEvent) => void;
    timeoutMs?: number;
    /** the asker's UI language — the chips must read in it */
    locale?: "fa" | "en" | undefined;
  },
): DomainTool<unknown, never>[] {
  if (options.autonomy === "watch") return [];
  const offered = CLIENT_TOOLS.filter((spec) => advertised.includes(spec.name));
  const timeoutMs = options.timeoutMs ?? CLIENT_TOOL_TIMEOUT_MS;
  const lang = options.locale === "en" ? "en" : "fa";

  return offered.map((spec) => ({
    name: spec.name,
    label: spec.label[lang],
    description: spec.description,
    parameters: spec.parameters,
    async run(_ctx, args): Promise<unknown> {
      const id = randomUUID();
      const result = await new Promise<ClientToolResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          // the surface never answered — tab closed, network gone. A loud
          // forfeit the model can read and relay, never a hang.
          resolve({ ok: false, detail: "the surface did not respond in time" });
        }, timeoutMs);
        pending.set(id, { resolve, userId: options.userId, timer });
        options.emit({
          type: "client_tool_call",
          id,
          tool: spec.name,
          label: spec.label[lang],
          args,
          effect: spec.effect,
          // Act auto-applies org-approved write classes (Phase C); until
          // then every write asks the person, every time.
          requires_consent: spec.effect === "write" && options.autonomy !== "act",
        });
      });
      return { performed: result.ok, detail: result.detail };
    },
  })) as DomainTool<unknown, never>[];
}
