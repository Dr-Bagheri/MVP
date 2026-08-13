/**
 * Proposed writes (M4: an inferred write is proposed, never performed).
 *
 * The three write tools SPEC gives the agent — correct a transcript, edit the
 * speaker roster, replace a summary — do NOT write. Each validates what it
 * was asked to do, under the caller's identity, and returns a **proposal**.
 * A human confirms it through `/v1/assistant/proposals/:id/confirm`, and that
 * request performs the write.
 *
 * ── Why the proposal is re-read from the audit trail, not sent by the client ─
 *
 * A confirm carries `{run_id, proposal_id}` and nothing else. The server
 * re-reads the proposal from `agent_run.steps` — the row the agent appended
 * when it proposed, which `echo_agent` can only append to.
 *
 * The alternative (client posts back the payload it was shown) is tempting
 * and is not obviously unsafe: the confirm executes under the caller's own
 * identity and RLS, so a forged payload can only do what that person could
 * already do by hand. But it breaks the thing the flow exists for. The audit
 * must be able to say *"this is what was proposed, and this is what was
 * approved"*, and if the approved payload arrives from the client those are
 * two unrelated claims. Re-reading makes them the same object by construction.
 *
 * It also means a proposal cannot outlive its evidence: no proposal row, no
 * confirm — which is the correct behaviour for an approval flow and comes
 * free rather than needing an expiry job.
 *
 * (This is why `agent_run.steps` being queryable jsonb mattered beyond the
 * audit: the confirm path reads a step back out of it.)
 */
import { NotFoundError, ValidationError } from "../api/errors.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "./types.ts";

// Declared in api/vocabulary.ts with the other published vocabularies, so
// web/ can import it through @echo/core/vocabulary and assert its own union
// against it. Re-exported here because this is where consumers already look.
export { PROPOSAL_KINDS, type ProposalKind } from "../api/vocabulary.ts";
import type { ProposalKind } from "../api/vocabulary.ts";

/**
 * What the UI renders and what the confirm executes.
 *
 * `summary` is a short Persian sentence for the approval card — the agent's
 * account of what it wants to do. `before`/`after` carry the specific change
 * so a person can judge it without reading the payload, which is the whole
 * point of an approval card rather than a yes/no.
 */
export interface WriteProposal {
  id: string;
  kind: ProposalKind;
  call_id: string;
  summary: string;
  /**
   * The exact change, shaped per kind. AUTHORITATIVE — this is what a confirm
   * applies. Validated when proposed and again when confirmed.
   */
  payload: unknown;
  /**
   * DISPLAY ONLY, and the distinction matters: `before`/`after` may be
   * excerpted for the card, while `payload` carries the full value that is
   * actually written. Never apply `after`.
   *
   * They exist as a matched pair because a card showing only the current
   * value asks for consent while looking like it asks for judgement. The
   * frontend caught that I was emitting `before` and no counterpart at all —
   * the before/after branch of their card was unreachable, so it would have
   * rendered as finished while showing one side of the change.
   */
  before?: unknown;
  after?: unknown;
}

/** A tool returns this; the wrapper detects it and emits an SSE `proposal`. */
export interface ProposalResult {
  proposal: WriteProposal;
  /** What the MODEL is told — never "done", or it will report success. */
  status: "awaiting_confirmation";
}

export function isProposalResult(value: unknown): value is ProposalResult {
  return typeof value === "object" && value !== null
    && (value as ProposalResult).status === "awaiting_confirmation"
    && typeof (value as ProposalResult).proposal?.id === "string";
}

export function proposalOf(
  kind: ProposalKind,
  input: {
    id: string; callId: string; summary: string; payload: unknown;
    before?: unknown; after?: unknown;
  },
): ProposalResult {
  return {
    status: "awaiting_confirmation",
    proposal: {
      id: input.id,
      kind,
      call_id: input.callId,
      summary: input.summary,
      payload: input.payload,
      ...(input.before === undefined ? {} : { before: input.before }),
      ...(input.after === undefined ? {} : { after: input.after }),
    },
  };
}

/** Payload shapes, validated identically when proposed and when confirmed. */
export interface CorrectTranscriptPayload { segment_id: string; text: string }
export interface EditRosterPayload { speaker_id: string; label: string }
export interface ReplaceSummaryPayload { body: string; model: string }

/**
 * Validation runs TWICE — once when proposing, once when confirming — and
 * that is deliberate, not belt-and-braces sloppiness. Minutes can pass
 * between the two, and the world moves: the segment can be deleted, the call
 * can change hands, the person can be disabled. The confirm is the write, so
 * the confirm must be the check.
 */
export function validatePayload(kind: ProposalKind, payload: unknown): unknown {
  const value = (payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "correct_transcript": {
      const segmentId = assertUuid(String(value.segment_id ?? ""), "segment id");
      const text = String(value.text ?? "");
      if (text.trim() === "") throw new ValidationError("corrected text cannot be empty");
      if (text.length > 8_000) throw new ValidationError("corrected text is too long for one segment");
      return { segment_id: segmentId, text } satisfies CorrectTranscriptPayload;
    }
    case "edit_speaker_roster": {
      const speakerId = assertUuid(String(value.speaker_id ?? ""), "speaker id");
      const label = String(value.label ?? "").trim();
      if (label === "") throw new ValidationError("speaker label cannot be empty");
      if (label.length > 120) throw new ValidationError("speaker label is too long");
      return { speaker_id: speakerId, label } satisfies EditRosterPayload;
    }
    case "replace_summary": {
      const body = String(value.body ?? "");
      if (body.trim() === "") throw new ValidationError("summary body cannot be empty");
      const model = String(value.model ?? "").trim();
      if (model === "") throw new ValidationError("a summary records the model that wrote it");
      return { body, model } satisfies ReplaceSummaryPayload;
    }
    default:
      throw new ValidationError(`unknown proposal kind: ${String(kind)}`);
  }
}

/**
 * Find a proposal in a run's recorded steps.
 *
 * Reads `agent_run.steps` under the caller's identity, so a person can only
 * confirm a proposal from a run they can see — which db/0013's `agent_run`
 * policy already decides. No separate ownership check here; that would be a
 * second rule that can disagree with the first.
 */
export async function findProposal(
  db: Db, identity: Identity, runId: string, proposalId: string,
): Promise<WriteProposal> {
  const run = assertUuid(runId, "run id");
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ proposal: WriteProposal | null }>(
      `select e->'proposal' as proposal
         from echo.agent_run, jsonb_array_elements(steps) e
        where id = $1 and e->'proposal'->>'id' = $2
        limit 1`,
      [run, proposalId],
    ),
  );
  const proposal = rows[0]?.proposal;
  // No run, no such proposal, and a run you cannot see are one answer — the
  // same not-probeable posture used everywhere else.
  if (!proposal) throw new NotFoundError("no such proposal");
  return proposal;
}

export type Decision = "confirmed" | "rejected";

/** A second decision on one proposal. Maps to 409, not 500. */
export class AlreadyDecidedError extends Error {}

/**
 * Record the human's decision in the run's own steps.
 *
 * The approval belongs in the same trail as the proposal, so "who confirmed
 * what" is one query rather than a join across two stories. `actor` is the
 * confirming person, who is not necessarily the person the run acted as —
 * an org-scoped call can be corrected by its owner after someone else's
 * assistant proposed the change.
 */
/**
 * Record the decision, and BE the replay refusal.
 *
 * db/0029's `proposal_decision.proposal_id` is the PRIMARY KEY, so a second
 * decision on the same proposal is a unique violation rather than a check
 * this code has to remember to perform. Two racing double-clicks resolve as
 * one insert and one 23505 — race-proof in a single statement, no state
 * machine, and it cannot be forgotten by a future edit the way an `if` can.
 *
 * ── Why this is NOT in one transaction with the write ───────────────────────
 *
 * The steward asked for apply-and-record atomically. It is not expressible:
 * 0029 grants insert on `proposal_decision` to **echo_app only** — "the agent
 * proposes; it does not decide" — while the product write runs on
 * **echo_agent**, so db/0014's column grants stay the floor for
 * agent-inferred content. Different roles are different connections, and a
 * transaction belongs to one connection. The two constraints are each right
 * and jointly forbid atomicity.
 *
 * So the ordering carries the guarantee instead, and it is DECISION FIRST:
 *
 *   1. insert the decision → 23505 means already decided → 409, and the
 *      write never runs. This is what makes a double-click safe, which is
 *      the harm that reaches a user: a replayed `replace_summary` writes a
 *      second version of their summary.
 *   2. apply the write.
 *
 * The residual risk inverts the one I chose before the constraint existed: a
 * decision can now be recorded for a write that then fails. That is visible
 * (the caller gets the error, and the row plainly disagrees with the
 * decision) and it duplicates nothing. Between an audit line to reconcile
 * and a user's summary silently doubled, the reconcilable one is the right
 * risk to keep.
 */
export async function recordDecision(
  db: Db, identity: Identity,
  input: { runId: string; proposal: WriteProposal; decision: Decision; detail?: string },
): Promise<void> {
  const run = assertUuid(input.runId, "run id");
  try {
    await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe(
        `insert into echo.proposal_decision
           (proposal_id, org_id, run_id, call_id, kind, decision, decided_by)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.proposal.id,
          identity.orgId,
          run,
          input.proposal.call_id,
          input.proposal.kind,
          input.decision === "confirmed" ? "approve" : "reject",
          identity.userId,
        ],
      ),
      // echo_app: 0029 deliberately gives echo_agent no grant here. The agent
      // proposes; a person decides, and the decision is written as that
      // person, on the role a person's actions use.
      { role: "app" },
    );
  } catch (error) {
    // 23505 = the primary key. Already decided — approved or rejected, either
    // is final — so this is a conflict, not a fault.
    if ((error as { code?: string })?.code === "23505") {
      throw new AlreadyDecidedError("this proposal has already been decided");
    }
    throw error;
  }
}
