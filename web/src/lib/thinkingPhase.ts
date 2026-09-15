import type { AgentToolCall } from "@/api/types";

/**
 * WHAT THE WAIT IS ACTUALLY DOING — the half of 21st.dev's pending-search
 * that is not the animation.
 *
 * Their `SearchTool` shows «Searching…» and the query while the call runs,
 * and that is the whole point of it: a pending row that names its work tells
 * you whether to wait, and a spinner tells you nothing you did not already
 * know from the fact that you are waiting. Our line said «در حال فکر کردن…»
 * for every second of every run, including the ones spent reading a
 * transcript or writing a task.
 *
 * ── WHY A PHASE AND NOT THE TOOL'S OWN LABEL ──────────────────────────────
 *
 * The stream already carries a human sentence per tool (`tool_call.label`,
 * «جست‌وجوی رونوشت‌ها»), and using it was the first thing I tried. It is
 * written in core/ and it is PERSIAN ONLY — on the English screen it would
 * put Persian in the one line a reader is staring at, against the 2026-09-06
 * ruling that a screen carries one language. Localising forty labels in web/
 * would be a second catalogue of the server's own vocabulary, drifting from
 * the day it landed.
 *
 * So the line names the KIND of work, from the tool's verb: seven phrases,
 * both catalogues, and a tool nobody has classified falls back to the word
 * the line has always used. That fallback is the design and not a gap —
 * **a wrong verb is worse than a general one**, because «در حال نوشتن…» over
 * a read tells the reader something untrue about what the assistant is doing
 * to their data.
 *
 * ── AND WHY THIS IS NOT THE TOOL CHIPS COMING BACK ────────────────────────
 *
 * The chips (removed 2026-09-04) were one per call, under a settled answer,
 * forever. This is ONE line, in place
 * of a line that was already there, and it is gone the moment the first word
 * of the answer lands.
 */
export type ThinkingPhase =
  | "search"
  | "read"
  | "create"
  | "update"
  | "remove"
  | "send"
  | "run";

/**
 * Longest prefix wins, so `set_search` reads as an UPDATE (it changes a
 * setting) while `search_transcripts` reads as a search — the pair that a
 * naive `includes("search")` gets backwards.
 */
const PREFIXES: [string, ThinkingPhase][] = [
  ["search_", "search"],

  ["list_", "read"],
  ["get_", "read"],
  ["read_", "read"],
  ["open_", "read"],
  ["whoami", "read"],
  ["member_stats", "read"],

  ["create_", "create"],
  ["add_", "create"],
  ["invite_", "create"],
  ["install_", "create"],
  ["schedule_", "create"],

  ["update_", "update"],
  ["set_", "update"],
  ["rename_", "update"],
  ["assign_", "update"],
  ["link_", "update"],
  ["tag_", "update"],
  ["mark_", "update"],
  ["complete_", "update"],
  ["approve_", "update"],
  ["correct_", "update"],
  ["edit_", "update"],
  ["comment_", "update"],
  ["restore_", "update"],
  ["unarchive_", "update"],
  ["share_", "update"],

  ["delete_", "remove"],
  ["archive_", "remove"],
  ["revoke_", "remove"],

  ["send_", "send"],

  ["run_", "run"],
  ["retry_", "run"],
  ["extract_", "run"],
  ["translate_", "run"],
  ["resummarize_", "run"],
  ["call_", "run"],
  ["start_", "run"],
  ["pause_", "run"],
  ["resume_", "run"],
  ["finish_", "run"],
  ["navigate", "run"],
];

/** The phase a tool belongs to, or null when nothing classifies it. */
export function thinkingPhase(tool: string): ThinkingPhase | null {
  let best: ThinkingPhase | null = null;
  let bestLength = 0;
  for (const [prefix, phase] of PREFIXES) {
    if (tool.startsWith(prefix) && prefix.length > bestLength) {
      best = phase;
      bestLength = prefix.length;
    }
  }
  return best;
}

/**
 * The phase of the call that is RUNNING RIGHT NOW, or null.
 *
 * `started` is the only live state (`ok`/`denied`/`blocked`/`error` are all
 * endings), and the LAST started one is the current one — the reducer keeps
 * every call on the message and replaces a call by id when it settles, so a
 * finished search sitting above a running read must not name the line.
 */
export function runningPhase(calls: readonly AgentToolCall[]): ThinkingPhase | null {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i]!;
    if (call.state === "started") return thinkingPhase(call.name);
  }
  return null;
}

/** The catalogue key for a phase — `platform.<key>`. */
export const PHASE_KEYS: Record<ThinkingPhase, string> = {
  search: "thinkingSearch",
  read: "thinkingRead",
  create: "thinkingCreate",
  update: "thinkingUpdate",
  remove: "thinkingRemove",
  send: "thinkingSend",
  run: "thinkingRun",
};
