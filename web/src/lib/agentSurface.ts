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
import type { ConnectorProvider } from "@/api/types";

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
  "correct_transcript",
  "edit_summary",
  "send_slack_message",
  "send_telegram_message",
  "send_whatsapp_message",
  "create_jira_issue",
  "create_github_issue",
  "create_notion_page",
  "create_zoom_meeting",
  "call_mcp_tool",
  "create_person",
  "rename_member",
  "list_allowed_models",
  "set_model_allowed",
  "set_role_permission",
  /* the hands of 2026-09-05 (user: "all a human can do in the platform,
     these must do too") — projects, folders, columns, labels, rooms, and
     the deletes a person can press. Each runs the api the screen's own
     button runs, so an admin's power is an admin's and a member's refusal
     is the server's. */
  "create_project",
  "update_project",
  "archive_project",
  "delete_project",
  "set_project_member",
  "update_task_topic",
  "update_task_column",
  "update_task_label",
  "delete_task_label",
  "delete_task",
  "update_meeting_topic",
  "create_chat_room",
  "update_chat_room",
];

/** Routes the agent may navigate to — the same set a human can click to. */
/** exported for the seam test: core's navigate enum must stay inside it */
/* the destinations the executor will perform. Kept in step with core's
   `navigate` enum by route-map.test.ts, which checks BOTH against the app
   directory — the pair used to agree with each other and with nothing else. */
export const NAVIGABLE = /^\/(assistant|meetings|tasks|projects|chat|integrations|profile|echo(\/(record|upload|calls|records|summaries|archive))?|workflows|agents|conversations|settings(\/[a-z-]+)?|management(\/[a-z-]+)?|search)?$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* deliberately loose: this decides whether a string is an ADDRESS for
   somebody outside the organisation or a NAME the platform failed to
   resolve — and the server validates the address itself. A strict pattern
   here would turn a real address into "no colleague matched that name". */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const lowered = handle.trim().toLowerCase();
  const exact = rows.filter((row) =>
    row.username?.toLowerCase() === lowered
    || row.email.toLowerCase() === lowered
    || row.display_name.toLowerCase() === lowered);
  if (exact.length === 1) return { ok: true, id: exact[0]!.id };
  if (rows.length === 0) return { ok: false, detail: "no member matched that name" };
  /* A LONE PARTIAL MATCH IS NOT A PERSON (2026-09-06, the check-up). The
     server's search is a prefix filter — right for a directory, and it made
     «ali» resolve to the only Alireza — and this used to accept a single row
     whatever it was. The consent card names the handle the model PASSED, not
     the person that row turned out to be, so the yes covered somebody else.
     The candidates are named so the model can ask by username. */
  const names = rows.slice(0, 5).map((row) => row.username ? `@${row.username}` : row.display_name).join("، ");
  return {
    ok: false,
    detail: rows.length === 1
      ? `no exact match — the closest is ${names}; confirm with the user by username`
      : `${rows.length} members matched (${names}) — ask the user which one, by username`,
  };
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
  const trimmed = handle.trim();
  /* an id is already an answer (the older tool descriptions asked for one) */
  if (UUID_RE.test(trimmed)) return { ok: true, id: trimmed, name: trimmed };
  const rows = await api.orgPeople();
  /* «@sina» and «sina» name the same colleague — the handle is what the
     chat's mention picker offers, so it is what a person will say */
  const lowered = trimmed.replace(/^@/, "").toLowerCase();
  const matches = (row: { display_name: string; display_name_en: string | null; username?: string | null }) =>
    row.display_name.toLowerCase() === lowered
    || (row.display_name_en ?? "").toLowerCase() === lowered
    || (row.username ?? "").toLowerCase() === lowered;
  const exact = rows.filter(matches);
  if (exact.length === 1) return { ok: true, id: exact[0]!.id, name: exact[0]!.display_name };
  /* the LOOSE matches are named and never chosen (2026-09-06): a lone
     substring hit used to be accepted, and a message «به سینا» went to the
     one colleague whose name CONTAINS سینا — with the consent card naming
     the handle, not the person. See resolveMember. */
  const loose = rows.filter((row) =>
    row.display_name.toLowerCase().includes(lowered)
    || (row.display_name_en ?? "").toLowerCase().includes(lowered));
  if (loose.length === 0) return { ok: false, detail: "no colleague matched that name" };
  const names = loose.slice(0, 5).map((r) => r.username ? `@${r.username}` : r.display_name).join("، ");
  return {
    ok: false,
    /* names them, because "3 matched" leaves the model with nothing to ask
       about and it will guess one */
    detail: loose.length === 1
      ? `no exact match — the closest is ${names}; confirm with the user`
      : `several colleagues matched: ${names} — ask the user which`,
  };
}

/* the label palette, mirrored from the board's own (TaskDialogs.LABEL_COLORS)
   so a model cannot invent a colour the theme has no answer for */
const TASK_LABEL_COLOURS = [
  "grey", "blue", "green", "amber", "red", "purple", "teal", "pink",
] as const;

/** the eight hands, mapped to the connector door they open */
const CONNECTOR_HANDS: Record<string, { provider: ConnectorProvider; action: string; keys: readonly string[] }> = {
  send_slack_message: { provider: "slack", action: "send_message", keys: ["channel", "text"] },
  send_telegram_message: { provider: "telegram", action: "send_message", keys: ["chat", "text"] },
  /* `colleague` is resolved to a user id below, not passed through: the
     server turns that into the chat the bot answers them in (db/0216) */
  send_whatsapp_message: { provider: "whatsapp", action: "send_message", keys: ["to", "text", "template", "language"] },
  create_jira_issue: { provider: "jira", action: "create_issue", keys: ["project", "summary", "description"] },
  create_github_issue: { provider: "github", action: "create_issue", keys: ["repository", "title", "body"] },
  create_notion_page: { provider: "notion", action: "create_page", keys: ["parent", "title", "content"] },
  create_zoom_meeting: { provider: "zoom", action: "create_meeting", keys: ["topic", "starts_at", "minutes"] },
  call_mcp_tool: { provider: "mcp", action: "call_tool", keys: ["tool"] },
};

async function connectorHand(tool: string, a: Record<string, unknown>): Promise<SurfaceResult> {
  const hand = CONNECTOR_HANDS[tool];
  if (!hand) return { ok: false, detail: `unknown hand ${tool}` };
  const args: Record<string, unknown> = {};
  for (const key of hand.keys) {
    const value = a[key];
    if (typeof value === "string" && value.trim() !== "") args[key] = value.trim();
  }
  if (tool === "send_telegram_message") {
    /*
     * A COLLEAGUE IS AN ADDRESS; A @USERNAME IS NOT (user report,
     * 2026-09-08). Telegram will not let a bot open a conversation with a
     * person, so the only person it can reach is one who opened the chat
     * themselves — which is exactly what db/0212's link records. The name is
     * resolved through the SAME resolver every other hand uses (exact or a
     * refusal, never a guess), and the id it yields is sent instead: the
     * chat number is resolved server-side and never comes back.
     */
    const named = typeof a.colleague === "string" ? a.colleague.trim() : "";
    if (named !== "") {
      const who = await resolveColleague(named);
      if (!who.ok) return { ok: false, detail: who.detail };
      args.user_id = who.id;
      /* a colleague WINS over a chat: a model that sent both would otherwise
         address whichever one the server happened to prefer */
      delete args.chat;
    } else if (typeof args.chat !== "string" || args.chat === "") {
      return {
        ok: false,
        detail: "name the colleague to send it to — a Telegram bot cannot message a person by @username or phone number",
      };
    }
  }
  if (tool === "call_mcp_tool") {
    /* the tool's arguments arrive as a JSON string (the schema stays flat);
       a string that is not an object is refused HERE, before anything is
       spent — the server would only say 400 */
    const raw = typeof a.arguments_json === "string" ? a.arguments_json.trim() : "";
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { ok: false, detail: "arguments_json must be a JSON object" };
        }
        args.arguments = parsed;
      } catch {
        return { ok: false, detail: "arguments_json is not valid JSON" };
      }
    }
  }
  try {
    const { api } = await import("@/api/client");
    const result = await api.connectorAction(hand.provider, hand.action, args);
    return handOutcome(tool, result);
  } catch (cause) {
    const { status } = cause as { status?: number };
    if (status === 404) {
      return { ok: false, detail: `${hand.provider} is not connected for this person — offer the integrations page (/integrations)` };
    }
    return { ok: false, detail: refusalDetail(cause, `${hand.provider} refused the action`) };
  }
}

/** what to tell the model happened — the provider's own reference, never a body it did not send */
function handOutcome(tool: string, result: Record<string, unknown>): SurfaceResult {
  const s = (key: string) => (typeof result[key] === "string" ? String(result[key]) : "");
  switch (tool) {
    case "send_slack_message": return { ok: true, detail: `posted to ${s("channel")} (ts ${s("ts")})` };
    case "send_telegram_message": return { ok: true, detail: `sent to ${s("chat") || "the chat"} (message ${s("message_id")})` };
    case "send_whatsapp_message": return { ok: true, detail: `sent (message ${s("message_id")})` };
    case "create_jira_issue": return { ok: true, detail: `created ${s("key")}${s("url") ? ` — ${s("url")}` : ""}` };
    case "create_github_issue": return { ok: true, detail: `opened #${String(result.number ?? "")}${s("url") ? ` — ${s("url")}` : ""}` };
    case "create_notion_page": return { ok: true, detail: `created${s("url") ? ` — ${s("url")}` : ""}` };
    case "create_zoom_meeting": return { ok: true, detail: `created${s("join_url") ? ` — join: ${s("join_url")}` : ""}` };
    case "call_mcp_tool": return result.is_error === true
      ? { ok: false, detail: s("text") || "the tool reported an error" }
      : { ok: true, detail: s("text") || "(no text returned)" };
    default: return { ok: true, detail: "done" };
  }
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

/**
 * A thing named the way a person names it, resolved against the org's own
 * list — exact match on the name, case-folded; two matches refuse with the
 * count; none refuses with the list, so the model can say the real names
 * back instead of guessing at the nearest one.
 */
function byName<T extends { id: string; name: string }>(
  rows: readonly T[],
  wanted: unknown,
  what: string,
): { ok: true; row: T } | { ok: false; detail: string } {
  const name = typeof wanted === "string" ? wanted.trim() : "";
  if (!name) return { ok: false, detail: `which ${what}?` };
  const lowered = name.toLowerCase();
  const hits = rows.filter((row) => row.name.trim().toLowerCase() === lowered);
  if (hits.length === 1) return { ok: true, row: hits[0]! };
  if (hits.length > 1) return { ok: false, detail: `${hits.length} ${what}s are called that — ask the user which one` };
  return {
    ok: false,
    detail: rows.length === 0
      ? `there is no ${what} yet`
      : `no ${what} called that — there are: ${rows.map((row) => row.name).join("، ")}`,
  };
}

const TONES = new Set(["grey", "blue", "green", "amber", "red", "purple", "teal", "pink"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

/**
 * AN ID IS NOT A NAME A PERSON CAN CHECK (2026-09-06, the small hours). A run
 * asked to file four new cards read the board, chose five task ids — the
 * person's own tasks among them — and moved them into the wrong folder;
 * the consent cards that let it through said «ویرایش تسک» and nothing else.
 * Every tool that addresses a task by id now carries the task's TITLE
 * beside it, and the surface refuses a mismatch before the switch below
 * ever runs: a wrong id cannot reach the wrong card, and the card the person
 * sees names what is about to change.
 */
const TASK_ID_TOOLS = new Set([
  "complete_task", "assign_task", "update_task", "comment_on_task",
  "add_task_checklist_item", "archive_task", "delete_task",
]);
/* a ZWNJ folds to a SPACE, not to nothing: a person reads «جمع‌آوری» and
   types «جمع آوری», and both must name the same card — while «جمعآوری»,
   which nobody reads, does not */
const foldTitle = (value: string): string =>
  value.normalize("NFC").replace(/[\u200c\u200d]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

async function namedTask(a: Record<string, unknown>): Promise<{ ok: true } | { ok: false; detail: string }> {
  const id = typeof a.task_id === "string" ? a.task_id.trim() : "";
  const title = typeof a.title === "string" ? a.title.trim() : "";
  if (!id) return { ok: false, detail: "which task?" };
  if (!title) return { ok: false, detail: "name the task — its title, exactly as list_tasks returned it" };
  try {
    const { api } = await import("@/api/client");
    const task = await api.taskDetail(id);
    if (foldTitle(task.title) !== foldTitle(title)) {
      return { ok: false, detail: `that id is «${task.title}», not «${title}» — say which task you mean` };
    }
    return { ok: true };
  } catch (cause) {
    return { ok: false, detail: refusalDetail(cause, "no task with that id") };
  }
}
const toneOf = (value: unknown): string | undefined =>
  typeof value === "string" && TONES.has(value) ? value : undefined;

export async function executeClientTool(
  tool: string,
  args: unknown,
  surface: SurfaceContext,
): Promise<SurfaceResult> {
  const a = (args ?? {}) as Record<string, unknown>;
  if (TASK_ID_TOOLS.has(tool)) {
    const named = await namedTask(a);
    if (!named.ok) return named;
  }
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
      /* `title` is the task's IDENTITY now (checked above); a rename says
         `new_title` */
      if (typeof a.new_title === "string" && a.new_title.trim()) patch.title = a.new_title.trim().slice(0, 300);
      if (typeof a.description === "string") patch.description = a.description.slice(0, 8000);
      if (typeof a.priority === "string") patch.priority = a.priority;
      if (typeof a.due === "string" && a.due.trim()) patch.due_at = a.due.trim();
      /*
       * MOVING A CARD IS THE BOARD'S MAIN VERB, and no tool could do it.
       *
       * User report, 2026-09-04: asked to put a task «در حال انجام», the agent
       * answered that the task system had errored. It had not — this tool took
       * title, description, priority and deadline, and a column was not among
       * them, so there was no way to say the one thing the board is for. The
       * failure surfaced as a transport-sounding sentence, which is the worst
       * shape for a missing capability to take: it reads as "try again later"
       * for something that was never going to work.
       *
       * By NAME, resolved against the board's own columns, because a person
       * says «در حال انجام» and never a uuid — and an unmatched name refuses
       * with the real list rather than guessing at the nearest column.
       */
      const wantedColumn = typeof a.column === "string" ? a.column.trim().toLowerCase() : "";
      try {
        const { api } = await import("@/api/client");
        if (wantedColumn !== "") {
          const board = await api.taskBoard();
          const hit = board.columns.find((column) => column.name.trim().toLowerCase() === wantedColumn);
          if (!hit) {
            return {
              ok: false,
              detail: `this board has no column called that — it has ${board.columns.map((c) => c.name).join("، ")}`,
            };
          }
          patch.column_id = hit.id;
        }
        /* the FOLDER, by name — a project's folder included (2026-09-05).
           «بدون پوشه» / "none" files it nowhere, which is a real state. */
        const wantedFolder = typeof a.folder === "string" ? a.folder.trim() : "";
        if (wantedFolder !== "") {
          if (/^(none|no folder|بدون پوشه|بدون موضوع)$/i.test(wantedFolder)) {
            patch.topic_id = null;
          } else {
            const board = await api.taskBoard();
            const folder = byName(board.topics, wantedFolder, "folder");
            if (!folder.ok) return { ok: false, detail: folder.detail };
            patch.topic_id = folder.row.id;
          }
        }
        if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
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

    // ── projects (2026-09-05) ─────────────────────────────────────────
    case "create_project": {
      const name = typeof a.name === "string" ? a.name.trim().slice(0, 120) : "";
      if (!name) return { ok: false, detail: "a project needs a name" };
      try {
        const { api } = await import("@/api/client");
        /* people by name, resolved one by one; an unresolved name is SAID,
           never dropped in silence — a project quietly missing a person
           reads as "not yet given to anyone", which is the wrong nothing */
        const unresolved: string[] = [];
        const memberIds: string[] = [];
        for (const raw of Array.isArray(a.members) ? a.members : []) {
          if (typeof raw !== "string" || raw.trim() === "") continue;
          const who = await resolveMember(raw.trim());
          if (who.ok) memberIds.push(who.id);
          else unresolved.push(raw.trim());
        }
        const project = await api.createProject({
          name,
          ...(typeof a.summary === "string" && a.summary.trim() !== "" ? { summary: a.summary.trim().slice(0, 2000) } : {}),
          ...(toneOf(a.tone) ? { tone: toneOf(a.tone) as never } : {}),
          ...(memberIds.length ? { member_ids: memberIds } : {}),
        });
        announceChange("projects");
        surface.push(`/projects?project=${encodeURIComponent(project.id)}`);
        return {
          ok: true,
          detail: unresolved.length
            ? `the project «${name}» was created; nobody matched ${unresolved.join(", ")} — ask the user who they meant`
            : `the project «${name}» was created${memberIds.length ? ` with ${memberIds.length} people` : ""}`,
        };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the project was not created") };
      }
    }
    case "update_project": {
      try {
        const { api } = await import("@/api/client");
        const hit = byName(await api.projects(), a.project, "project");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        const patch: Record<string, unknown> = {};
        if (typeof a.name === "string" && a.name.trim()) patch.name = a.name.trim().slice(0, 120);
        if (typeof a.summary === "string") patch.summary = a.summary.slice(0, 2000);
        if (toneOf(a.tone)) patch.tone = toneOf(a.tone);
        if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
        await api.updateProject(hit.row.id, patch as never);
        announceChange("projects");
        return { ok: true, detail: `«${hit.row.name}» updated` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the project could not be updated") };
      }
    }
    case "archive_project": {
      const restoring = a.archived === false;
      try {
        const { api } = await import("@/api/client");
        const hit = byName(await api.projects({ archived: restoring }), a.project, "project");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        await api.updateProject(hit.row.id, { archived: !restoring });
        announceChange("projects");
        return { ok: true, detail: restoring ? `«${hit.row.name}» is back` : `«${hit.row.name}» archived` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the project could not be archived") };
      }
    }
    case "delete_project": {
      try {
        const { api } = await import("@/api/client");
        const live = await api.projects();
        const archived = await api.projects({ archived: true });
        const hit = byName([...live, ...archived], a.project, "project");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        await api.deleteProject(hit.row.id);
        announceChange("projects");
        return { ok: true, detail: `«${hit.row.name}» deleted — its folder, cards and room stay` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the project could not be deleted") };
      }
    }
    case "set_project_member": {
      const member = typeof a.member === "string" ? a.member.trim() : "";
      if (!member) return { ok: false, detail: "who?" };
      try {
        const { api } = await import("@/api/client");
        const hit = byName(await api.projects(), a.project, "project");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        const who = await resolveMember(member);
        if (!who.ok) return { ok: false, detail: who.detail };
        const on = a.member_of !== false;
        await api.setProjectMember(hit.row.id, who.id, on);
        announceChange("projects");
        return { ok: true, detail: on ? `added to «${hit.row.name}»` : `taken off «${hit.row.name}»` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the project's people could not be changed") };
      }
    }

    // ── folders, columns, labels (2026-09-05) ─────────────────────────
    case "update_task_topic": {
      try {
        const { api } = await import("@/api/client");
        const board = await api.taskBoard();
        const hit = byName(board.topics, a.topic, "folder");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        const patch: { name?: string; archived?: boolean } = {};
        if (typeof a.name === "string" && a.name.trim()) patch.name = a.name.trim().slice(0, 80);
        if (typeof a.archived === "boolean") patch.archived = a.archived;
        if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
        await api.updateTaskTopic(hit.row.id, patch);
        announceChange("tasks");
        return { ok: true, detail: patch.archived === true ? `folder «${hit.row.name}» archived` : `folder «${hit.row.name}» updated` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the folder could not be changed") };
      }
    }
    case "update_task_column": {
      try {
        const { api } = await import("@/api/client");
        const board = await api.taskBoard();
        const hit = byName(board.columns, a.column, "column");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        const patch: { name?: string; archived?: boolean; tone?: never } = {};
        if (typeof a.name === "string" && a.name.trim()) patch.name = a.name.trim().slice(0, 80);
        if (typeof a.archived === "boolean") patch.archived = a.archived;
        if (toneOf(a.tone)) patch.tone = toneOf(a.tone) as never;
        if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
        await api.updateTaskColumn(hit.row.id, patch);
        announceChange("tasks");
        return { ok: true, detail: `column «${hit.row.name}» updated` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the column could not be changed") };
      }
    }
    case "update_task_label": {
      try {
        const { api } = await import("@/api/client");
        const hit = byName(await api.taskLabels(), a.label, "label");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        const patch: { name?: string; color?: never } = {};
        if (typeof a.name === "string" && a.name.trim()) patch.name = a.name.trim().slice(0, 60);
        if (toneOf(a.color)) patch.color = toneOf(a.color) as never;
        if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
        await api.updateTaskLabel(hit.row.id, patch);
        announceChange("tasks");
        return { ok: true, detail: `label «${hit.row.name}» updated` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the label could not be changed") };
      }
    }
    case "delete_task_label": {
      try {
        const { api } = await import("@/api/client");
        const hit = byName(await api.taskLabels(), a.label, "label");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        await api.deleteTaskLabel(hit.row.id);
        announceChange("tasks");
        return { ok: true, detail: `label «${hit.row.name}» retired from every card` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the label could not be deleted") };
      }
    }
    case "delete_task": {
      const id = typeof a.task_id === "string" ? a.task_id.trim() : "";
      if (!id) return { ok: false, detail: "which task?" };
      try {
        const { api } = await import("@/api/client");
        await api.deleteTask(id);
        announceChange("tasks");
        return { ok: true, detail: "task deleted" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "that task could not be deleted") };
      }
    }

    // ── meeting folders and rooms (2026-09-05) ────────────────────────
    case "update_meeting_topic": {
      try {
        const { api } = await import("@/api/client");
        const hit = byName(await api.meetingTopics(), a.topic, "meeting folder");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        const patch: { name?: string; archived?: boolean } = {};
        if (typeof a.name === "string" && a.name.trim()) patch.name = a.name.trim().slice(0, 80);
        if (typeof a.archived === "boolean") patch.archived = a.archived;
        if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
        await api.updateMeetingTopic(hit.row.id, patch);
        return { ok: true, detail: `meeting folder «${hit.row.name}» updated` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the meeting folder could not be changed") };
      }
    }
    case "create_chat_room": {
      const name = typeof a.name === "string" ? a.name.trim().slice(0, 80) : "";
      if (!name) return { ok: false, detail: "a room needs a name" };
      try {
        const { api } = await import("@/api/client");
        await api.createChatChannel({
          name,
          ...(typeof a.topic === "string" && a.topic.trim() !== "" ? { topic: a.topic.trim().slice(0, 300) } : {}),
        });
        announceChange("chat");
        return { ok: true, detail: `the room «${name}» is open` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the room was not created") };
      }
    }
    case "update_chat_room": {
      try {
        const { api } = await import("@/api/client");
        const hit = byName(await api.chatChannels(), a.room, "room");
        if (!hit.ok) return { ok: false, detail: hit.detail };
        const patch: { name?: string; archived?: boolean } = {};
        if (typeof a.name === "string" && a.name.trim()) patch.name = a.name.trim().slice(0, 80);
        if (typeof a.archived === "boolean") patch.archived = a.archived;
        if (Object.keys(patch).length === 0) return { ok: false, detail: "nothing to change" };
        await api.updateChatChannel(hit.row.id, patch);
        announceChange("chat");
        return { ok: true, detail: patch.archived === true ? `room «${hit.row.name}» removed` : `room «${hit.row.name}» updated` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the room could not be changed") };
      }
    }

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
        return { ok: true, detail: JSON.stringify((await api.agentThread(who.id)).messages) };
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
        /* `seed: false` — a READ tool must not write (core tasks.board's own
           rule): the screen's first visit may create the four default
           columns, an agent's listing may not (2026-09-06) */
        const board = await api.taskBoard({ seed: false });
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
        /* the summary's translation is text, returned; the transcript's is a
           JOB the transcriber runs on the audio (C4, 2026-09-06) — the model
           is told which, so it can say "open the record" rather than wait */
        if ("text" in res) return { ok: true, detail: res.text };
        return {
          ok: true,
          detail: res.status === "ready"
            ? "the transcript's translation is ready — it shows line by line on the record page"
            : "the transcript's translation is being prepared by the transcriber from the audio; the record page shows it line by line when it lands (a long record takes minutes)",
        };
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

    /* THE CONNECTORS' HANDS (2026-09-06): each is one action on an outside
       service through the person's own grant, performed here — in their
       browser, after the consent card — through the BFF's action door. The
       arguments pass through as the model wrote them; core's registry
       validates them like human input and refuses by name. */
    case "send_slack_message":
    case "send_telegram_message":
    case "send_whatsapp_message":
    case "create_jira_issue":
    case "create_github_issue":
    case "create_notion_page":
    case "create_zoom_meeting":
    case "call_mcp_tool":
      return connectorHand(tool, a);

    case "correct_transcript": {
      /* the person's own segment edit (PATCH /v1/calls/:id/segments/:sid) on
         their own session — what the M4 proposal card used to confirm from
         the thread; since 2026-09-06 a hand behind the consent card */
      const named = typeof a.record === "string" ? a.record.trim() : "";
      if (!named) return { ok: false, detail: "record is required" };
      const who = await resolveRecord(named);
      if (!who.ok) return { ok: false, detail: who.detail };
      const segmentId = String(a.segment_id ?? "").trim();
      const text = String(a.text ?? "").trim();
      if (!segmentId || !text) return { ok: false, detail: "a segment and its corrected text are required" };
      try {
        const { api } = await import("@/api/client");
        await api.editSegment(who.id, segmentId, text);
        announceChange("calls");
        return { ok: true, detail: "segment corrected" };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the segment could not be corrected") };
      }
    }

    case "edit_summary": {
      /* a new VERSION in the person's name (POST /v1/calls/:id/summaries/edit);
         the earlier versions stay */
      const named = typeof a.record === "string" ? a.record.trim() : "";
      if (!named) return { ok: false, detail: "record is required" };
      const who = await resolveRecord(named);
      if (!who.ok) return { ok: false, detail: who.detail };
      const body = String(a.body ?? "").trim();
      if (!body) return { ok: false, detail: "the new summary body is required" };
      try {
        const { api } = await import("@/api/client");
        const { version } = await api.editSummary(who.id, body);
        announceChange("calls");
        return { ok: true, detail: `summary version ${version} written` };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "the summary could not be edited") };
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
         * A COLLEAGUE IS AN ACCOUNT, NOT A NAME (db/0202, user directive
         * 2026-09-06: "the agents add members based on the knowledge that
         * they have and their names ... in case of adding members to a task
         * or invitation for chat or meetings those names are useless and the
         * user name and member name in user management should be used").
         *
         * This tool used to write whatever string the model produced into
         * `meeting.invitees` — so an agent could put «دکتر باقری» on a
         * meeting that already had «drbagheri» on it, tell nobody, and
         * report success. Each name is now resolved against user management
         * and added as a ROW, which also mints the invitation.
         *
         * An EMAIL still goes in the text list, because that is a real
         * address for somebody with no account here. Anything else REFUSES
         * and names the near misses: a name the platform cannot resolve is
         * precisely the useless one, and writing it down would be the model
         * inventing a participant.
         */
        const emails: string[] = [];
        const ids: string[] = [];
        const names: string[] = [];
        const unknown: string[] = [];
        for (const raw of adding) {
          const who = await resolveColleague(raw);
          if (who.ok) { ids.push(who.id); names.push(who.name); continue; }
          if (EMAIL_RE.test(raw)) { emails.push(raw); continue; }
          unknown.push(`${raw} (${who.detail})`);
        }
        if (ids.length === 0 && emails.length === 0) {
          return { ok: false, detail: unknown.join("; ") };
        }
        if (ids.length > 0) await api.addMeetingAttendees(id, ids);
        if (emails.length > 0) {
          /*
           * READ, THEN APPEND, for the text half. `invitees` is a
           * whole-array write, so sending only the new addresses would
           * silently uninvite everybody already on the list — the
           * lost-update hazard this repo recorded against `allowed_models`,
           * arriving here as "the agent removed four people while adding
           * one". The read is what makes this an ADD.
           */
          const meeting = await api.meetingDetail(id);
          const seen = new Set(meeting.invitees.map((v) => v.trim().toLowerCase()));
          const merged = [...meeting.invitees, ...emails.filter((v) => !seen.has(v.toLowerCase()))];
          if (merged.length > meeting.invitees.length) {
            await api.updateMeeting(id, { invitees: merged.slice(0, 100) });
          }
        }
        announceChange("calls");
        /* the people are NAMED back, and anybody who could not be resolved
           is named too: "invited 2" over a list of three is a success
           report with a silent omission inside it */
        const said = [...names, ...emails].join("، ");
        return {
          ok: true,
          detail: unknown.length === 0
            ? `invited ${said}`
            : `invited ${said}; not matched: ${unknown.join("; ")}`,
        };
      } catch (cause) {
        return { ok: false, detail: refusalDetail(cause, "that meeting's invitees could not be changed") };
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
        /*
         * WHERE IT GOES (user, 2026-09-06: "they still don't understand the
         * difference between a folder and a project — a folder is for you to
         * group your own tasks; projects are next to it, added by admins for
         * you; when I ask them to create a project they must go there, make
         * it, and add tasks with the person who has to do them").
         *
         * A PROJECT is an admin's order of work with people on it; it owns a
         * folder of its own name on the board (0181), and a card filed there
         * counts toward its progress. A FOLDER is a person's own grouping.
         * Both are named the way a person names them and resolved against
         * the org's own lists; a name nothing matches refuses with the real
         * names, so the model can say them back rather than file the card in
         * a folder that merely sounds alike.
         */
        let topicId: string | undefined;
        let filedIn: string | null = null;
        const wantedProject = typeof a.project === "string" ? a.project.trim() : "";
        const wantedFolder = typeof a.folder === "string" ? a.folder.trim() : "";
        if (wantedProject !== "") {
          const hit = byName(await api.projects(), wantedProject, "project");
          if (!hit.ok) return { ok: false, detail: hit.detail };
          if (hit.row.topic_id === null) {
            return { ok: false, detail: `the project «${hit.row.name}» has no folder on the board any more — an admin has to give it one` };
          }
          topicId = hit.row.topic_id;
          filedIn = hit.row.name;
        } else if (wantedFolder !== "") {
          const hit = byName(board.topics, wantedFolder, "folder");
          if (!hit.ok) return { ok: false, detail: hit.detail };
          topicId = hit.row.id;
          filedIn = hit.row.name;
        }
        /* the column by name, or the board's first */
        let column = board.columns[0];
        const wantedColumn = typeof a.column === "string" ? a.column.trim() : "";
        if (wantedColumn !== "") {
          const hit = byName(board.columns, wantedColumn, "column");
          if (!hit.ok) return { ok: false, detail: hit.detail };
          column = hit.row;
        }
        if (column === undefined) {
          /* a real state with its own sentence, not a crash: an org whose
             board has no columns cannot hold a card yet */
          return { ok: false, detail: "this board has no columns to put a card in" };
        }
        /*
         * THE PERSON, IN THE SAME CREATE. "Make a task for Sina" is one
         * sentence and one act; and it is one TRANSACTION (2026-09-04): a
         * card that exists and belongs to nobody is indistinguishable from
         * one nobody has got to yet, which on an order board is the failure
         * that matters — so an assignee the surface cannot resolve refuses
         * the whole create, by name, rather than filing an orphan.
         */
        let assigneeId: string | undefined;
        let assigneeName: string | null = null;
        const wantedAssignee = typeof a.assignee === "string" ? a.assignee.trim() : "";
        if (wantedAssignee !== "") {
          const who = await resolveColleague(wantedAssignee);
          if (!who.ok) return { ok: false, detail: who.detail };
          assigneeId = who.id;
          assigneeName = who.name;
        }
        const priority = typeof a.priority === "string" && TASK_PRIORITIES.has(a.priority) ? a.priority : undefined;
        await api.createTask({
          title,
          column_id: column.id,
          ...(topicId !== undefined ? { topic_id: topicId } : {}),
          ...(typeof a.description === "string" && a.description.trim() !== ""
            ? { description: a.description.trim() } : {}),
          ...(typeof a.due === "string" && a.due.trim() !== "" ? { due_at: a.due } : {}),
          ...(priority !== undefined ? { priority: priority as never } : {}),
          ...(assigneeId !== undefined ? { assignees: [assigneeId] } : {}),
        });
        surface.push("/tasks");
        announceChange("tasks");
        if (wantedProject !== "") announceChange("projects");
        return {
          ok: true,
          detail: `the task «${title}» was added`
            + (filedIn !== null ? ` in «${filedIn}»` : "")
            + (assigneeName !== null ? ` for ${assigneeName}` : ""),
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
        /* one exact title wins; otherwise ONE partial opens (this is
           navigation, undone by the back button) and several partials ask —
           the FIRST of several used to be opened, in whatever order the list
           came (2026-09-06) */
        const partial = exact.length === 1 ? exact : rows.filter((m) => (m.title ?? "").toLowerCase().includes(lowered));
        if (partial.length === 0) return { ok: false, detail: "no meeting matched that title" };
        if (partial.length > 1) {
          return {
            ok: false,
            detail: `several meetings matched: ${partial.slice(0, 5).map((m) => `«${m.title}»`).join("، ")} — ask the user which`,
          };
        }
        const hit = partial[0]!;
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
