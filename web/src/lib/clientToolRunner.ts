import { api } from "@/api/client";
import type { AgentEvent } from "@/api/types";
import { executeClientTool } from "./agentSurface";
import { grantConsentForSession, sessionGrantCovers } from "./consentGrant";

/**
 * PERFORMING A CLIENT TOOL, once, for every surface that advertises one.
 *
 * ── THE BUG THIS EXISTS FOR (user report, 2026-09-03: "echo stuck in thinking
 * mode") ───────────────────────────────────────────────────────────────────
 *
 * The assistant PAGE advertised `SURFACE_TOOLS` and had no `client_tool_call`
 * case. So the model was told it could start a recording, called
 * `start_recording`, and the browser silently dropped the event — while the
 * server sat waiting for the answer it had asked for. The run hung until the
 * 120-second client-tool timeout, which on screen is a spinner that never
 * stops. Nothing anywhere was red: both halves were individually correct, and
 * the failure lived in the space between them.
 *
 * It is the SAME SEAM that broke once before, and the comment above the
 * offending line said so — "SURFACE_TOOLS was advertised by the voice orb
 * alone, so a TYPED ask reached a model that had been told about no client
 * tools at all". That fix taught the page to ADVERTISE and never taught it to
 * PERFORM. Half a seam closed reads exactly like a whole one.
 *
 * So the handler is one function now, and `clientTools.guard.test.ts` asserts
 * that advertising and performing come in pairs — the same shape as the BFF's
 * declare-and-forward guard, for the same reason.
 *
 * ── WHY THE CALLER STILL PASSES THINGS IN ──────────────────────────────────
 *
 * Consent, navigation and the voice are the surface's own: a sidebar asks in a
 * card inside itself, the page asks in its own frame, and only one of them has
 * a voice to silence. Those are injected. What is NOT injected is the part
 * that must never differ — that every path answers the server exactly once,
 * including the refusals and the throws.
 */
/**
 * What the person answered on the card: this once, for the rest of the
 * browser session (the classes lib/consentGrant.ts names excepted), or no.
 */
export type ConsentAnswer = "once" | "session" | "no";

export interface ClientToolSurface {
  /** ask the person before a write; `detail` names the OBJECT (a task's
      title, a project's name) so the yes is informed — a card that says
      only the verb was approved seven times in a row on 2026-09-06.
      `undefined` means this surface CANNOT ask, and the runner refuses. */
  /** the third argument is the TOOL: the card decides from it whether a
   *  standing yes is even on offer (lib/consentGrant.ts `sessionGrantEligible`) */
  askConsent?: ((label: string, detail: string | null, tool: string) => Promise<ConsentAnswer>) | undefined;
  push(path: string): void;
  switchLocale(next: string): void;
  /** starting or resuming a recording silences the spoken reply, where there is one */
  onRecordingStarted?: (() => void) | undefined;
}

type ClientToolCall = Extract<AgentEvent, { type: "client_tool_call" }>;

/**
 * HOW EACH WRITE TOOL NAMES ITS OBJECT on the consent card.
 *
 * `subject` is the thing acted on (first non-empty key wins); `to` is what
 * it becomes («سینا → admin»); `with` are the other facts a yes should
 * cover, after a colon; `flag` is the boolean that decides the direction
 * (✓ grants / ✗ removes); `excerpt` quotes the first sixty characters of a
 * text a person is about to SEND in their own name.
 *
 * Per tool, because the generic first-name-like-field rule (kept below as
 * the fallback) got the ORDER wrong wherever a tool carries both the object
 * and its new value: `update_project {project, name}` named the NEW name
 * and not the project it was renaming; `rename_record {record, title}` named
 * the title it was about to write; `send_member_message` named the member and
 * dropped the message — the one card where the words ARE the object
 * (2026-09-06, the check-up's agents lens).
 */
interface Naming {
  subject: readonly string[];
  to?: readonly string[];
  with?: readonly string[];
  flag?: string;
  excerpt?: string;
}

const NAMING: Readonly<Record<string, Naming>> = {
  send_member_message: { subject: ["member"], excerpt: "message" },
  set_member_status: { subject: ["member"], to: ["status"] },
  set_member_role: { subject: ["member"], to: ["role"] },
  rename_member: { subject: ["member"], to: ["display_name", "username"] },
  invite_member: { subject: ["email"], to: ["role"] },
  revoke_invitation: { subject: ["email"] },
  rename_record: { subject: ["record"], to: ["title"] },
  set_record_scope: { subject: ["record"], to: ["scope"] },
  archive_record: { subject: ["record"] },
  unarchive_record: { subject: ["record"] },
  delete_record: { subject: ["record"] },
  restore_record: { subject: ["record"] },
  rename_speaker: { subject: ["label"], with: ["record"] },
  link_speaker: { subject: ["person"], with: ["record"] },
  correct_transcript: { subject: ["record"], excerpt: "text" },
  edit_summary: { subject: ["record"], excerpt: "body" },
  send_slack_message: { subject: ["channel"], excerpt: "text" },
  send_telegram_message: { subject: ["chat"], excerpt: "text" },
  send_whatsapp_message: { subject: ["to"], excerpt: "text" },
  create_jira_issue: { subject: ["project"], excerpt: "summary" },
  create_github_issue: { subject: ["repository"], excerpt: "title" },
  create_notion_page: { subject: ["parent"], excerpt: "title" },
  create_zoom_meeting: { subject: ["topic"] },
  call_mcp_tool: { subject: ["tool"], excerpt: "arguments_json" },
  delete_conversation: { subject: ["conversation"] },
  archive_conversation: { subject: ["conversation"], flag: "archived" },
  share_conversation: { subject: ["conversation"], flag: "shared" },
  run_workflow: { subject: ["workflow"] },
  set_model_allowed: { subject: ["model_id"], flag: "allowed" },
  set_role_permission: { subject: ["capability"], with: ["role"], flag: "allowed" },
  update_project: { subject: ["project"], to: ["name"] },
  archive_project: { subject: ["project"], flag: "archived" },
  delete_project: { subject: ["project"] },
  set_project_member: { subject: ["project"], with: ["member"], flag: "member_of" },
  update_task_topic: { subject: ["topic"], to: ["name"], flag: "archived" },
  update_task_column: { subject: ["column"], to: ["name"], flag: "archived" },
  update_task_label: { subject: ["label"], to: ["name"] },
  delete_task_label: { subject: ["label"] },
  update_chat_room: { subject: ["room"], to: ["name"], flag: "archived" },
  create_chat_room: { subject: ["name"] },
  invite_to_meeting: { subject: ["invitees"] },
};

const EXCERPT_CHARS = 60;

/**
 * What the consent card names, from the call's own arguments. Pure, so it is
 * testable and so a card can never show less than the args carry. A tool with
 * no entry above gets the generic rule: the first name-like field, plus the
 * destination when the call moves something.
 */
export function consentDetail(tool: string, args: unknown): string | null {
  const a = (args ?? {}) as Record<string, unknown>;
  const str = (key: string): string | null => {
    const raw = a[key];
    if (typeof raw === "string") return raw.trim() === "" ? null : raw.trim();
    /* A LIST OF NAMES IS AN OBJECT. `invite_to_meeting` takes people in an
       array, and a card that could only read strings named nothing at all —
       which is the shape this whole function exists to end: a yes to the
       verb is a yes to anybody. Five, then a count, because a card is read
       in a glance and a wall of forty names is not read. */
    if (Array.isArray(raw)) {
      const items = raw.filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .map((v) => v.trim());
      if (items.length === 0) return null;
      return items.length <= 5
        ? items.join("، ")
        : `${items.slice(0, 5).join("، ")} +${items.length - 5}`;
    }
    return null;
  };
  const first = (keys: readonly string[]): string | null => keys.map(str).find((v) => v !== null) ?? null;

  const naming = NAMING[tool];
  if (naming !== undefined) {
    const subject = first(naming.subject);
    if (subject === null) return null;
    let out = subject;
    const to = naming.to === undefined ? null : first(naming.to);
    if (to !== null) out += ` → ${to}`;
    const facts = (naming.with ?? []).map(str).filter((v): v is string => v !== null);
    if (facts.length > 0) out += `: ${facts.join("، ")}`;
    if (naming.flag !== undefined && typeof a[naming.flag] === "boolean") out += a[naming.flag] ? " ✓" : " ✗";
    if (naming.excerpt !== undefined) {
      const text = str(naming.excerpt);
      if (text !== null) {
        const cut = text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
        out += `: «${cut}»`;
      }
    }
    return out;
  }

  const subject = first(["title", "name", "project", "topic", "room", "label", "column", "member", "meeting", "question"]);
  const destination = str("folder") ?? (subject !== str("column") ? str("column") : null);
  if (subject === null && destination === null) return null;
  return [subject, destination === null ? null : `← ${destination}`].filter(Boolean).join(" ");
}

export async function handleClientToolCall(
  event: ClientToolCall,
  surface: ClientToolSurface,
): Promise<void> {
  /*
   * ONE answer, on every path — including the ones that throw.
   *
   * The server is blocked on this reply; a path that returns without sending
   * it is the hang this file was written to end, and "I returned early" is the
   * easiest way to write that by accident. The try/finally is what makes the
   * guarantee structural rather than a thing four call sites remember.
   */
  let answered = false;
  const answer = async (ok: boolean, detail: string) => {
    if (answered) return;
    answered = true;
    /* a failed DELIVERY is swallowed: the run is already waiting, and throwing
       here would replace a slow failure with a broken stream */
    await api.deliverToolResult(event.id, ok, detail).catch(() => undefined);
  };

  try {
    /* consent BEFORE execution for write-effect calls; the loop blocks here
       deliberately — the server is waiting on this very answer.

       A surface that CANNOT ask REFUSES. Until 2026-09-06 a missing
       `askConsent` fell through to the execute below — the assistant page
       had no card, so every write asked for there ran on a silent yes, and
       the comment beside the page's surface said the opposite. The server's
       `requires_consent` is the person's dial; a surface with no way to
       honour it has no business performing the call. */
    /* the standing yes (2026-09-06): a person who answered «برای این نشست»
       on an earlier card is not asked again this session — except for a
       delete, which always asks; `sessionGrantCovers` is where that line is
       drawn, so a surface cannot draw it differently */
    if (event.requires_consent && !sessionGrantCovers(event.tool)) {
      if (!surface.askConsent) {
        await answer(false, "this surface cannot ask for consent — the assistant strip can, or set the assistant to act on its own");
        return;
      }
      const reply = await surface.askConsent(event.label, consentDetail(event.tool, event.args), event.tool);
      if (reply === "no") {
        await answer(false, "the user declined");
        return;
      }
      if (reply === "session") grantConsentForSession();
    }

    const result = await executeClientTool(event.tool, event.args, {
      push: surface.push,
      switchLocale: surface.switchLocale,
    });

    if (result.ok && (event.tool === "start_recording" || event.tool === "resume_recording")) {
      surface.onRecordingStarted?.();
    }
    await answer(result.ok, result.detail);
  } catch (cause) {
    /* an exception here is OUR fault, not a refusal, and it still has to reach
       the server — a thrown handler that says nothing is the same hang wearing
       a different cause */
    await answer(false, cause instanceof Error ? cause.message : "the surface could not perform that");
  } finally {
    await answer(false, "the surface did not answer");
  }
}
