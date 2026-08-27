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
import { enqueueWorkflowEvents } from "./workflow-triggers.ts";
import { StepError, type StepHandler } from "./runner.ts";
import { enqueueWebhooks } from "./webhook-enqueue.ts";
import type { MlClient } from "./ml-client.ts";
import { matchEnrolledVoices, type StorageSignerLike, type VoiceMatchOptions } from "./voice-match.ts";
import { hasCallSummaryModel, hasCallSummaryPrefs, hasSummaryGrounding, hasSummaryTemplate } from "../db/capabilities.ts";
import { JSONB_PARAM, toJsonb } from "../db/jsonb.ts";

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
  /** 0087 grounding report, null = unchecked (advisory, never blocking). */
  grounding?: { clean: boolean; model: string; flags: { claim: string; note: string }[] } | null;
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
    /** The call's roster with linked directory names/titles, for the prompt. */
    speakers?: { name: string; title: string | null }[] | undefined;
    /** 0087: run the grounding pass (the step gates this on the column). */
    verify?: boolean | undefined;
    /** 0099: the model TOLD on the new-meeting form — the ladder's top
        rung, outranking even a skill's pin (an instruction beats
        configuration). Undefined = climb the ladder as before. */
    model?: string | undefined;
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

      /*
       * Speaker-AWARE (2026-08-23 quality pass): a segment speaks under the
       * LINKED PERSON's name when the roster knows one — the directory and
       * the M39 voice match already put it there — so the summary says
       * «سینا» instead of «S1·1». The raw label stays the fallback; the
       * transcript rows themselves are untouched.
       */
      const segments = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ text: string; label: string | null }>(
          `select ts.text, coalesce(p.display_name, cs.label) as label
             from echo.transcript_segment ts
             left join echo.call_speaker cs on cs.id = ts.call_speaker_id
             left join echo.person p on p.id = cs.person_id
            where ts.call_id = $1
         order by ts.seq`,
          [payload.callId],
        ),
      );

      const roster = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ name: string; title: string | null }>(
          `select distinct coalesce(p.display_name, cs.label) as name, p.title
             from echo.call_speaker cs
             left join echo.person p on p.id = cs.person_id
            where cs.call_id = $1`,
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

      /*
       * 0094: the PIPELINE's own summarize (no template on the message)
       * honours the choice made on the new-meeting form — it rides the
       * call row. A regenerate message's own template/instruction wins:
       * the requester is standing right there.
       */
      let template = payload.template;
      let instruction = payload.instruction;
      let label = payload.label ?? payload.template;
      if (template === undefined && instruction === undefined && await hasCallSummaryPrefs(db)) {
        const [prefs] = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ summary_template: string | null; summary_instruction: string | null }>(
            `select summary_template, summary_instruction from echo.call where id = $1`,
            [payload.callId],
          ),
        );
        // the stored label is a ruled KEY only when no custom prompt rides
        // beside it (createCall's 0094 contract) — a custom name must never
        // be sent to the summarizer as a template key
        instruction = prefs?.summary_instruction ?? undefined;
        template = instruction === undefined ? (prefs?.summary_template ?? undefined) : undefined;
        label = prefs?.summary_template ?? undefined;
      }

      /*
       * 0099: the model chosen on the new-meeting form. Read UNCONDITIONALLY
       * of the template branch above — a regenerate carries its own template
       * in the payload and skips that read, but the meeting's model choice
       * holds for regenerates too: the person picked it for this CALL, not
       * for one run of the summarizer.
       */
      let chosenModel: string | undefined;
      if (await hasCallSummaryModel(db)) {
        const [row] = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ summary_model: string | null }>(
            `select summary_model from echo.call where id = $1`,
            [payload.callId],
          ),
        );
        chosenModel = row?.summary_model ?? undefined;
      }

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
      // 0087: verify only when the column can hold the verdict — a report
      // with nowhere to land would be spend for nothing
      const verify = await hasSummaryGrounding(db);
      let result;
      try {
        result = await summarizer.summarize({
          identity,
          callId: payload.callId,
          transcript,
          template,
          instruction,
          figures: payload.figures,
          speakers: roster,
          verify,
          model: chosenModel,
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

      if (verify && !result.grounding) {
        // the forfeit said out loud (M21): the summary lands unchecked
        log.warn({ call_id: payload.callId }, "grounding pass yielded no verdict; summary stored unchecked");
      }

      // Replacing a summary is an INSERT of a new version; nothing is ever
      // edited in place, and the current one is the highest version (db/0008).
      // The grounding verdict rides the SAME insert — versions stay
      // append-only, so a verification can never be bolted on later.
      // 0094: the version carries the label of what shaped it — provenance
      // written by the same insert, never remembered client-side
      const withTemplate = await hasSummaryTemplate(db);
      const groundingParam = withTemplate ? 9 : 8;
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `insert into echo.summary (call_id, org_id, version, body, model, skill_id, agent_run_id, created_by${withTemplate ? ", template" : ""}${verify ? ", grounding" : ""})
           values (
             $1, $2,
             (select coalesce(max(version), 0) + 1 from echo.summary where call_id = $1),
             $3, $4, $5, $6, $7${withTemplate ? ", $8" : ""}${verify ? `, ${JSONB_PARAM(groundingParam)}` : ""}
           )`,
          [
            payload.callId,
            identity.orgId,
            result.body,
            result.model,
            result.skill?.id ?? null,
            result.runId,
            identity.userId,
            ...(withTemplate ? [label ?? null] : []),
            // SQL NULL when unchecked — toJsonb(null) would store jsonb
            // 'null', which the 0087 shape constraint rightly refuses
            ...(verify ? [result.grounding ? toJsonb(result.grounding) : null] : []),
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
      /*
       * M41 P4: the EVENT trigger — subscribed workflows fire for this
       * fact, each run owned by the CALL'S owner (W1), enqueued right
       * here where the identity already is them. Best-effort like the
       * signal above: a workflow must never fail the call it rides.
       */
      await enqueueWorkflowEvents(db, identity, "call.summarized", payload.callId, queue, log);
    },
  };
}
