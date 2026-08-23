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
import { Q_AGENT_RULES, Q_LINK_SPEAKERS, Q_SUMMARIZE, type JobPayload, type Queue } from "./queue.ts";
import { StepError, type StepHandler } from "./runner.ts";
import { enqueueWebhooks } from "./webhook-enqueue.ts";
import type { MlClient } from "./ml-client.ts";
import { matchEnrolledVoices, type StorageSignerLike, type VoiceMatchOptions } from "./voice-match.ts";

export interface LinkSpeakersOptions {
  db: Db;
  queue: Queue;
  lifecycle: Lifecycle;
  /** Voice matching (M39) — both optional so every existing wiring and
   *  fake stays valid; matching simply doesn't run without them. */
  ml?: MlClient;
  storage?: StorageSignerLike;
  voiceMatch?: VoiceMatchOptions;
}

/**
 * Give every voice on the roster a snippet the UI can play for identification
 * (SPEC: "a short voice snippet plays for identification"), then hand the call
 * to the summarizer.
 *
 * Linking voices to PEOPLE: hand-linking is the owner's act as ever (M11) —
 * and since M39 the pipeline may also link a voice to a person who ENROLLED
 * a voiceprint (enrollment is the deliberate act M11 requires; a person with
 * no print is never matched, never named). Matching is best-effort: its
 * failure logs and forfeits, never blocks the call.
 */
export function createLinkSpeakersStep({ db, queue, lifecycle, ml, storage, voiceMatch }: LinkSpeakersOptions): StepHandler {
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

      // M39: match unlinked voices against ENROLLED prints — best-effort,
      // never the pipeline's problem when it can't (M21: forfeit out loud)
      if (ml && storage) {
        try {
          await matchEnrolledVoices({
            db, ml, storage, identity, callId: payload.callId, log,
            ...(voiceMatch ? { options: voiceMatch } : {}),
          });
        } catch (cause) {
          log.warn(
            { call_id: payload.callId,
              error_type: (cause as { errorType?: string }).errorType ?? "voice_match_failed" },
            "voice matching forfeited — the call proceeds unnamed",
          );
        }
      }

      await lifecycle.setCallStatus(identity, payload.callId, "summarizing");
      await queue.send(Q_SUMMARIZE, { callId: payload.callId, ownerId: payload.ownerId });
      log.info({ call_id: payload.callId }, "speakers linked; queued summarize");

      // Every part has settled, so the transcript is complete — this is the
      // moment `call.transcribed` becomes true, not when the summary lands.
      await enqueueWebhooks(db, identity, "call.transcribed", payload.callId, queue, log);
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
    /** Regenerate extras (2026-08-23): template key + requester's ask. */
    template?: string | undefined;
    instruction?: string | undefined;
    figures?: boolean | undefined;
  }): Promise<SummaryWritten | SummarySkipped>;
}

export interface SummarizeOptions {
  db: Db;
  lifecycle: Lifecycle;
  summarizer: Summarizer;
  /** For the webhook fan-out; the summarize step queues nothing else. */
  queue: Queue;
  /** Ceiling on transcript characters handed to the model. Context is the budget (M8). */
  maxTranscriptChars?: number;
}

export function createSummarizeStep({
  db,
  lifecycle,
  summarizer,
  queue,
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
        await enqueueWebhooks(db, identity, "call.failed", payload.callId, queue, log);
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
        result = await summarizer.summarize({
          identity,
          callId: payload.callId,
          transcript,
          template: payload.template,
          instruction: payload.instruction,
          figures: payload.figures,
        });
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
      await enqueueWebhooks(db, identity, "call.summarized", payload.callId, queue, log);
      /*
       * M35: announce call.processed on the signals queue — the post-call
       * brief's trigger. Best-effort BY DESIGN: the queue may not exist yet
       * (db/0074 pending), and a missing brief must never fail a call that
       * just finished processing; the warn is the forfeit said out loud.
       */
      try {
        await queue.send(Q_AGENT_RULES, {
          event: "call.processed",
          callId: payload.callId,
          ownerId: identity.userId,
          orgId: identity.orgId,
        });
      } catch (error) {
        log.warn({ event: "signal_enqueue_failed", detail: (error as Error).name }, "call.processed signal not enqueued (db/0074 pending?)");
      }
    },
  };
}
