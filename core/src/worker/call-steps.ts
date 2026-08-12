/**
 * The per-call steps: `link_speakers` then `summarize`, then the call is ready.
 *
 * Both are idempotent against their artifact rather than a flag (M7), because
 * a flag can be wrong after a crash and a row cannot.
 */
import type { Identity, Skill } from "../agent/types.ts";
import { resolveJobIdentity } from "./job-identity.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Lifecycle } from "./lifecycle.ts";
import { Q_LINK_SPEAKERS, Q_SUMMARIZE, type JobPayload, type Queue } from "./queue.ts";
import { StepError, type StepHandler } from "./runner.ts";

export interface LinkSpeakersOptions {
  db: Db;
  queue: Queue;
  lifecycle: Lifecycle;
}

/**
 * Give every voice on the roster a snippet the UI can play for identification
 * (SPEC: "a short voice snippet plays for identification"), then hand the call
 * to the summarizer.
 *
 * It does NOT link voices to people. That is an owner's deliberate act (M11):
 * voices from private calls never enter the org's directory by passive
 * capture, so the pipeline names nobody.
 */
export function createLinkSpeakersStep({ db, queue, lifecycle }: LinkSpeakersOptions): StepHandler {
  return {
    name: "link_speakers",
    queue: Q_LINK_SPEAKERS,

    async handle(payload: JobPayload, { log }) {
      const identity = await resolveJobIdentity(db, payload);

      // The longest continuous turn is the best sample: it is the clearest
      // stretch of one voice with nobody else in it.
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.call_speaker cs
              set sample_start_ms = best.start_ms,
                  sample_end_ms   = best.end_ms
             from (
               select distinct on (call_speaker_id)
                      call_speaker_id, start_ms, end_ms
                 from echo.transcript_segment
                where call_id = $1 and call_speaker_id is not null
             order by call_speaker_id, (end_ms - start_ms) desc
             ) as best
            where cs.id = best.call_speaker_id
              and cs.call_id = $1
              and cs.sample_start_ms is null`,
          [payload.callId],
        ),
      );

      await lifecycle.setCallStatus(identity, payload.callId, "summarizing");
      await queue.send(Q_SUMMARIZE, { callId: payload.callId, ownerId: payload.ownerId });
      log.info({ call_id: payload.callId }, "speakers linked; queued summarize");
    },
  };
}

/** What the summarizer needs from the rest of core/, injected so it stays testable. */
/** No model could be resolved — the summary is skipped, the call is not. */
export interface SummarySkipped {
  skipped: true;
  reason: string;
}

export interface SummaryWritten {
  skipped?: false;
  body: string;
  model: string;
  runId: string;
  skill?: Skill | undefined;
  failed: boolean;
}

export interface Summarizer {
  /**
   * Runs the summarizer agent as the call's owner and returns the prose plus
   * what produced it. The agent runtime records the run itself (invariant 5).
   */
  summarize(input: {
    identity: Identity;
    callId: string;
    transcript: string;
  }): Promise<SummaryWritten | SummarySkipped>;
}

export interface SummarizeOptions {
  db: Db;
  lifecycle: Lifecycle;
  summarizer: Summarizer;
  /** Ceiling on transcript characters handed to the model. Context is the budget (M8). */
  maxTranscriptChars?: number;
}

export function createSummarizeStep({
  db,
  lifecycle,
  summarizer,
  maxTranscriptChars = 120_000,
}: SummarizeOptions): StepHandler {
  return {
    name: "summarize",
    queue: Q_SUMMARIZE,

    async handle(payload: JobPayload, { log }) {
      const identity = await resolveJobIdentity(db, payload);

      const segments = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ text: string; label: string | null }>(
          `select ts.text, cs.label
             from echo.transcript_segment ts
             left join echo.call_speaker cs on cs.id = ts.call_speaker_id
            where ts.call_id = $1
         order by ts.seq`,
          [payload.callId],
        ),
      );

      if (segments.length === 0) {
        // Nothing was transcribed — every part is a gap. A summary of nothing
        // would be an invention, and inventing is the one thing a record
        // cannot do.
        await lifecycle.failCall(identity, payload.callId, "no transcript to summarize");
        log.error({ call_id: payload.callId }, "no transcript; call failed rather than summarized");
        return;
      }

      const transcript = segments
        .map((s) => (s.label ? `${s.label}: ${s.text}` : s.text))
        .join("\n")
        .slice(0, maxTranscriptChars);

      // The summarizer SKILL failing to resolve is a broken deployment, not a
      // configuration state — so it fails loudly rather than silently falling
      // back to the runtime's own prompt (a summary written on the wrong
      // prompt looks correct, which is what makes it worse than none).
      //
      // Caught here rather than left to propagate so the dead letter NAMES the
      // cause: an operator reading `summarizer_skill_missing` knows to look at
      // the seed or the actor, where `unexpected` would send them to the logs.
      // Retryable on purpose — restoring the seed heals every queued call
      // without anyone replaying them by hand.
      let result;
      try {
        result = await summarizer.summarize({ identity, callId: payload.callId, transcript });
      } catch (error) {
        if ((error as Error)?.name === "MissingSystemSkillError") {
          throw new StepError("summarizer_skill_missing", (error as Error).message, true);
        }
        throw error;
      }

      if (result.skipped) {
        // The call COMPLETES. A summary is a derived artifact and derived
        // artifacts are rebuildable (invariant 1); the transcript — the actual
        // record — is already safe. Failing here would cost someone their
        // recording because nobody had picked a model yet, which is the first
        // call every new user ever makes.
        //
        // The reason is written where an admin can see it, and re-queueing
        // this step once a model exists produces the summary with no other
        // repair needed.
        await lifecycle.setCallStatus(identity, payload.callId, "ready");
        await lifecycle.noteSummarySkipped(identity, payload.callId, result.reason);
        log.warn(
          { call_id: payload.callId, reason: result.reason },
          "summary skipped; call completed without one",
        );
        return;
      }

      if (result.failed || !result.body.trim()) {
        // Retryable: the provider failing is not the call failing. The
        // transcript — the actual record — is already safe.
        throw new StepError("summarizer_failed", "summarizer produced nothing", true);
      }

      // Replacing a summary is an INSERT of a new version; nothing is ever
      // edited in place, and the current one is the highest version (db/0008).
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `insert into echo.summary (call_id, org_id, version, body, model, skill_id, agent_run_id, created_by)
           values (
             $1, $2,
             (select coalesce(max(version), 0) + 1 from echo.summary where call_id = $1),
             $3, $4, $5, $6, $7
           )`,
          [
            payload.callId,
            identity.orgId,
            result.body,
            result.model,
            result.skill?.id ?? null,
            result.runId,
            identity.userId,
          ],
        ),
      );

      await lifecycle.setCallStatus(identity, payload.callId, "ready");
      log.info({ call_id: payload.callId, run_id: result.runId }, "call ready");
    },
  };
}
