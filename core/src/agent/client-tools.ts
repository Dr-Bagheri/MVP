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
      + "/ = home hub. "
      + "/echo = New meeting (record in the browser or upload a file — two tabs, recorder first). "
      + "/echo/upload = the New meeting page opened on the UPLOAD tab. "
      + "/echo/records = the RECORDS list (recorded calls/meetings — the section formerly named calls). "
      + "/echo/summaries = summaries of the recordings, gathered for reading. "
      + "/echo/archive = ARCHIVED records (the archive). "
      + "/echo/speakers = speakers directory. "
      + "/conversations = past assistant conversations (history). "
      + "/search = transcript search. "
      + "/workflows = workflows. /agents = agents. "
      + "/management/users = user & member management (people, roles, invitations). "
      + "/management/skills = assistant skills. /management/models = AI models. "
      + "/management/connectors = calendar/mail connectors. "
      + "/management/server = server status (admin). "
      + "/settings = settings home. /settings/general = general settings. "
      + "/settings/assistant = assistant settings (voice, weekly digest). "
      + "/settings/security = security. /settings/audit-logs = audit logs. ",
    parameters: obj({
      path: strEnum([
        "/", "/echo", "/echo/upload", "/echo/records", "/echo/summaries",
        "/echo/archive", "/echo/speakers",
        "/conversations", "/search", "/workflows", "/agents",
        "/management/users", "/management/skills", "/management/models",
        "/management/connectors", "/management/server",
        "/settings", "/settings/general", "/settings/assistant",
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
