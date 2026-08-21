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
];

/** Routes the agent may navigate to — the same set a human can click to. */
/** exported for the seam test: core's navigate enum must stay inside it */
export const NAVIGABLE = /^\/(echo(\/(record|upload|calls|records|summaries|archive|speakers))?|workflows|agents|conversations|settings(\/[a-z-]+)?|management(\/[a-z-]+)?|search)?$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SurfaceContext {
  /** locale-aware push — the i18n router's, so /fa|/en is not the tool's problem */
  push: (path: string) => void;
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

/** a refused api write reads as the SERVER's sentence, not a crash */
function refusalDetail(cause: unknown, fallback: string): string {
  const { status, detail } = cause as { status?: number; detail?: string };
  if (status === 403) return "the server refused: this needs an admin role";
  return detail ?? fallback;
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
    default:
      return { ok: false, detail: "this surface cannot perform that tool" };
  }
}
