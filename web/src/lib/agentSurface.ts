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
        });
        surface.push(`/meetings/${meeting.id}`);
        return { ok: true, detail: `the meeting «${title}» was created and opened` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the meeting was not created") };
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
        surface.push("/tasks");
        return { ok: true, detail: `the task «${title}» was added${task.id ? "" : ""}` };
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
