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
import type { Identity } from "./types.ts";
import { ToolDenied, type DomainTool } from "./tools.ts";
import { createCallsRepo } from "../api/calls.ts";
import { createTranscriptsRepo } from "../api/transcripts.ts";
import { createMembersRepo } from "../api/members.ts";
import { createMeetingsRepo } from "../api/meetings.ts";
import { NotFoundError } from "../api/errors.ts";
import type { Db } from "../db/identity.ts";
import type { ConnectorItem, ConnectorProvider } from "../api/connector-providers.ts";

/**
 * The connector reads a tool may make ON THE PERSON'S OWN GRANT (2026-09-06).
 * Narrow on purpose: list what is connected, list a source's items — never a
 * credential, never an action (actions are client tools behind the consent
 * card). Optional, because a run that has no connectors (a test, a worker
 * without the store) is a run where the tool refuses by name.
 */
export interface ConnectorReads {
  list(identity: Identity): Promise<{ provider: string; status: string; account_label: string | null }[]>;
  items(identity: Identity, provider: ConnectorProvider, source: string): Promise<ConnectorItem[]>;
}

export interface ToolDeps {
  db: Db;
  connectors?: ConnectorReads | undefined;
}

/** Results are read by a model with a context window, not by a scrollbar. */
const MAX_SEARCH_HITS = 8;
const MAX_WINDOW_SEGMENTS = 120;
const MAX_RELATED_CALLS = 10;
const MAX_MEMBERS = 200;
/* 0209 — the ledger is read whole far more often than a transcript is, so
   the ceiling is generous; `truncated` says when it bit. */
const MAX_DECISIONS = 200;

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


  /**
   * WHO IS IN THIS ORGANIZATION (user directive, 2026-09-03: "they must have
   * the ability to know all members and their roles").
   *
   * A read, so it runs unprompted — the user's own ruling for this pair is
   * "auto for reads, approval for writes", and asking permission to look up a
   * colleague's name would make every ordinary request a negotiation.
   *
   * Bounded the way every tool in this file is bounded: `createMembersRepo`
   * is the repo the members screen itself calls, with THIS caller's identity,
   * so an agent sees exactly the colleagues its user can see and the same
   * fields — RLS answers, not a second query written for a model.
   *
   * Email is included and that is a deliberate call rather than an oversight:
   * it is on the members screen, it is how a person is addressed, and an
   * assistant that can say "Sara" but not reach her is the half-feature this
   * directive exists to close. What is NOT here is anything the screen does
   * not show either.
   */
  const listMembers: DomainTool<ToolDeps, { search?: string; role?: string }> = {
    name: "list_members",
    label: "اعضای سازمان",
    description:
      "The people in this organization and their roles — id, name, username, "
      + "role (owner/admin/member) and status. Use it to answer questions about "
      + "who does what, and to find the id of the person a message should go "
      + "to. It returns only colleagues the user can see. It does NOT return "
      + "email addresses.",
    parameters: Type.Object({
      search: Type.Optional(Type.String({
        description: "Filter by name or username. Omit for everyone.",
      })),
      role: Type.Optional(Type.String({
        description: "Filter to one role: owner, admin or member.",
      })),
    }),
    async run({ identity, deps }, args) {
      const rows = await createMembersRepo(deps.db).roster(identity, {
        search: args.search, role: args.role,
      });
      /* Projected, not passed through. The repo's record grows fields for the
         screen's sake (last_seen_at, avatar_url, job_title…) and a tool that
         spreads the row would silently start feeding every one of them to a
         model the day somebody adds one. Naming the fields is the guard. */
      /*
       * NO EMAIL (2026-09-04). `email` is the one column `30_agent_wall`
       * names by hand — the agent may not read it, deliberately, because a
       * directory an agent can read is a mailing list an agent can read.
       *
       * This tool selected it anyway, through `MEMBER_COLUMNS`, so every
       * agent run that called it died on `permission denied for column
       * email` — a tool seeded into both shipped agents by 0168 and unable
       * to execute for either of them. The projection was already the guard
       * ("naming the fields is the guard", below); it just named one field
       * too many.
       *
       * The repo read is narrowed too, not only the projection: leaving
       * `email` in the SELECT and dropping it here would still be a query
       * the wall refuses, and the tool would keep failing for a reason the
       * output no longer showed.
       */
      const members = rows.slice(0, MAX_MEMBERS).map((m) => ({
        id: m.id,
        name: m.display_name,
        name_en: m.display_name_en,
        username: m.username,
        role: m.role,
        status: m.status,
      }));
      return {
        members,
        count: members.length,
        /* the honest kind of nothing: "nobody matched" is a finding, and
           truncation is a fact about this answer rather than about the org */
        truncated: rows.length > members.length,
      };
    },
  };

  /**
   * 0209 — WHAT THE ORGANISATION DECIDED, as rows rather than paragraphs.
   *
   * This is the read that makes the ledger worth keeping. Without it an agent
   * asked «چه تصمیم‌هایی گرفتیم» has to search transcripts and re-derive from
   * prose what the platform already extracted and a person already confirmed
   * — which is slower, costs a model call, and can disagree with the screen.
   *
   * TWO THINGS IT REFUSES TO BLUR:
   *
   *   · `confirmed` travels on every row. An unconfirmed extraction is a
   *     CLAIM, and an agent that reports one as a decision has fabricated a
   *     decision on the organisation's behalf. The description says so in
   *     words the model reads, and the field says so in data it cannot skip.
   *   · `status` travels too, so «برگشت خورد» is answerable. A ledger whose
   *     reader cannot see what was superseded answers today's question with
   *     last quarter's decision.
   *
   * Visibility is 0209's policy — a decision from a private call reaches only
   * the people the call reaches — so this tool needs no opinion about who may
   * see what, which is the shape every read tool here has.
   */
  const listDecisions: DomainTool<
    ToolDeps,
    { meeting_id?: string; kind?: string; only_open?: boolean }
  > = {
    name: "list_decisions",
    label: "تصمیم‌ها و تعهدها",
    description:
      "Decisions the organization has made and commitments people have given, "
      + "as rows: what was decided, who owes it, by when, which meeting it came "
      + "from and where in the recording it was said. EVERY row carries "
      + "`source`: 'ai' means a model found the sentence in a transcript and "
      + "NOBODY HAS EDITED OR AGREED TO IT — report those as 'found in the "
      + "record', never as settled. `status` says whether a decision still "
      + "stands or was superseded by a later one; `done` ticks a commitment "
      + "off.",
    parameters: Type.Object({
      meeting_id: Type.Optional(Type.String({
        description: "Only this meeting's items. Omit for the whole organization.",
      })),
      kind: Type.Optional(Type.String({
        description: "'decision' or 'commitment'. Omit for both.",
      })),
      only_open: Type.Optional(Type.Boolean({
        description: "Only what is still standing and not ticked off.",
      })),
    }),
    async run({ identity, deps }, args) {
      /* 0211: the ledger IS `meeting_item` (0160) — one table for a meeting's
         decisions, not a second one beside it. `commitment` is this tool's
         word for the ledger's `action`, because that is what a person calls
         it out loud; the mapping lives here and nowhere else. */
      const rows = await createMeetingsRepo(deps.db).ledger(identity, {
        meetingId: args.meeting_id,
        kind: args.kind === "commitment"
          ? "action"
          : args.kind === "decision" ? "decision" : undefined,
        openOnly: args.only_open === true,
      });
      /* projected, never spread: the record grows fields for the screen's
         sake and a tool that passed the row through would start feeding every
         one of them to a model the day somebody adds one */
      const decisions = rows.slice(0, MAX_DECISIONS).map((d) => ({
        id: d.id,
        kind: d.kind === "action" ? "commitment" : d.kind,
        text: d.body,
        /* WHO SAID SO, and it is a fact rather than a flag: 0160 pins
           `source` by the writing ROLE, so 'ai' means a model found the
           sentence and no person has agreed to it. */
        source: d.source,
        owner_id: d.owner_id,
        owner_name: d.owner,
        due_on: d.due_on,
        done: d.done,
        status: d.status,
        meeting_id: d.meeting_id,
        meeting_title: d.meeting_title,
        call_id: d.call_id,
        said_at_ms: d.at_ms,
        supersedes_id: d.supersedes_id,
      }));
      return {
        decisions,
        count: decisions.length,
        truncated: rows.length > decisions.length,
      };
    },
  };

  return [
    searchTranscripts as DomainTool<ToolDeps, never>,
    readWindow as DomainTool<ToolDeps, never>,
    getCall as DomainTool<ToolDeps, never>,
    listRelatedCalls as DomainTool<ToolDeps, never>,
    listMembers as DomainTool<ToolDeps, never>,
    listDecisions as DomainTool<ToolDeps, never>,
  ];
}

/**
 * Every tool this file registers, by name — the list `availableTools()`
 * publishes as the agent vocabulary and the coverage checks (platform-map,
 * tool-registry, delegation's guard 2) read as "the domain tools". It is
 * asserted EQUAL to `createDomainTools()` by domain-tools.test: it sat at the
 * four names db/0015's skill declares while `list_members` (0167) had been
 * registered for days, so a tool the runtime offered was one no agent could
 * declare and no coverage check had looked at (found 2026-09-06). A rename
 * or a new tool fails loudly here, in both directions.
 */
export const DOMAIN_TOOL_NAMES = [
  "search_transcripts", "read_window", "get_call", "list_related_calls", "list_members",
  "list_decisions",
] as const;
