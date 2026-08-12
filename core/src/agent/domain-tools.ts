/**
 * The agent's read tools (M4) — the four `echo.skill` has declared since
 * db/0015 and nothing implemented.
 *
 * Backend 2 found the gap while chasing a different question: the summarizer
 * skill declares `search_transcripts`, `read_window`, `get_call`,
 * `list_related_calls`; the runtime intersects a skill's declared tools with
 * the tools it was handed; that intersection was **empty**. So SPEC's
 * summarizer — *"reads earlier calls with the same people or subject before it
 * writes"* — has never run, and no test could see it, because SPEC also says
 * *"with nothing prior, it writes from the transcript alone"*. A summary with
 * zero tools is indistinguishable from a correct first-call summary. The
 * absent thing was a legitimate value again.
 *
 * ── What these do NOT do ────────────────────────────────────────────────────
 *
 * No tool here re-implements visibility. Each one calls the SAME repo the
 * REST API calls, with the caller's identity, so a tool can reach exactly
 * what its caller could reach by hand — no more, and no less. That is the
 * whole reason they're thin: a tool with its own query is a second access
 * path that can disagree with the first, and it would be the one nobody
 * reviews, because it is read by a model rather than by a person.
 *
 * The wrapper (tools.ts) closes each over one identity, records a step per
 * attempt, and turns ToolDenied into a readable refusal. Nothing here throws
 * for policy — a NotFoundError from a repo IS the refusal, and it says the
 * same thing for "no such call" as for "not yours" by construction.
 */
import { Type } from "./pi.ts";
import { ToolDenied, type DomainTool } from "./tools.ts";
import { createCallsRepo } from "../api/calls.ts";
import { createTranscriptsRepo } from "../api/transcripts.ts";
import { NotFoundError } from "../api/errors.ts";
import type { Db } from "../db/identity.ts";

export interface ToolDeps {
  db: Db;
}

/** Results are read by a model with a context window, not by a scrollbar. */
const MAX_SEARCH_HITS = 8;
const MAX_WINDOW_SEGMENTS = 120;
const MAX_RELATED_CALLS = 10;

/**
 * A repo's NotFoundError means "you cannot see this" — which for a tool is a
 * refusal the model should read and adapt to, not an error that fails a run.
 * Everything else propagates: a real fault must not be reported to the model
 * as a polite "not found", or the model will confidently tell the user the
 * call doesn't exist.
 */
async function denyingNotFound<T>(work: () => Promise<T>, refusal: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotFoundError) throw new ToolDenied(refusal);
    throw error;
  }
}

export function createDomainTools(): DomainTool<ToolDeps, never>[] {
  const searchTranscripts: DomainTool<ToolDeps, { query: string; call_id?: string }> = {
    name: "search_transcripts",
    label: "جست‌وجوی رونوشت‌ها",
    description:
      "Search across the transcripts and summaries this user may see. Use it to "
      + "find earlier calls on the same subject before writing. Returns snippets "
      + "with the call they came from and, for transcript hits, a timestamp.",
    parameters: Type.Object({
      query: Type.String({ description: "Words to search for. Persian or English." }),
      call_id: Type.Optional(Type.String({ description: "Restrict to one call." })),
    }),
    async run({ identity, deps }, args) {
      const hits = await createTranscriptsRepo(deps.db).search(identity, args.query, {
        limit: MAX_SEARCH_HITS,
        callId: args.call_id,
      });
      // An empty result is a RESULT, not a failure: "nothing prior to find" is
      // exactly the state SPEC says to write from the transcript alone in, and
      // the model must be able to tell it apart from a refusal.
      return { hits, count: hits.length };
    },
  };

  const readWindow: DomainTool<ToolDeps, { call_id: string; from_ms?: number; to_ms?: number }> = {
    name: "read_window",
    label: "خواندن بازه‌ای از رونوشت",
    description:
      "Read a time window of one call's transcript. Prefer a window over the "
      + "whole transcript; a long call will not fit in one read.",
    parameters: Type.Object({
      call_id: Type.String(),
      from_ms: Type.Optional(Type.Number({ description: "Window start in milliseconds." })),
      to_ms: Type.Optional(Type.Number({ description: "Window end in milliseconds." })),
    }),
    async run({ identity, deps }, args) {
      const db = deps.db;
      // The call read is what makes an invisible call a refusal rather than an
      // empty transcript — "this call has no words" is a different claim, and
      // a probeable one.
      await denyingNotFound(
        () => createCallsRepo(db).get(identity, args.call_id),
        "no call with that id is visible to you",
      );
      const segments = await createTranscriptsRepo(db).segments(identity, args.call_id, {
        fromMs: args.from_ms,
        toMs: args.to_ms,
        limit: MAX_WINDOW_SEGMENTS,
      });
      return {
        call_id: args.call_id,
        segments: segments.map((s) => ({
          start_ms: s.start_ms,
          end_ms: s.end_ms,
          speaker_id: s.speaker_id,
          text: s.text,
        })),
        truncated: segments.length === MAX_WINDOW_SEGMENTS,
      };
    },
  };

  const getCall: DomainTool<ToolDeps, { call_id: string }> = {
    name: "get_call",
    label: "اطلاعات جلسه",
    description:
      "Metadata for one call: title, when it happened, how long it was, its "
      + "processing status, and whether its transcript carries word timings.",
    parameters: Type.Object({ call_id: Type.String() }),
    async run({ identity, deps }, args) {
      return denyingNotFound(
        () => createCallsRepo(deps.db).get(identity, args.call_id),
        "no call with that id is visible to you",
      );
    },
  };

  const listRelatedCalls: DomainTool<ToolDeps, { call_id: string; query?: string }> = {
    name: "list_related_calls",
    label: "جلسات مرتبط",
    description:
      "Earlier calls related to this one — the same subject, found by searching "
      + "their transcripts and summaries. Use before writing a summary so it can "
      + "say 'this is the fourth conversation about the same contract'.",
    parameters: Type.Object({
      call_id: Type.String({ description: "The call being written about." }),
      query: Type.Optional(Type.String({
        description: "Subject to relate on. Defaults to the call's title.",
      })),
    }),
    async run({ identity, deps }, args) {
      const db = deps.db;
      const call = await denyingNotFound(
        () => createCallsRepo(db).get(identity, args.call_id),
        "no call with that id is visible to you",
      );
      // Title is the default subject: it is what a person named the meeting,
      // which is a better relatedness signal than anything inferable here, and
      // it keeps the tool useful with one argument.
      const query = (args.query ?? call.title ?? "").trim();
      if (query.length < 2) {
        return { calls: [], count: 0, note: "no subject to relate on" };
      }

      const hits = await createTranscriptsRepo(db).search(identity, query, {
        limit: MAX_RELATED_CALLS * 3,
      });
      // Collapse to calls, drop the call being written about, keep first-seen
      // order (search already ranked them).
      const seen = new Map<string, { call_id: string; title: string; snippet: string }>();
      for (const hit of hits) {
        if (hit.call_id === args.call_id) continue;
        if (!seen.has(hit.call_id)) {
          seen.set(hit.call_id, {
            call_id: hit.call_id,
            title: hit.call_title,
            snippet: hit.snippet,
          });
        }
        if (seen.size >= MAX_RELATED_CALLS) break;
      }
      const calls = [...seen.values()];
      return { calls, count: calls.length, related_on: query };
    },
  };

  return [
    searchTranscripts as DomainTool<ToolDeps, never>,
    readWindow as DomainTool<ToolDeps, never>,
    getCall as DomainTool<ToolDeps, never>,
    listRelatedCalls as DomainTool<ToolDeps, never>,
  ];
}

/** The names db/0015's system skill declares. Kept as one list so a rename fails loudly. */
export const DOMAIN_TOOL_NAMES = [
  "search_transcripts", "read_window", "get_call", "list_related_calls",
] as const;
