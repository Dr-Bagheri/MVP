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
import type { MeetingsRepo } from "../api/meetings.ts";
import { StepError, type StepHandler } from "./runner.ts";
import type { MlClient } from "./ml-client.ts";
import { matchEnrolledVoices, type StorageSignerLike, type VoiceMatchOptions } from "./voice-match.ts";
import { hasCallSummaryModel, hasCallSummaryPrefs, hasOrgGlossary, hasSummaryGrounding, hasSummaryTemplate } from "../db/capabilities.ts";
import { JSONB_PARAM, toJsonb } from "../db/jsonb.ts";
import { createTranscriptsRepo } from "../api/transcripts.ts";
import { nameSpeakers } from "../api/speaker-naming.ts";
import { formatPriorMeetingsBlock, PRIOR_SUMMARY_CHARS, type PriorMeeting } from "./summarizer.ts";

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

      // M39 backfill: a rematch message wants EXACTLY the matching below
      // and none of the pipeline around it — the call already finished
      // once, and moving its status or re-firing call.transcribed would
      // narrate an event that is not happening.
      const rematchOnly = payload.rematch === true;

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

      if (rematchOnly) {
        log.info({ call_id: payload.callId }, "voice rematch pass complete");
        return;
      }

      await lifecycle.setCallStatus(identity, payload.callId, "summarizing");
      await queue.send(Q_SUMMARIZE, { callId: payload.callId, ownerId: payload.ownerId });
      log.info({ call_id: payload.callId }, "speakers linked; queued summarize");

      // Every part has settled, so the transcript is complete — this is the
      // moment `call.transcribed` becomes true, not when the summary lands.
      // The workflow trigger fires at the moment the fact becomes true.
      // (A webhook fan-out stood beside it until 2026-08-29, when the
      // feature was removed — it had never had a consumer.)
      await enqueueWorkflowEvents(db, identity, "call.transcribed", payload.callId, queue, log);
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
  /**
   * 0209 — how many decisions and commitments LANDED as claims.
   *
   * Two nothings, deliberately apart (rule 12): `null` means the pass did not
   * run or its answer could not be read; `0` means a model read the meeting
   * and found nothing decided. A log line that showed them the same way would
   * report a silent meeting when in fact nobody looked.
   */
  claims?: number | null;
  /**
   * 0217 — WHERE the extraction landed: the meeting (null for a plain
   * recording, which has none) and the ids of the rows actually inserted.
   * The aftermath delivery names exactly those rows.
   */
  meetingId?: string | null;
  itemIds?: string[];
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
    /** 2026-09-08: the fenced PRIOR_MEETINGS block retrievePriorContext built
        — quoted data for the writer AND the grounding verifier. */
    priorMeetings?: string | undefined;
  }): Promise<SummaryWritten | SummarySkipped>;
}

/** caps: a model reads the block, and eight searches is the budget per call */
export const PRIOR_MAX_TERMS = 8;
export const PRIOR_MAX_CALLS = 5;
const PRIOR_HITS_PER_TERM = 5;
const PRIOR_SNIPPETS_PER_CALL = 2;

/** the recognition-context fold (ZWNJ dropped, Arabic-keyboard letters
    normalised, case-insensitive) — a term in «چک‌لیست» must find «چکلیست» */
export function foldForMatch(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/‌/g, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ");
}

/**
 * The pure half of prior-context retrieval: which org terms literally occur
 * in this transcript, in the producer's order (glossary, projects, people),
 * de-duplicated, capped. Exported so the matching is testable without a db.
 */
export function termsInTranscript(transcript: string, candidates: readonly string[], max = PRIOR_MAX_TERMS): string[] {
  const haystack = foldForMatch(transcript);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const term = (raw ?? "").replace(/\s+/g, " ").trim();
    if (term.length < 2 || term.length > 80) continue;
    const key = foldForMatch(term);
    if (seen.has(key) || !haystack.includes(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

export interface PriorContextResult {
  /** the fenced block, undefined when nothing prior was found */
  block: string | undefined;
  /** org terms that occurred in the transcript (the title is not one) */
  terms: string[];
  priorCalls: number;
}

/**
 * PRIOR-CONTEXT RETRIEVAL (2026-09-08). Deterministic, before the model
 * runs: the org's own vocabulary — glossary (0088), project names, directory
 * people — is matched LITERALLY against this call's transcript; each term
 * that occurs (plus the call's title) is searched across the owner's earlier
 * calls, excluding this one and anything that started after it; the hits
 * collapse to a few prior calls with their title, date, matched terms, best
 * snippets and the first ~600 chars of their current summary. That is what
 * the summarizer needs to say what «سیمرغ» is and cite the meeting it came
 * from — without depending on the model choosing to call a tool.
 *
 * Read under the CALL OWNER's identity on the app handle, like every other
 * read in this step: the block can only ever quote what the owner could open
 * by hand (M3). Best-effort end to end — a failed retrieval costs the block,
 * never the summary; the caller catches and logs.
 *
 * The queries mirror db/recognition-context.ts's readers (same tables, same
 * bounds) rather than calling it: that reader returns one flat term list, and
 * the ORDER here is the priority under an eight-term cap — a codename beats a
 * colleague's name for "what does this refer to".
 */
export async function retrievePriorContext(opts: {
  db: Db;
  identity: Identity;
  callId: string;
  transcript: string;
}): Promise<PriorContextResult> {
  const { db, identity, callId, transcript } = opts;
  const glossaryColumn = await hasOrgGlossary(db);

  const sources = await db.withIdentity(identity, async (tx: SqlTx) => {
    const [call] = await tx.unsafe<{ title: string | null; started_at: string | Date | null }>(
      `select title, started_at from echo.call where id = $1`,
      [callId],
    );
    const glossary = glossaryColumn
      ? (await tx.unsafe<{ glossary: string[] | null }>(
          `select o.glossary from echo.org o where o.id = $1`, [identity.orgId],
        ))[0]?.glossary ?? []
      : [];
    const projects = await tx.unsafe<{ name: string }>(
      `select pr.name from echo.project pr where pr.org_id = $1 order by pr.name limit 200`,
      [identity.orgId],
    );
    const people = await tx.unsafe<{ display_name: string }>(
      `select p.display_name from echo.person p
        where p.org_id = $1 and p.display_name is not null
        order by p.display_name limit 400`,
      [identity.orgId],
    );
    return {
      title: call?.title ?? null,
      startedAt: call?.started_at ? new Date(call.started_at).toISOString() : null,
      candidates: [...glossary, ...projects.map((r) => r.name), ...people.map((r) => r.display_name)],
    };
  });

  const terms = termsInTranscript(transcript, sources.candidates);
  const title = (sources.title ?? "").replace(/\s+/g, " ").trim();
  // the title is searched too — it is what a person named the meeting — but
  // it is not a "matched term": every titled call would otherwise warn
  const queries = [...(title.length >= 2 && !terms.some((t) => foldForMatch(t) === foldForMatch(title)) ? [title] : []), ...terms];
  if (queries.length === 0) return { block: undefined, terms, priorCalls: 0 };

  const transcripts = createTranscriptsRepo(db);
  const found = new Map<string, { title: string | null; date: string | null; terms: string[]; snippets: string[] }>();
  for (const q of queries) {
    const hits = await transcripts.search(identity, q, {
      limit: PRIOR_HITS_PER_TERM,
      excludeCallId: callId,
      startedBefore: sources.startedAt ?? undefined,
    });
    for (const hit of hits) {
      // the SQL excludes it; this is the belt for a fake or a future repo
      if (hit.call_id === callId) continue;
      let entry = found.get(hit.call_id);
      if (!entry) {
        if (found.size >= PRIOR_MAX_CALLS) continue;
        entry = { title: hit.call_title, date: hit.call_date ?? null, terms: [], snippets: [] };
        found.set(hit.call_id, entry);
      }
      if (!entry.terms.includes(q)) entry.terms.push(q);
      if (hit.kind !== "call" && entry.snippets.length < PRIOR_SNIPPETS_PER_CALL) entry.snippets.push(hit.snippet);
    }
  }
  if (found.size === 0) return { block: undefined, terms, priorCalls: 0 };

  // started_at for the citation (search carries created_at) — one read,
  // under the same identity; a call the read does not return keeps the
  // search's date rather than being dropped, since search already saw it
  const ids = [...found.keys()];
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string; title: string | null; started_at: string | Date | null }>(
      `select id, title, started_at from echo.call where id = any($1::uuid[])`,
      [ids],
    ),
  );
  const started = new Map(rows.map((r) => [r.id, r]));

  const prior: PriorMeeting[] = [];
  for (const id of ids) {
    const entry = found.get(id)!;
    const row = started.get(id);
    let summary: string | null = null;
    try {
      const versions = await transcripts.summaries(identity, id);
      summary = versions[0]?.body.slice(0, PRIOR_SUMMARY_CHARS) ?? null;
    } catch {
      // no summary, or not visible — the snippets still stand
    }
    const startedAt = row?.started_at ? new Date(row.started_at).toISOString() : entry.date;
    prior.push({
      title: row?.title ?? entry.title,
      started_at: startedAt,
      terms: entry.terms,
      snippets: entry.snippets,
      summary,
    });
  }
  // most recent first: "last time" is usually the nearest earlier meeting
  prior.sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));

  return { block: formatPriorMeetingsBlock(prior), terms, priorCalls: prior.length };
}

export interface SummarizeOptions {
  db: Db;
  lifecycle: Lifecycle;
  summarizer: Summarizer;
  /** For the post-call signal and the workflow triggers (M35, M41). */
  queue: Queue;
  /**
   * 0217 — delivers the meeting's aftermath (the roster's «ready» cards, the
   * owners' commitments) once the summary and its extraction have landed.
   * Required, not optional, for the reason `SummarizerOptions.meetings` gives:
   * an optional dependency is how a feature ends up written and never wired.
   */
  meetings: MeetingsRepo;
  /** Ceiling on transcript characters handed to the model. Context is the budget (M8). */
  maxTranscriptChars?: number;
}

export function createSummarizeStep({
  db,
  lifecycle,
  summarizer,
  queue,
  meetings,
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
       * «سینا» instead of a number.
       *
       * THE FALLBACK USED TO BE `cs.label`, AND THAT WAS THE BUG (2026-09-09).
       * `label` is the diarizer's own cluster name (`S1·1`), so on a live take
       * where nobody is linked — no enrolled voiceprint, an empty attendee
       * roster, which is every recording made before somebody enrols — the
       * model was handed `S1·1` as if it were a name, wrote it into the prose
       * («S1·1 reviewed Henry's macros»), and wrote it into the «Owner: …»
       * line that `sliceSummary` turns into `meeting_item.owner`. The screen
       * had stopped rendering that string in 2026-09-06; the prompt had not,
       * and a summary is read by more people than a transcript panel.
       *
       * The roster is fetched FIRST and by label — the same order the
       * speakers route returns (`transcripts.ts`, `order by s.label`), which
       * is the order the browser numbers when it renders «گویندهٔ ۲». The two
       * must agree: "Speaker 2" in the summary naming a different voice from
       * "Speaker 2" in the transcript panel is a summary that is wrong in a
       * way nobody can see. The naming itself is one function both this and
       * the item slicer read (api/speaker-naming.ts).
       */
      const rosterRows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; person_name: string | null; title: string | null }>(
          `select cs.id, p.display_name as person_name, p.title
             from echo.call_speaker cs
             left join echo.person p on p.id = cs.person_id
            where cs.call_id = $1
         order by cs.label`,
          [payload.callId],
        ),
      );
      const nameOf = nameSpeakers(rosterRows);
      const titleOf = new Map(rosterRows.map((r) => [r.id, r.title]));

      const segments = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ text: string; call_speaker_id: string | null }>(
          `select ts.text, ts.call_speaker_id
             from echo.transcript_segment ts
            where ts.call_id = $1
         order by ts.seq`,
          [payload.callId],
        ),
      );

      /* deduped by NAME rather than by row: two clusters linked to one person
         are one person on the roster the model reads */
      const roster = [...new Map(
        rosterRows.map((r) => [nameOf.get(r.id)!, { name: nameOf.get(r.id)!, title: titleOf.get(r.id) ?? null }]),
      ).values()];

      if (segments.length === 0) {
        // Nothing was transcribed — every part is a gap. A summary of nothing
        // would be an invention, and inventing is the one thing a record
        // cannot do.
        await lifecycle.failCall(identity, payload.callId, "no transcript to summarize");
        log.error({ call_id: payload.callId }, "no transcript; call failed rather than summarized");
        return;
      }

      const transcript = segments
        .map((s) => {
          /* a segment whose speaker is not on this call's roster is
             UNATTRIBUTED — its text stands alone rather than under an
             invented name (the same rule speakerNaming.ts states for the
             screen) */
          const name = s.call_speaker_id === null ? undefined : nameOf.get(s.call_speaker_id);
          return name ? `${name}: ${s.text}` : s.text;
        })
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

      /*
       * PRIOR CONTEXT (2026-09-08): what "the Simorgh checklist from last
       * time" refers to, retrieved deterministically before the model runs
       * and handed to the writer AND the verifier as one quoted block.
       * Best-effort: a failed retrieval is a warn and a summary written
       * from the transcript alone. Rule 7: terms that matched with nothing
       * prior found is said out loud — a first meeting on a subject is
       * legitimate, but a search that silently finds nothing looks exactly
       * like it.
       */
      let priorMeetings: string | undefined;
      try {
        const prior = await retrievePriorContext({ db, identity, callId: payload.callId, transcript });
        priorMeetings = prior.block;
        log.info(
          { call_id: payload.callId, event: "summary_prior_context", prior_calls: prior.priorCalls, terms: prior.terms.length },
          "prior-meeting context retrieved",
        );
        if (prior.terms.length > 0 && prior.priorCalls === 0) {
          log.warn(
            { call_id: payload.callId, event: "summary_prior_context_none", terms: prior.terms.length },
            "org terms occur in the transcript but no earlier call matched them",
          );
        }
      } catch (error) {
        log.warn(
          { call_id: payload.callId, event: "summary_prior_context_failed", error_type: (error as Error).name },
          "prior-meeting retrieval failed; summarizing from the transcript alone",
        );
      }

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
          priorMeetings,
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

      /*
       * AUTO-EXTRACT, AND ITS FORFEIT SAID OUT LOUD (0209, M21).
       *
       * The meeting's decisions and commitments land as rows the moment the
       * summary does, rather than waiting for somebody to find the Summary
       * tab's re-run button — and they land from the summarizer's own model pass
       * over the TRANSCRIPT (logged here), not from a second pass over the
       * finished prose. One extractor, so the pipeline and the button cannot
       * disagree about what the meeting decided; the prose slicer stays on the
       * meetings repo (`extractItemsForCall`) for the demo seed and is no longer
       * a second writer racing this one.
       *
       * Four outcomes, and the ones worth separating are the ones that look
       * identical from the outside — "the model answered nothing" and "the model
       * could not be read" both arrive as an empty ledger on the screen:
       *
       *   · `claims` null/undefined — the pass failed or answered unreadably;
       *   · no `meetingId`          — a plain recording has nowhere to land;
       *   · `claims === 0`          — the ledger did not move: either a model
       *                               read the meeting and found nothing, or a
       *                               re-run restated exactly what was already
       *                               there (the replace keeps those rows and
       *                               counts none of them as new);
       *   · anything else           — that many rows landed.
       */
      if (result.claims === null || result.claims === undefined) {
        log.warn(
          { call_id: payload.callId, event: "decision_extract_unread" },
          "decision extraction yielded no readable verdict; the summary is unaffected",
        );
      } else if (result.meetingId === null) {
        log.info(
          { call_id: payload.callId, event: "decision_extract_no_meeting" },
          "a plain recording has no meeting to extract into; the summary is unaffected",
        );
      } else if (result.claims === 0) {
        /* the warn the slicer carried, now for the model pass: a ledger
           that did not move reads on the screen exactly like a quiet meeting,
           so the difference is recorded here rather than left to be guessed
           from an empty list */
        log.warn(
          { call_id: payload.callId, meeting_id: result.meetingId, event: "decision_extract_none" },
          "no new decisions or commitments landed from this transcript",
        );
      } else {
        log.info(
          { call_id: payload.callId, meeting_id: result.meetingId, claims: result.claims },
          "decisions and commitments extracted",
        );
      }

      /*
       * 0217 — THE AFTERMATH REACHES THE PEOPLE IT CONCERNS. Until today the
       * extraction wrote a ledger nobody was told about, and the summary's
       * readiness reached one person (the owner, through the brief). Now the
       * roster is told the summary is ready and each owner is told what they
       * owe — bell cards, written through a definer door that checks this
       * caller is the host and reads every recipient from the meeting's own
       * rows. Best-effort like the signal below: a card that could not be
       * written must never fail the call that just finished processing, and
       * the warn is the forfeit said out loud (M21).
       */
      if (result.meetingId) {
        try {
          const cards = await meetings.deliverMeetingCards(identity, result.meetingId, result.itemIds ?? []);
          log.info(
            { call_id: payload.callId, meeting_id: result.meetingId, event: "meeting_cards_delivered", cards },
            "the meeting's aftermath was delivered to its people",
          );
        } catch (error) {
          log.warn(
            { call_id: payload.callId, meeting_id: result.meetingId, event: "meeting_cards_failed", error_type: (error as Error).name },
            "the meeting's aftermath could not be delivered; the summary is unaffected",
          );
        }
      }

      await lifecycle.setCallStatus(identity, payload.callId, "ready");
      log.info({ call_id: payload.callId, run_id: result.runId }, "call ready");

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
