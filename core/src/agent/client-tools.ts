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
 *    "write" carries requires_consent until Act (Phase C). Destructive
 *    surface actions (finish/delete) are deliberately NOT in this registry.
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
const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> =>
  ({ type: "object", properties, ...(required.length ? { required } : {}) });

export type ClientToolEffect = "ui" | "write";

export interface ClientToolSpec {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  effect: ClientToolEffect;
}

/** v1 registry. Labels are Persian-first like the domain tools'. */
export const CLIENT_TOOLS: readonly ClientToolSpec[] = [
  {
    name: "navigate",
    label: "رفتن به صفحه",
    description:
      "Navigate the user's screen to a place in the platform. Use a route "
      + "path such as /echo/calls, /echo/record, /workflows, /settings.",
    parameters: obj({ path: str("In-app route path.") }, ["path"]),
    effect: "ui",
  },
  {
    name: "start_recording",
    label: "شروع ضبط",
    description:
      "Start recording a new call through the user's microphone, optionally "
      + "with a title. The user's surface performs it and may ask them to "
      + "allow it first.",
    parameters: obj({ title: str("Title for the new call.") }),
    effect: "write",
  },
  {
    name: "pause_recording",
    label: "توقف موقت ضبط",
    description: "Pause the recording currently in progress on the user's screen.",
    parameters: obj({}),
    effect: "ui",
  },
  {
    name: "resume_recording",
    label: "ادامهٔ ضبط",
    description: "Resume the paused recording on the user's screen.",
    parameters: obj({}),
    effect: "ui",
  },
  {
    name: "open_call",
    label: "بازکردن جلسه",
    description: "Open one call's detail page on the user's screen.",
    parameters: obj({ call_id: str() }, ["call_id"]),
    effect: "ui",
  },
  {
    name: "set_search",
    label: "جست‌وجو در صفحه",
    description: "Run a search in the product UI and show the results page.",
    parameters: obj({ query: str() }, ["query"]),
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
  },
): DomainTool<unknown, never>[] {
  if (options.autonomy === "watch") return [];
  const offered = CLIENT_TOOLS.filter((spec) => advertised.includes(spec.name));
  const timeoutMs = options.timeoutMs ?? CLIENT_TOOL_TIMEOUT_MS;

  return offered.map((spec) => ({
    name: spec.name,
    label: spec.label,
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
          label: spec.label,
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
