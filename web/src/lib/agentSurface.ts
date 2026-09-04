/**
 * M33 — this surface's half of the client-tool contract.
 *
 * The runtime streams `client_tool_call`; THIS module performs it — under
 * the user's own session, through the same code paths the human controls
 * use — and reports {ok, detail} back. The args are model-authored, so they
 * are validated here exactly as human input would be: an unknown tool, a
 * malformed path, a control that isn't on screen — each is a REFUSAL result
 * the model reads and relays, never a throw and never a silent no-op.
 */
import { recorderControls } from "@/components/echo/recorderControls";
import { announceChange } from "@/lib/refreshBus";
import { liveConversation } from "@/lib/liveConversation";

/** What this web surface advertises on every ask. One list, one truth. */
export const SURFACE_TOOLS: readonly string[] = [
  "navigate",
  "start_recording",
  "pause_recording",
  "resume_recording",
  "open_call",
  "set_search",
  "finish_recording",
  "set_member_status",
  "set_member_role",
  "set_language",
  "rename_record",
  "set_record_scope",
  "archive_record",
  "unarchive_record",
  "delete_record",
  "restore_record",
  "delete_conversation",
  "add_speaker_person",
  "send_member_message",
  "create_meeting",
  "create_task",
  "open_meeting",

  /* ── M49: everything a person can do ─────────────────────────────────
     Each has an executor below and a spec in core's registry; the seam test
     compares the three, so a name added here and nowhere else fails rather
     than being advertised to a model that then calls into nothing. */
  "complete_task",
  "assign_task",
  "update_task",
  "comment_on_task",
  "add_task_checklist_item",
  "archive_task",
  "update_meeting",
  "add_meeting_item",
  "approve_minutes",
  "archive_meeting",
  "add_record_note",
  "tag_record",
  "invite_member",
  "run_workflow",
  "rename_conversation",
  "invite_to_meeting",

  /* ── M50: the rest of what a person can do (user directive) ─────────
     Reads the browser already had, and writes that went through screens
     no tool could reach. Every one runs on the person's own session, so
     the reach grew and the authority did not. */
  "whoami_surface",
  "list_conversations",
  "read_conversation",
  "archive_conversation",
  "share_conversation",
  "list_workflows",
  "list_workflow_runs",
  "set_workflow_enabled",
  "install_workflow_starter",
  "list_skills",
  "list_agents",
  "list_invitations",
  "revoke_invitation",
  "list_connectors",
  "list_notifications",
  "mark_notification_read",
  "list_task_columns",
  "create_task_column",
  "create_task_label",
  "set_task_label",
  "create_task_topic",
  "update_task_checklist_item",
  "update_meeting_item",
  "extract_meeting_items",
  "create_meeting_topic",
  "set_meeting_join_code",
  "resummarize_record",
  "translate_record",
  "retry_record",
  "rename_speaker",
  "link_speaker",
  "create_person",
  "rename_member",
  "list_allowed_models",
  "set_model_allowed",
  "set_role_permission",
];

/** Routes the agent may navigate to — the same set a human can click to. */
/** exported for the seam test: core's navigate enum must stay inside it */
/* the destinations the executor will perform. Kept in step with core's
   `navigate` enum by route-map.test.ts, which checks BOTH against the app
   directory — the pair used to agree with each other and with nothing else. */
export const NAVIGABLE = /^\/(assistant|meetings|tasks|integrations|profile|echo(\/(record|upload|calls|records|summaries|archive))?|workflows|agents|conversations|settings(\/[a-z-]+)?|management(\/[a-z-]+)?|search)?$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SurfaceContext {
  /** locale-aware push — the i18n router's, so /fa|/en is not the tool's problem */
  push: (path: string) => void;
  /** re-render the CURRENT route under the other locale (the top bar's own
      switch mechanism, handed in so the tool cannot invent a second one) */
  switchLocale?: (next: "fa" | "en") => void;
}

export interface SurfaceResult {
  ok: boolean;
  detail: string;
}

/**
 * The member-admin tools identify people the way a PERSON would — by
 * username, display name or email — and resolve through the same
 * server-side member search the management screen uses. Ambiguity is a
 * refusal, never a guess: "disable amir" with two Amirs must not pick one.
 */
async function resolveMember(handle: string): Promise<
  { ok: true; id: string } | { ok: false; detail: string }
> {
  const { api } = await import("@/api/client");
  const rows = await api.members({ search: handle });
  if (rows.length === 1) return { ok: true, id: rows[0]!.id };
  const lowered = handle.trim().toLowerCase();
  const exact = rows.filter((row) =>
    row.username?.toLowerCase() === lowered
    || row.email.toLowerCase() === lowered
    || row.display_name.toLowerCase() === lowered);
  if (exact.length === 1) return { ok: true, id: exact[0]!.id };
  if (rows.length === 0) return { ok: false, detail: "no member matched that name" };
  return { ok: false, detail: `${rows.length} members matched — ask the user which one, by username` };
}

/**
 * The same question, asked where an ORDINARY member can ask it (0167).
 *
 * `resolveMember` above reads `/v1/admin/members`, which an admin may do and
 * a member may not — right for the two tools that change somebody's role or
 * status, since only an admin can perform those anyway. Messaging a colleague
 * is every member's, so it resolves through the org directory instead: same
 * people, no admin gate, and the fields a person actually types.
 *
 * Using the admin list here would have made this feature work perfectly for
 * whoever built it and fail with a 403 for everyone else — the shape that is
 * invisible from the developer's own account.
 */
async function resolveColleague(handle: string): Promise<
  { ok: true; id: string; name: string } | { ok: false; detail: string }
> {
  const { api } = await import("@/api/client");
  const rows = await api.orgPeople();
  const lowered = handle.trim().toLowerCase();
  const matches = (row: { display_name: string; display_name_en: string | null }) =>
    row.display_name.toLowerCase() === lowered
    || (row.display_name_en ?? "").toLowerCase() === lowered;
  const exact = rows.filter(matches);
  if (exact.length === 1) return { ok: true, id: exact[0]!.id, name: exact[0]!.display_name };
  const loose = rows.filter((row) =>
    row.display_name.toLowerCase().includes(lowered)
    || (row.display_name_en ?? "").toLowerCase().includes(lowered));
  if (loose.length === 1) return { ok: true, id: loose[0]!.id, name: loose[0]!.display_name };
  if (loose.length === 0) return { ok: false, detail: "no colleague matched that name" };
  return {
    ok: false,
    /* names them, because "3 matched" leaves the model with nothing to ask
       about and it will guess one */
    detail: `several colleagues matched: ${loose.slice(0, 5).map((r) => r.display_name).join("، ")} — ask the user which`,
  };
}

/* the label palette, mirrored from the board's own (TaskDialogs.LABEL_COLORS)
   so a model cannot invent a colour the theme has no answer for */
const TASK_LABEL_COLOURS = [
  "grey", "blue", "green", "amber", "red", "purple", "teal", "pink",
] as const;

/** a refused api write reads as the SERVER's sentence, not a crash */
function refusalDetail(cause: unknown, fallback: string): string {
  const { status, detail } = cause as { status?: number; detail?: string };
  if (status === 403) return "the server refused: this needs an admin role";
  return detail ?? fallback;
}

/**
 * The record-row tools identify a record the way a person would — by its
 * title (or id) — resolved against the SAME list the table shows,
 * archived included. Ambiguity refuses: "delete call 1" with two rows
 * titled "call 1" must not pick one.
 */
async function resolveRecord(handle: string): Promise<
  { ok: true; id: string } | { ok: false; detail: string }
> {
  const trimmed = handle.trim();
  if (UUID_RE.test(trimmed)) return { ok: true, id: trimmed };
  const { api } = await import("@/api/client");
  const rows = await api.listCalls({ includeArchived: true });
  const lowered = trimmed.toLowerCase();
  const matched = rows.filter((row) => (row.title ?? "").toLowerCase() === lowered);
  if (matched.length === 1) return { ok: true, id: matched[0]!.id };
  if (matched.length === 0) return { ok: false, detail: "no record matched that title" };
  return { ok: false, detail: `${matched.length} records share that title — ask the user which one (by date or id)` };
}

async function resolveConversation(handle: string): Promise<
  { ok: true; id: string } | { ok: false; detail: string }
> {
  const { api } = await import("@/api/client");
  const rows = await api.agentSessions();
  const lowered = handle.trim().toLowerCase();
  const matched = rows.filter((row) => (row.title ?? "").toLowerCase() === lowered);
  if (matched.length === 1) return { ok: true, id: matched[0]!.id };
  if (matched.length === 0) return { ok: false, detail: "no conversation matched that title" };
  return { ok: false, detail: `${matched.length} conversations share that title — ask the user which one` };
}

/** shared shape for the six record-row mutations */
async function recordAction(
  handle: unknown,
  act: (id: string, api: typeof import("@/api/client").api) => Promise<void>,
  doneDetail: string,
  failDetail: string,
): Promise<SurfaceResult> {
  const name = typeof handle === "string" ? handle.trim() : "";
  if (!name) return { ok: false, detail: "record is required" };
  const who = await resolveRecord(name);
  if (!who.ok) return { ok: false, detail: who.detail };
  try {
    const { api } = await import("@/api/client");
    await act(who.id, api);
    return { ok: true, detail: doneDetail };
  } catch (cause) {
    return { ok: false, detail: refusalDetail(cause, failDetail) };
  }
}

export async function executeClientTool(
  tool: string,
  args: unknown,
  surface: SurfaceContext,
): Promise<SurfaceResult> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (tool) {
    case "navigate": {
      const path = typeof a.path === "string" ? a.path.trim() : "";
      if (!NAVIGABLE.test(path)) {
        return { ok: false, detail: "that route is not navigable" };
      }
      surface.push(path === "" ? "/" : path);
      return { ok: true, detail: `navigated to ${path || "/"}` };
    }
    case "start_recording": {
      const title = typeof a.title === "string" ? a.title.trim().slice(0, 120) : "";
      // The recorder honors ?agentStart=<title>: it prefills and starts via
      // its OWN start() — the human path, from any page (M33 rule 2).
      surface.push(`/echo/record?agentStart=${encodeURIComponent(title)}`);
      return { ok: true, detail: title ? `recording "${title}" starting` : "recording starting" };
    }
    case "pause_recording": {
      const controls = recorderControls.current;
      if (!controls || controls.phase() !== "recording") {
        return { ok: false, detail: "no recording is in progress on this screen" };
      }
      controls.pause();
      return { ok: true, detail: "recording paused" };
    }
    case "resume_recording": {
      const controls = recorderControls.current;
      if (!controls || controls.phase() !== "paused") {
        return { ok: false, detail: "no paused recording on this screen" };
      }
      controls.resume();
      return { ok: true, detail: "recording resumed" };
    }
    case "open_call": {
      const id = typeof a.call_id === "string" ? a.call_id : "";
      if (!UUID_RE.test(id)) return { ok: false, detail: "call_id must be a call id" };
      surface.push(`/calls/${id}`);
      return { ok: true, detail: "call opened" };
    }
    case "set_search": {
      const query = typeof a.query === "string" ? a.query.trim().slice(0, 200) : "";
      if (query.length < 2) return { ok: false, detail: "query too short" };
      surface.push(`/search?q=${encodeURIComponent(query)}`);
      return { ok: true, detail: "search opened" };
    }
    case "set_language": {
      const language = a.language === "fa" || a.language === "en" ? a.language : null;
      if (!language) return { ok: false, detail: "language must be fa or en" };
      if (!surface.switchLocale) return { ok: false, detail: "this surface cannot switch language" };
      surface.switchLocale(language);
      // the stored preference follows so the choice survives the session —
      // best-effort: the visible switch already happened
      void import("@/api/client").then(({ api }) => api.setLocale(language)).catch(() => undefined);
      return { ok: true, detail: `the interface language is ${language} now` };
    }
    case "finish_recording": {
      const controls = recorderControls.current;
      if (!controls || controls.phase() === "other") {
        return { ok: false, detail: "no recording is in progress on this screen" };
      }
      try {
        await controls.finish();
        return { ok: true, detail: "recording finished and handed to processing" };
      } catch {
        return { ok: false, detail: "finishing the recording failed on this screen" };
      }
    }
    case "set_member_status": {
      const handle = typeof a.member === "string" ? a.member.trim() : "";
      const status = a.status === "active" || a.status === "disabled" ? a.status : null;
      if (!handle || !status) return { ok: false, detail: "member and status are required" };
      const who = await resolveMember(handle);
      if (!who.ok) return { ok: false, detail: who.detail };
      try {
        const { api } = await import("@/api/client");
        await api.setUserStatus(who.id, status);
        return { ok: true, detail: status === "disabled" ? "the account was disabled" : "the account was enabled" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the status change was refused") };
      }
    }
    case "set_member_role": {
      const handle = typeof a.member === "string" ? a.member.trim() : "";
      const role = a.role === "member" || a.role === "admin" ? a.role : null;
      if (!handle || !role) return { ok: false, detail: "member and role are required" };
      const who = await resolveMember(handle);
      if (!who.ok) return { ok: false, detail: who.detail };
      try {
        const { api } = await import("@/api/client");
        await api.setUserRole(who.id, role);
        return { ok: true, detail: `the role is now ${role}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the role change was refused") };
      }
    }
    case "send_member_message": {
      /*
       * The message is sent from HERE, under the person's own session, so the
       * database stamps them as the sender (db/0167 takes the sender from the
       * actor, never from an argument). The consent card has already been
       * answered by the time this runs — `effect: "write"` in core's registry
       * is what puts it there — so reaching this line means a person read the
       * exact text and said yes.
       */
      const handle = typeof a.member === "string" ? a.member.trim() : "";
      const message = typeof a.message === "string" ? a.message.trim() : "";
      if (!handle) return { ok: false, detail: "a recipient is required" };
      if (!message) return { ok: false, detail: "a message is required" };
      if (message.length > 2000) {
        return { ok: false, detail: "a message must be 2000 characters or fewer" };
      }
      const who = await resolveColleague(handle);
      if (!who.ok) return { ok: false, detail: who.detail };
      try {
        const { api } = await import("@/api/client");
        await api.sendMemberMessage(who.id, message);
        /* names the recipient back: the model asked for a handle and a person
           approved a sentence, and "sent" without a name is how a message goes
           to the wrong Sara without anybody noticing */
        return { ok: true, detail: `the message was sent to ${who.name}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the message was not sent") };
      }
    }
    case "create_meeting": {
      const title = typeof a.title === "string" ? a.title.trim().slice(0, 120) : "";
      if (!title) return { ok: false, detail: "a meeting needs a title" };
      const when = typeof a.when === "string" && a.when.trim() !== ""
        ? a.when
        : new Date().toISOString();
      if (Number.isNaN(new Date(when).getTime())) {
        return { ok: false, detail: "that start time is not a date" };
      }
      try {
        const { api } = await import("@/api/client");
        const meeting = await api.createMeeting({
          title,
          scheduled_at: when,
          mode: a.mode === "in_person" ? "in_person" : "online",
          /* names or addresses, never ids: an invitee may have no row here at
             all, which is why db/0145 made this a text array */
          ...(Array.isArray(a.invitees)
            ? {
              invitees: a.invitees
                .filter((v): v is string => typeof v === "string")
                .map((v) => v.trim()).filter(Boolean).slice(0, 100),
            }
            : {}),
        });
        surface.push(`/meetings/${meeting.id}`);
        return { ok: true, detail: `the meeting «${title}» was created and opened` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the meeting was not created") };
      }
    }
    /*
     * ── M49: EVERYTHING A PERSON CAN DO ──────────────────────────────────
     *
     * Each of these performs the action through the SAME api method the
     * person's own click uses, in their browser, under their session — so the
     * server sees a request it cannot tell from a human one, and RLS answers
     * it exactly as it would for them. That is why these are here and not on
     * the server: an agent-side tool would run as `echo_agent`, which holds
     * none of these grants and would need a wall moved to get them.
     *
     * Every one returns a SENTENCE on failure, never a thrown error. A tool
     * that throws tells the model "something went wrong"; a tool that says
     * "that task no longer exists" tells it what to do next.
     */
    case "complete_task": {
      const id = typeof a.task_id === "string" ? a.task_id : "";
      if (!id) return { ok: false, detail: "which task?" };
      try {
        const { api } = await import("@/api/client");
        const done = a.done !== false;
        await api.updateTask(id, { done });
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: done ? "task completed" : "task reopened" };
      } catch {
        return { ok: false, detail: "that task could not be changed" };
      }
    }
    case "assign_task": {
      const id = typeof a.task_id === "string" ? a.task_id : "";
      const who = typeof a.user_id === "string" ? a.user_id : "";
      if (!id || !who) return { ok: false, detail: "a task and a colleague are both needed" };
      try {
        const { api } = await import("@/api/client");
        await api.setTaskAssignee(id, who, a.assigned !== false);
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: a.assigned === false ? "unassigned" : "assigned" };
      } catch {
        return { ok: false, detail: "that assignment could not be made" };
      }
    }
    case "update_task": {
      const id = typeof a.task_id === "string" ? a.task_id : "";
      if (!id) return { ok: false, detail: "which task?" };
      /*
       * ONLY WHAT WAS SENT. The api patch leaves an omitted field alone, so
       * building the object from present keys is what keeps "change the
       * deadline" from blanking the description — the omit-vs-null contract
       * this repo settled on the profile form.
       */
      const patch: Record<string, unknown> = {};
      if (typeof a.title === "string" && a.title.trim()) patch.title = a.title.trim().slice(0, 300);
      if (typeof a.description === "string") patch.description = a.description.slice(0, 8000);
      if (typeof a.priority === "string") patch.priority = a.priority;
      if (typeof a.due === "string" && a.due.trim()) patch.due_at = a.due.trim();
      if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
      try {
        const { api } = await import("@/api/client");
        await api.updateTask(id, patch as never);
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: "task updated" };
      } catch {
        return { ok: false, detail: "that task could not be updated" };
      }
    }
    case "comment_on_task": {
      const id = typeof a.task_id === "string" ? a.task_id : "";
      const body = typeof a.body === "string" ? a.body.trim().slice(0, 4000) : "";
      if (!id || !body) return { ok: false, detail: "a task and something to say" };
      try {
        const { api } = await import("@/api/client");
        await api.addTaskComment(id, body);
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: "comment added" };
      } catch {
        return { ok: false, detail: "that comment could not be added" };
      }
    }
    case "add_task_checklist_item": {
      const id = typeof a.task_id === "string" ? a.task_id : "";
      const label = typeof a.label === "string" ? a.label.trim().slice(0, 500) : "";
      if (!id || !label) return { ok: false, detail: "a task and an item" };
      try {
        const { api } = await import("@/api/client");
        await api.addTaskChecklistItem(id, label);
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: "added to the checklist" };
      } catch {
        return { ok: false, detail: "that item could not be added" };
      }
    }
    case "archive_task": {
      const id = typeof a.task_id === "string" ? a.task_id : "";
      if (!id) return { ok: false, detail: "which task?" };
      try {
        const { api } = await import("@/api/client");
        await api.updateTask(id, { archived: a.archived !== false });
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: a.archived === false ? "task restored" : "task archived" };
      } catch {
        return { ok: false, detail: "that task could not be archived" };
      }
    }

    /* ── M50 ─────────────────────────────────────────────────────────── */

    case "whoami_surface": {
      /* the SCREEN, not the person — `whoami` on the server answers who they
         are; this answers where they are standing, which is the half a
         browser is the only thing that knows */
      return {
        ok: true,
        detail: JSON.stringify({
          path: window.location.pathname,
          title: document.title,
        }),
      };
    }

    case "list_conversations": {
      try {
        const { api } = await import("@/api/client");
        const rows = await api.agentSessions(a.archived === true);
        return { ok: true, detail: JSON.stringify(rows.slice(0, 40)) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the conversations could not be read") };
      }
    }

    case "read_conversation": {
      /* validate BEFORE resolving: an empty handle should not reach the
         network, and a resolver asked to find "" can only answer wrongly */
      const asked = typeof a.conversation === "string" ? a.conversation.trim() : "";
      if (!asked) return { ok: false, detail: "a conversation is required" };
      const who = await resolveConversation(asked);
      if (!who.ok) return { ok: false, detail: who.detail };
      try {
        const { api } = await import("@/api/client");
        return { ok: true, detail: JSON.stringify(await api.agentMessages(who.id)) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "that conversation could not be read") };
      }
    }

    case "archive_conversation": {
      /* validate BEFORE resolving: an empty handle should not reach the
         network, and a resolver asked to find "" can only answer wrongly */
      const asked = typeof a.conversation === "string" ? a.conversation.trim() : "";
      if (!asked) return { ok: false, detail: "a conversation is required" };
      const who = await resolveConversation(asked);
      if (!who.ok) return { ok: false, detail: who.detail };
      const on = a.archived !== false;
      try {
        const { api } = await import("@/api/client");
        await api.archiveSession(who.id, on);
        return { ok: true, detail: on ? "archived" : "restored" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "that conversation could not be archived") };
      }
    }

    case "share_conversation": {
      /* validate BEFORE resolving: an empty handle should not reach the
         network, and a resolver asked to find "" can only answer wrongly */
      const asked = typeof a.conversation === "string" ? a.conversation.trim() : "";
      if (!asked) return { ok: false, detail: "a conversation is required" };
      const who = await resolveConversation(asked);
      if (!who.ok) return { ok: false, detail: who.detail };
      const on = a.shared !== false;
      try {
        const { api } = await import("@/api/client");
        await api.setShared(who.id, on);
        return { ok: true, detail: on ? "shared with the organization" : "no longer shared" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "sharing could not be changed") };
      }
    }

    case "list_workflows": {
      try {
        const { api } = await import("@/api/client");
        return { ok: true, detail: JSON.stringify(await api.workflows()) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the workflows could not be read") };
      }
    }

    case "list_workflow_runs": {
      try {
        const { api } = await import("@/api/client");
        return { ok: true, detail: JSON.stringify((await api.workflowRuns()).slice(0, 30)) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the runs could not be read") };
      }
    }

    case "set_workflow_enabled": {
      const handle = String(a.workflow ?? "").trim().toLowerCase();
      if (!handle || typeof a.enabled !== "boolean") {
        return { ok: false, detail: "a workflow and enabled are required" };
      }
      try {
        const { api } = await import("@/api/client");
        const rows = await api.authoredWorkflows();
        const hit = rows.find((row) => row.id === handle || row.name.toLowerCase() === handle);
        if (!hit) return { ok: false, detail: "no workflow of this organization matched that name" };
        await api.patchWorkflow(hit.id, { enabled: a.enabled });
        return { ok: true, detail: a.enabled ? "switched on" : "switched off" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the workflow could not be changed") };
      }
    }

    case "install_workflow_starter": {
      const handle = String(a.starter ?? "").trim().toLowerCase();
      if (!handle) return { ok: false, detail: "a starter is required" };
      try {
        const { api } = await import("@/api/client");
        const rows = await api.workflowStarters();
        const hit = rows.find((row) => row.key === handle || row.name.toLowerCase() === handle);
        if (!hit) return { ok: false, detail: "no shipped workflow matched that name" };
        await api.installStarter(hit.key);
        return { ok: true, detail: `installed ${hit.name}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the workflow could not be installed") };
      }
    }

    case "list_skills": {
      try {
        const { api } = await import("@/api/client");
        return { ok: true, detail: JSON.stringify(await api.skills()) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the skills could not be read") };
      }
    }

    case "list_agents": {
      try {
        const { api } = await import("@/api/client");
        return { ok: true, detail: JSON.stringify(await api.agents()) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the assistants could not be read") };
      }
    }

    case "list_invitations": {
      try {
        const { api } = await import("@/api/client");
        return { ok: true, detail: JSON.stringify(await api.invitations()) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the invitations could not be read") };
      }
    }

    case "revoke_invitation": {
      const email = String(a.email ?? "").trim().toLowerCase();
      if (!email) return { ok: false, detail: "an email is required" };
      try {
        const { api } = await import("@/api/client");
        const rows = await api.invitations();
        const hit = rows.find((row) => row.email.toLowerCase() === email);
        if (!hit) return { ok: false, detail: "no live invitation for that address" };
        await api.revokeInvitation(hit.id);
        return { ok: true, detail: "revoked" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the invitation could not be revoked") };
      }
    }

    case "list_connectors": {
      try {
        const { api } = await import("@/api/client");
        return { ok: true, detail: JSON.stringify(await api.connectors()) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the connections could not be read") };
      }
    }

    case "list_notifications": {
      try {
        const { api } = await import("@/api/client");
        const res = await api.cards();
        return { ok: true, detail: JSON.stringify(res.cards.slice(0, 30)) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the notifications could not be read") };
      }
    }

    case "mark_notification_read": {
      const id = String(a.card_id ?? "").trim();
      if (!id) return { ok: false, detail: "a card_id is required" };
      try {
        const { api } = await import("@/api/client");
        await api.markCardRead(id);
        return { ok: true, detail: "marked read" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the notification could not be marked") };
      }
    }

    case "list_task_columns": {
      try {
        const { api } = await import("@/api/client");
        const board = await api.taskBoard();
        return { ok: true, detail: JSON.stringify(board.columns) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the board could not be read") };
      }
    }

    case "create_task_column": {
      const name = String(a.name ?? "").trim();
      if (!name) return { ok: false, detail: "a name is required" };
      try {
        const { api } = await import("@/api/client");
        const row = await api.createTaskColumn(name);
        return { ok: true, detail: `created ${row.name}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the column could not be created") };
      }
    }

    case "create_task_label": {
      const name = String(a.name ?? "").trim();
      if (!name) return { ok: false, detail: "a name is required" };
      /* `find`, not a cast: an unknown colour becomes grey instead of being
         asserted into a union it is not in */
      const asked = String(a.color ?? "");
      const colour = TASK_LABEL_COLOURS.find((entry) => entry === asked) ?? "grey";
      try {
        const { api } = await import("@/api/client");
        await api.createTaskLabel(name, colour);
        return { ok: true, detail: `created ${name}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the label could not be created") };
      }
    }

    case "set_task_label": {
      const taskId = String(a.task_id ?? "").trim();
      const label = String(a.label ?? "").trim().toLowerCase();
      if (!taskId || !label) return { ok: false, detail: "a task and a label are required" };
      try {
        const { api } = await import("@/api/client");
        const labels = await api.taskLabels();
        const hit = labels.find((row) => row.name.toLowerCase() === label);
        if (!hit) return { ok: false, detail: "no label of that name — create_task_label makes one" };
        await api.setTaskLabel(taskId, hit.id, a.on !== false);
        return { ok: true, detail: a.on === false ? "removed" : "added" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the label could not be set") };
      }
    }

    case "create_task_topic": {
      const name = String(a.name ?? "").trim();
      if (!name) return { ok: false, detail: "a name is required" };
      try {
        const { api } = await import("@/api/client");
        await api.createTaskTopic(name);
        return { ok: true, detail: `created ${name}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the topic could not be created") };
      }
    }

    case "update_task_checklist_item": {
      const itemId = String(a.item_id ?? "").trim();
      if (!itemId) return { ok: false, detail: "an item_id is required" };
      const patch: { label?: string; done?: boolean } = {};
      if (typeof a.done === "boolean") patch.done = a.done;
      if (typeof a.label === "string" && a.label.trim() !== "") patch.label = a.label.trim();
      if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
      try {
        const { api } = await import("@/api/client");
        await api.updateTaskChecklistItem(itemId, patch);
        return { ok: true, detail: "updated" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the line could not be updated") };
      }
    }

    case "update_meeting_item": {
      const meetingId = String(a.meeting_id ?? "").trim();
      const itemId = String(a.item_id ?? "").trim();
      if (!meetingId || !itemId) return { ok: false, detail: "a meeting and an item are required" };
      const patch: { body?: string; done?: boolean; owner?: string | null } = {};
      if (typeof a.body === "string" && a.body.trim() !== "") patch.body = a.body.trim();
      if (typeof a.done === "boolean") patch.done = a.done;
      if (typeof a.owner === "string") patch.owner = a.owner.trim() === "" ? null : a.owner.trim();
      if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
      try {
        const { api } = await import("@/api/client");
        await api.updateMeetingItem(meetingId, itemId, patch);
        announceChange("calls");
        return { ok: true, detail: "updated" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the item could not be updated") };
      }
    }

    case "extract_meeting_items": {
      const meetingId = String(a.meeting_id ?? "").trim();
      if (!meetingId) return { ok: false, detail: "a meeting is required" };
      try {
        const { api } = await import("@/api/client");
        const res = await api.extractMeetingItems(meetingId);
        announceChange("calls");
        /* zero is a RESULT, not a failure: a meeting whose summary holds no
           decisions is a real answer and must not read as a broken tool */
        return { ok: true, detail: res.added === 0 ? "nothing to extract" : `added ${res.added}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the items could not be extracted") };
      }
    }

    case "create_meeting_topic": {
      const name = String(a.name ?? "").trim();
      if (!name) return { ok: false, detail: "a name is required" };
      try {
        const { api } = await import("@/api/client");
        await api.createMeetingTopic(name);
        announceChange("calls");
        return { ok: true, detail: `created ${name}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the topic could not be created") };
      }
    }

    case "set_meeting_join_code": {
      const meetingId = String(a.meeting_id ?? "").trim();
      if (!meetingId || typeof a.enabled !== "boolean") {
        return { ok: false, detail: "a meeting and enabled are required" };
      }
      try {
        const { api } = await import("@/api/client");
        const res = await api.setMeetingJoinCode(meetingId, a.enabled);
        announceChange("calls");
        /* the CODE itself is never returned to the model: it is a bearer
           capability, and a capability in a transcript is a capability
           anybody who reads that thread has */
        return { ok: true, detail: res.join_code ? "a guest link is now active" : "the guest link is revoked" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the guest link could not be changed") };
      }
    }

    case "resummarize_record": {
      /* the empty handle refuses HERE, the way recordAction() does: a
         resolver asked to find "" reaches the network to answer a question
         nobody asked */
      const named = typeof a.record === "string" ? a.record.trim() : "";
      if (!named) return { ok: false, detail: "record is required" };
      const who = await resolveRecord(named);
      if (!who.ok) return { ok: false, detail: who.detail };
      const opts: { instruction?: string; label?: string } = {};
      if (typeof a.instruction === "string" && a.instruction.trim() !== "") {
        opts.instruction = a.instruction.trim();
      }
      if (typeof a.label === "string" && a.label.trim() !== "") opts.label = a.label.trim();
      try {
        const { api } = await import("@/api/client");
        await api.resummarize(who.id, opts);
        announceChange("calls");
        return { ok: true, detail: "a new summary is being written" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the summary could not be requested") };
      }
    }

    case "translate_record": {
      /* the empty handle refuses HERE, the way recordAction() does: a
         resolver asked to find "" reaches the network to answer a question
         nobody asked */
      const named = typeof a.record === "string" ? a.record.trim() : "";
      if (!named) return { ok: false, detail: "record is required" };
      const who = await resolveRecord(named);
      if (!who.ok) return { ok: false, detail: who.detail };
      const what = a.what === "transcript" ? "transcript" : "summary";
      try {
        const { api } = await import("@/api/client");
        const res = await api.translateCall(who.id, what);
        return { ok: true, detail: res.text };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the translation was refused") };
      }
    }

    case "retry_record": {
      /* the empty handle refuses HERE, the way recordAction() does: a
         resolver asked to find "" reaches the network to answer a question
         nobody asked */
      const named = typeof a.record === "string" ? a.record.trim() : "";
      if (!named) return { ok: false, detail: "record is required" };
      const who = await resolveRecord(named);
      if (!who.ok) return { ok: false, detail: who.detail };
      try {
        const { api } = await import("@/api/client");
        const res = await api.retryCall(who.id);
        announceChange("calls");
        return { ok: true, detail: `now ${res.status}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the record could not be retried") };
      }
    }

    case "rename_speaker": {
      /* the empty handle refuses HERE, the way recordAction() does: a
         resolver asked to find "" reaches the network to answer a question
         nobody asked */
      const named = typeof a.record === "string" ? a.record.trim() : "";
      if (!named) return { ok: false, detail: "record is required" };
      const who = await resolveRecord(named);
      if (!who.ok) return { ok: false, detail: who.detail };
      const speakerId = String(a.speaker_id ?? "").trim();
      const label = String(a.label ?? "").trim();
      if (!speakerId || !label) return { ok: false, detail: "a speaker and a label are required" };
      try {
        const { api } = await import("@/api/client");
        await api.renameSpeaker(who.id, speakerId, label);
        announceChange("calls");
        return { ok: true, detail: `now called ${label}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the speaker could not be renamed") };
      }
    }

    case "link_speaker": {
      /* the empty handle refuses HERE, the way recordAction() does: a
         resolver asked to find "" reaches the network to answer a question
         nobody asked */
      const named = typeof a.record === "string" ? a.record.trim() : "";
      if (!named) return { ok: false, detail: "record is required" };
      const who = await resolveRecord(named);
      if (!who.ok) return { ok: false, detail: who.detail };
      const speakerId = String(a.speaker_id ?? "").trim();
      if (!speakerId) return { ok: false, detail: "a speaker is required" };
      const wanted = typeof a.person === "string" ? a.person.trim() : "";
      try {
        const { api } = await import("@/api/client");
        let personId: string | null = null;
        if (wanted !== "") {
          const people = await api.directory();
          const lowered = wanted.toLowerCase();
          const hit = people.filter((row) => row.display_name.toLowerCase() === lowered);
          if (hit.length !== 1) {
            return {
              ok: false,
              detail: hit.length === 0
                ? "nobody in the voice directory has that name — create_person adds one"
                : "several people share that name — ask the user which",
            };
          }
          personId = hit[0]!.id;
        }
        await api.linkSpeaker(who.id, speakerId, personId);
        announceChange("calls");
        return { ok: true, detail: personId === null ? "unlinked" : `linked to ${wanted}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the speaker could not be linked") };
      }
    }

    case "create_person": {
      const name = String(a.name ?? "").trim();
      if (!name) return { ok: false, detail: "a name is required" };
      try {
        const { api } = await import("@/api/client");
        await api.createPerson(name, typeof a.title === "string" ? a.title.trim() : "");
        return { ok: true, detail: `added ${name}` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the person could not be added") };
      }
    }

    case "rename_member": {
      const who = await resolveMember(String(a.member ?? ""));
      if (!who.ok) return { ok: false, detail: who.detail };
      const patch: { display_name?: string; username?: string | null } = {};
      if (typeof a.display_name === "string" && a.display_name.trim() !== "") {
        patch.display_name = a.display_name.trim();
      }
      if (typeof a.username === "string") {
        patch.username = a.username.trim() === "" ? null : a.username.trim();
      }
      if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
      try {
        const { api } = await import("@/api/client");
        await api.renameMember(who.id, patch);
        return { ok: true, detail: "renamed" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the member could not be renamed") };
      }
    }

    case "list_allowed_models": {
      try {
        const { api } = await import("@/api/client");
        return { ok: true, detail: JSON.stringify(await api.adminModels()) };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the models could not be read") };
      }
    }

    case "set_model_allowed": {
      const id = String(a.model_id ?? "").trim();
      if (!id || typeof a.allowed !== "boolean") {
        return { ok: false, detail: "a model_id and allowed are required" };
      }
      try {
        const { api } = await import("@/api/client");
        await api.setModelAllowed(id, a.allowed);
        return { ok: true, detail: a.allowed ? "allowed" : "forbidden" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the model could not be changed") };
      }
    }

    case "set_role_permission": {
      const role = a.role === "member" || a.role === "admin" ? a.role : null;
      const capability = String(a.capability ?? "").trim();
      if (!role || !capability || typeof a.allowed !== "boolean") {
        return { ok: false, detail: "a role, a capability and allowed are required" };
      }
      try {
        const { api } = await import("@/api/client");
        await api.setCapability(role, capability, a.allowed);
        return { ok: true, detail: a.allowed ? "granted" : "taken away" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the permission could not be changed") };
      }
    }

    case "invite_to_meeting": {
      const id = typeof a.meeting_id === "string" ? a.meeting_id : "";
      const adding = Array.isArray(a.invitees)
        ? a.invitees.filter((v): v is string => typeof v === "string")
          .map((v) => v.trim()).filter(Boolean)
        : [];
      if (!id || adding.length === 0) {
        return { ok: false, detail: "a meeting and at least one person" };
      }
      try {
        const { api } = await import("@/api/client");
        /*
         * READ, THEN APPEND. `invitees` is a whole-array write, so sending
         * only the new names would silently uninvite everybody already on the
         * list — the lost-update hazard this repo already recorded against
         * `allowed_models`, arriving here as "the agent removed four people
         * while adding one". The read is what makes this an ADD.
         */
        const meeting = await api.meetingDetail(id);
        const seen = new Set(meeting.invitees.map((v) => v.trim().toLowerCase()));
        const merged = [
          ...meeting.invitees,
          ...adding.filter((v) => !seen.has(v.trim().toLowerCase())),
        ];
        if (merged.length === meeting.invitees.length) {
          /* everybody named was already there — a true statement, and a
             different one from "added", which the model should be able to say */
          return { ok: true, detail: "they were already invited" };
        }
        await api.updateMeeting(id, { invitees: merged.slice(0, 100) });
        announceChange("calls");
        return { ok: true, detail: `invited ${merged.length - meeting.invitees.length}` };
      } catch {
        return { ok: false, detail: "that meeting's invitees could not be changed" };
      }
    }
    case "update_meeting": {
      const id = typeof a.meeting_id === "string" ? a.meeting_id : "";
      if (!id) return { ok: false, detail: "which meeting?" };
      const patch: Record<string, unknown> = {};
      if (typeof a.title === "string" && a.title.trim()) patch.title = a.title.trim().slice(0, 300);
      if (typeof a.when === "string" && a.when.trim()) patch.scheduled_at = a.when.trim();
      if (typeof a.location === "string") patch.location = a.location.slice(0, 300);
      if (typeof a.description === "string") patch.description = a.description.slice(0, 8000);
      if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
      try {
        const { api } = await import("@/api/client");
        await api.updateMeeting(id, patch);
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: "meeting updated" };
      } catch {
        /* the closed-minutes refusal arrives here as a 4xx. Named rather than
           generic: a frozen record is a rule somebody should hear about, not a
           failure they should retry. */
        return { ok: false, detail: "that meeting could not be changed — its minutes may be closed" };
      }
    }
    case "add_meeting_item": {
      const id = typeof a.meeting_id === "string" ? a.meeting_id : "";
      const body = typeof a.body === "string" ? a.body.trim().slice(0, 2000) : "";
      const kind = typeof a.kind === "string" ? a.kind : "";
      if (!id || !body || !kind) return { ok: false, detail: "a meeting, a kind and a body" };
      try {
        const { api } = await import("@/api/client");
        await api.addMeetingItem(id, {
          kind: kind as never,
          body,
          ...(typeof a.owner === "string" && a.owner.trim() ? { owner: a.owner.trim() } : {}),
        });
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: "added to the meeting" };
      } catch {
        return { ok: false, detail: "that item could not be added" };
      }
    }
    case "approve_minutes": {
      const id = typeof a.meeting_id === "string" ? a.meeting_id : "";
      if (!id) return { ok: false, detail: "which meeting?" };
      try {
        const { api } = await import("@/api/client");
        await api.updateMeeting(id, { minutes_approved: true });
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: "minutes approved" };
      } catch {
        return { ok: false, detail: "those minutes could not be approved" };
      }
    }
    case "archive_meeting": {
      const id = typeof a.meeting_id === "string" ? a.meeting_id : "";
      if (!id) return { ok: false, detail: "which meeting?" };
      try {
        const { api } = await import("@/api/client");
        await api.updateMeeting(id, { archived: a.archived !== false });
        /* no refresh topic for tasks or meetings — those pages fetch on
           navigation, so a change made here shows on the next visit. Naming
           the gap rather than inventing a topic nothing subscribes to. */
        return { ok: true, detail: a.archived === false ? "meeting restored" : "meeting archived" };
      } catch {
        return { ok: false, detail: "that meeting could not be archived" };
      }
    }

    case "add_record_note": {
      const id = typeof a.record_id === "string" ? a.record_id : "";
      const body = typeof a.body === "string" ? a.body.trim().slice(0, 4000) : "";
      if (!id || !body) return { ok: false, detail: "a record and a note" };
      try {
        const { api } = await import("@/api/client");
        await api.addCallNote(id, {
          kind: "note",
          body,
          ...(typeof a.at_ms === "number" && Number.isFinite(a.at_ms)
            ? { at_ms: Math.max(0, Math.round(a.at_ms)) } : {}),
        });
        announceChange("calls");
        return { ok: true, detail: "note added" };
      } catch {
        return { ok: false, detail: "that note could not be added" };
      }
    }
    case "tag_record": {
      const id = typeof a.record_id === "string" ? a.record_id : "";
      const tags = Array.isArray(a.tags)
        ? a.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
        : null;
      if (!id || tags === null) return { ok: false, detail: "a record and a list of tags" };
      try {
        const { api } = await import("@/api/client");
        await api.setCallTags(id, tags.slice(0, 30));
        announceChange("calls");
        return { ok: true, detail: "tags set" };
      } catch {
        return { ok: false, detail: "those tags could not be set" };
      }
    }

    case "invite_member": {
      const email = typeof a.email === "string" ? a.email.trim() : "";
      if (!email.includes("@")) return { ok: false, detail: "a real email address is needed" };
      try {
        const { api } = await import("@/api/client");
        await api.createInvitation(email, a.role === "admin" ? "admin" : "member");
        announceChange("invitations");
        return { ok: true, detail: "invitation sent" };
      } catch {
        /* the admin-only refusal lands here. The model is told WHAT stopped it
           so it can say so, rather than reporting a generic failure the person
           would try again. */
        return { ok: false, detail: "that invitation was refused — inviting people is an admin's to do" };
      }
    }

    case "run_workflow": {
      const ref = typeof a.workflow === "string" ? a.workflow.trim() : "";
      if (!ref) return { ok: false, detail: "which workflow?" };
      try {
        const { api } = await import("@/api/client");
        const run = await api.runWorkflow(ref);
        announceChange("workflows");
        return { ok: true, detail: `workflow started (${run.status})` };
      } catch {
        return { ok: false, detail: "that workflow could not be started" };
      }
    }

    case "rename_conversation": {
      const title = typeof a.title === "string" ? a.title.trim().slice(0, 200) : "";
      const session = liveConversation();
      if (!title) return { ok: false, detail: "a title is needed" };
      if (session === null) return { ok: false, detail: "this conversation has not been saved yet" };
      try {
        const { api } = await import("@/api/client");
        await api.renameSession(session, title);
        announceChange("sessions");
        return { ok: true, detail: "conversation renamed" };
      } catch {
        return { ok: false, detail: "that conversation could not be renamed" };
      }
    }

    case "create_task": {
      const title = typeof a.title === "string" ? a.title.trim().slice(0, 200) : "";
      if (!title) return { ok: false, detail: "a task needs a title" };
      try {
        const { api } = await import("@/api/client");
        const board = await api.taskBoard();
        const column = board.columns[0];
        if (column === undefined) {
          /* a real state with its own sentence, not a crash: an org whose
             board has no columns cannot hold a card yet */
          return { ok: false, detail: "this board has no columns to put a card in" };
        }
        const task = await api.createTask({
          title,
          column_id: column.id,
          ...(typeof a.description === "string" && a.description.trim() !== ""
            ? { description: a.description.trim() } : {}),
          ...(typeof a.due === "string" && a.due.trim() !== "" ? { due_at: a.due } : {}),
        });
        /*
         * ASSIGNED IN THE SAME BREATH. "Make a task for Sina" is one sentence
         * and should be one act — creating it and then telling the person to
         * open the board and assign it themselves is the product handing its
         * job back. Best-effort on purpose: a task that exists unassigned is a
         * far better outcome than a failed creation, so the assignment's
         * refusal is REPORTED rather than thrown, and the sentence says which
         * half happened.
         */
        let assigned = false;
        if (typeof a.assignee === "string" && a.assignee.trim() !== "") {
          assigned = await api.setTaskAssignee(task.id, a.assignee.trim(), true)
            .then(() => true).catch(() => false);
        }
        surface.push("/tasks");
        announceChange("members");
        return {
          ok: true,
          detail: typeof a.assignee === "string" && a.assignee.trim() !== ""
            ? (assigned
              ? `the task «${title}» was added and assigned`
              : `the task «${title}» was added, but it could not be assigned`)
            : `the task «${title}» was added`,
        };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the task was not created") };
      }
    }
    case "open_meeting": {
      const name = typeof a.meeting === "string" ? a.meeting.trim() : "";
      if (!name) return { ok: false, detail: "a meeting title is required" };
      try {
        const { api } = await import("@/api/client");
        const rows = await api.meetings();
        const lowered = name.toLowerCase();
        const exact = rows.filter((m) => (m.title ?? "").toLowerCase() === lowered);
        const hit = exact.length === 1
          ? exact[0]
          : rows.filter((m) => (m.title ?? "").toLowerCase().includes(lowered))[0];
        if (hit === undefined) return { ok: false, detail: "no meeting matched that title" };
        surface.push(`/meetings/${hit.id}`);
        return { ok: true, detail: `opened «${hit.title}»` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "that meeting could not be opened") };
      }
    }
    case "rename_record": {
      const title = typeof a.title === "string" ? a.title.trim().slice(0, 120) : "";
      if (!title) return { ok: false, detail: "title is required" };
      return recordAction(a.record,
        (id, api) => api.setCallTitle(id, title).then(() => undefined),
        "the record was renamed", "the rename was refused");
    }
    case "set_record_scope": {
      const scope = a.scope === "private" || a.scope === "org" ? a.scope : null;
      if (!scope) return { ok: false, detail: "scope must be private or org" };
      return recordAction(a.record,
        (id, api) => api.setScope(id, scope).then(() => undefined),
        scope === "org" ? "the record is shared with the organization" : "the record is private now",
        "the scope change was refused");
    }
    case "archive_record":
      return recordAction(a.record,
        (id, api) => api.setArchived(id, true),
        "the record was archived", "archiving was refused");
    case "unarchive_record":
      return recordAction(a.record,
        (id, api) => api.setArchived(id, false),
        "the record is back from the archive", "unarchiving was refused");
    case "delete_record":
      return recordAction(a.record,
        (id, api) => api.deleteCall(id, "با تأیید کاربر از طریق دستیار"), // 0085: consent card = the confirm; this is the ledger line
        "the record was deleted — restorable for 30 days", "deleting was refused");
    case "restore_record":
      return recordAction(a.record,
        (id, api) => api.restoreCall(id),
        "the record was restored", "restoring was refused");
    case "delete_conversation": {
      const handle = typeof a.conversation === "string" ? a.conversation.trim() : "";
      if (!handle) return { ok: false, detail: "conversation is required" };
      const who = await resolveConversation(handle);
      if (!who.ok) return { ok: false, detail: who.detail };
      try {
        const { api } = await import("@/api/client");
        await api.archiveSession(who.id, true);
        return { ok: true, detail: "the conversation was removed from history" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "removing the conversation was refused") };
      }
    }
    case "add_speaker_person": {
      const name = typeof a.name === "string" ? a.name.trim().slice(0, 120) : "";
      if (!name) return { ok: false, detail: "name is required" };
      const title = typeof a.title === "string" ? a.title.trim().slice(0, 120) : "";
      try {
        const { api } = await import("@/api/client");
        await api.createPerson(name, title);
        return { ok: true, detail: "the person was added to the directory" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "adding the person was refused") };
      }
    }
    default:
      return { ok: false, detail: "this surface cannot perform that tool" };
  }
}
