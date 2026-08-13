/**
 * SPEC's three agent WRITE tools (M4).
 *
 * The single most important thing in this file: **none of these writes.**
 * Each validates what it was asked to do, under the caller's identity, and
 * returns a proposal. `applyProposal` — called by the confirm endpoint, after
 * a human has approved — is the only code here that mutates anything.
 *
 * That split is the M4 posture, and it is why the tools read oddly thin: a
 * write tool's job is to be *specific enough to judge*. "I'll fix the
 * transcript" is not approvable; "replace segment 14's text, currently «…»,
 * with «…»" is. So each tool reads the current value and returns it as
 * `before`, which costs a query and turns a yes/no into a decision.
 *
 * The floor beneath all of it is db/0014's column grants — echo_agent may
 * update `(text, words)` on a segment and `(label, person_id)` on a speaker,
 * and holds INSERT-only on summary. So even a confirmed proposal cannot move
 * a timeline, reassign a call, or edit a summary in place: it can only do
 * what the agent role can express. The confirm runs on that role for exactly
 * that reason, though a human approved it.
 *
 * Ownership is RLS's: `transcript_update` and `call_speaker_update` are
 * gated on `echo.owns_call(call_id)` — OWNER only, not org, not admin. An
 * admin's assistant cannot correct a call they do not own, and nothing here
 * re-states that rule.
 */
import { randomUUID } from "node:crypto";

import { Type } from "./pi.ts";
import {
  proposalOf, validatePayload,
  type CorrectTranscriptPayload, type EditRosterPayload,
  type ReplaceSummaryPayload, type WriteProposal,
} from "./proposals.ts";
import { ToolDenied, type DomainTool } from "./tools.ts";
import { NotFoundError, ValidationError } from "../api/errors.ts";
import { createCallsRepo } from "../api/calls.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "./types.ts";

export interface WriteToolDeps { db: Db }

/** Excerpt for an approval card. Enough to judge, not the whole transcript. */
const excerpt = (text: string, max = 240): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

export function createWriteTools(): DomainTool<WriteToolDeps, never>[] {
  const correctTranscript: DomainTool<WriteToolDeps, { segment_id: string; text: string }> = {
    name: "correct_transcript",
    label: "اصلاح رونوشت",
    description:
      "PROPOSE a correction to one transcript segment's text. This does not "
      + "change anything by itself — the user is shown the current text and your "
      + "replacement, and must approve it. Correct only what you can hear is "
      + "wrong; do not rewrite for style.",
    parameters: Type.Object({
      segment_id: Type.String({ description: "The segment to correct." }),
      text: Type.String({ description: "The corrected text, in full." }),
    }),
    async run({ identity, deps }, args) {
      const payload = validatePayload("correct_transcript", args) as CorrectTranscriptPayload;
      const rows = await deps.db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ call_id: string; text: string; start_ms: number }>(
          `select call_id, text, start_ms from echo.transcript_segment where id = $1 limit 1`,
          [payload.segment_id],
        ),
      );
      const segment = rows[0];
      // Invisible and non-existent are one answer, as everywhere else.
      if (!segment) throw new ToolDenied("no such segment is visible to you");
      if (segment.text === payload.text) {
        // Proposing a no-op wastes a human's attention, which is the scarcest
        // thing in an approval flow.
        throw new ToolDenied("that segment already reads exactly like that");
      }
      return proposalOf("correct_transcript", {
        id: randomUUID(),
        callId: segment.call_id,
        summary: `اصلاح متن یک بخش از رونوشت در ${Math.floor(segment.start_ms / 1000)} ثانیه`,
        payload,
        // Matched pair, same shape: the card renders them side by side, so a
        // difference in shape between them is a difference the reader has to
        // reconcile. Both excerpted — display only; `payload` is what applies.
        before: { text: excerpt(segment.text) },
        after: { text: excerpt(payload.text) },
      });
    },
  };

  const editRoster: DomainTool<WriteToolDeps, { speaker_id: string; label: string }> = {
    name: "edit_speaker_roster",
    label: "ویرایش فهرست گویندگان",
    description:
      "PROPOSE renaming one speaker on a call — for example from «گوینده ۲» to a "
      + "person's name, when the transcript makes the identity clear. Requires "
      + "the user's approval. Do not guess a name from a greeting alone.",
    parameters: Type.Object({
      speaker_id: Type.String({ description: "The call_speaker row to rename." }),
      label: Type.String({ description: "The new label." }),
    }),
    async run({ identity, deps }, args) {
      const payload = validatePayload("edit_speaker_roster", args) as EditRosterPayload;
      const rows = await deps.db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ call_id: string; label: string }>(
          `select call_id, label from echo.call_speaker where id = $1 limit 1`,
          [payload.speaker_id],
        ),
      );
      const speaker = rows[0];
      if (!speaker) throw new ToolDenied("no such speaker is visible to you");
      if (speaker.label === payload.label) {
        throw new ToolDenied("that speaker is already labelled that way");
      }
      return proposalOf("edit_speaker_roster", {
        id: randomUUID(),
        callId: speaker.call_id,
        summary: `تغییر نام گوینده از «${speaker.label}» به «${payload.label}»`,
        payload,
        before: { label: speaker.label },
        after: { label: payload.label },
      });
    },
  };

  const replaceSummary: DomainTool<WriteToolDeps, { call_id: string; body: string }> = {
    name: "replace_summary",
    label: "جایگزینی خلاصه",
    description:
      "PROPOSE a new summary for a call. The existing summary is never edited "
      + "or deleted — approving this writes a new VERSION, and the old one stays "
      + "readable. Requires the user's approval.",
    parameters: Type.Object({
      call_id: Type.String(),
      body: Type.String({ description: "The full replacement summary, in Persian." }),
    }),
    async run({ identity, deps }, args) {
      const callId = assertUuid(args.call_id, "call id");
      const call = await createCallsRepo(deps.db).get(identity, callId).catch(() => {
        throw new ToolDenied("no call with that id is visible to you");
      });
      const payload = validatePayload("replace_summary", {
        body: args.body,
        // The model that wrote it is part of the record, not decoration —
        // "which model produced this summary" is answerable later only if it
        // is stored at write time.
        model: "agent",
      }) as ReplaceSummaryPayload;

      const current = await deps.db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ version: number; body: string }>(
          `select version, body from echo.summary where call_id = $1
            order by version desc limit 1`,
          [callId],
        ),
      );
      const existing = current[0];
      return proposalOf("replace_summary", {
        id: randomUUID(),
        callId,
        summary: existing
          ? `نوشتن نسخهٔ ${existing.version + 1} خلاصه برای «${call.title}»`
          : `نوشتن نخستین خلاصه برای «${call.title}»`,
        payload,
        ...(existing ? { before: { version: existing.version, body: excerpt(existing.body) } } : {}),
        after: { version: (existing?.version ?? 0) + 1, body: excerpt(payload.body) },
      });
    },
  };

  return [
    correctTranscript as DomainTool<WriteToolDeps, never>,
    editRoster as DomainTool<WriteToolDeps, never>,
    replaceSummary as DomainTool<WriteToolDeps, never>,
  ];
}

/**
 * Perform an approved proposal. The ONLY mutating path in the write flow.
 *
 * Runs on the AGENT role deliberately, though a human approved it: the
 * content is agent-inferred, and db/0014's column grants are the floor that
 * makes "it can only change the text" a property of the connection rather
 * than of this function's SQL. Identity is the confirming person, so RLS
 * still requires them to own the call.
 *
 * Re-validates the payload — minutes can pass between propose and confirm,
 * and the confirm is the write, so the confirm is the check.
 */
export async function applyProposal(
  db: Db, identity: Identity, proposal: WriteProposal, runId: string,
): Promise<{ applied: true; kind: string }> {
  const payload = validatePayload(proposal.kind, proposal.payload);
  const agentRole = { role: "agent" } as const;

  switch (proposal.kind) {
    case "correct_transcript": {
      const { segment_id: segmentId, text } = payload as CorrectTranscriptPayload;
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          // `words` is emptied because they no longer describe this text.
          // Keeping stale word timings against corrected text would put a
          // seek affordance on words that were never said — M20's ladder
          // degrades this row to line-level, which is honest and already
          // handled by every consumer.
          `update echo.transcript_segment set text = $2, words = '[]'::jsonb
            where id = $1 returning id`,
          [segmentId, text],
        ),
        agentRole,
      );
      if (!rows[0]) throw new NotFoundError("segment not found");
      return { applied: true, kind: proposal.kind };
    }
    case "edit_speaker_roster": {
      const { speaker_id: speakerId, label } = payload as EditRosterPayload;
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.call_speaker set label = $2 where id = $1 returning id`,
          [speakerId, label],
        ),
        agentRole,
      );
      if (!rows[0]) throw new NotFoundError("speaker not found");
      return { applied: true, kind: proposal.kind };
    }
    case "replace_summary": {
      const { body, model } = payload as ReplaceSummaryPayload;
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          /**
           * A new VERSION, never an edit (invariant 4). echo_agent holds no
           * UPDATE on summary at all, so this is the only expressible shape —
           * the invariant is enforced by the grant, not by this query.
           *
           * `agent_run_id` is the provenance link, and it is a REAL column: I
           * first wrote `provenance jsonb` here from memory and checked the
           * migration before running it. 0008 has no such column — it has
           * model / skill_id / agent_run_id / created_by, which is the better
           * shape anyway, because it ties the summary to the run whose steps
           * contain the proposal and its approval.
           */
          `insert into echo.summary (call_id, org_id, version, body, model, agent_run_id, created_by)
           select $1, c.org_id,
                  coalesce((select max(version) from echo.summary s where s.call_id = $1), 0) + 1,
                  $2, $3, $5, $4
             from echo.call c where c.id = $1
           returning id`,
          [proposal.call_id, body, model, identity.userId, runId],
        ),
        agentRole,
      );
      if (!rows[0]) throw new NotFoundError("call not found");
      return { applied: true, kind: proposal.kind };
    }
    default:
      throw new ValidationError(`unknown proposal kind: ${String(proposal.kind)}`);
  }
}
