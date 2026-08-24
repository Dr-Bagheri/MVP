/**
 * Transcripts, summaries and search for /v1.
 *
 * Same discipline as calls.ts: RLS decides visibility, the app layer owns
 * shape and bounds. Nothing here re-implements who-may-see-what.
 *
 * Search rides the schema's own indexes — `transcript_segment.search` and
 * `summary.search` are generated tsvectors over `echo.fa_fold(...)`, so
 * Persian folding happens in ONE place (the database) rather than being
 * re-implemented in JS where it would drift from the index and quietly stop
 * matching. Queries go through the same fa_fold + websearch_to_tsquery, or
 * the query and the index would disagree about what a word is.
 */
import { NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import { hasSummaryGrounding } from "../db/capabilities.ts";
import type { Identity } from "../agent/types.ts";

export interface TranscriptSegment {
  id: string;
  seq: number;
  /**
   * Which part produced this row. Exposed so a consumer can group by part
   * without inferring membership from `start_ms` against part boundaries —
   * that inference is a client-side reimplementation of something the server
   * already knows, and it would silently mis-group at a boundary.
   */
  part_id: string | null;
  start_ms: number;
  end_ms: number;
  speaker_id: string | null;
  channel: number | null;
  text: string;
  /** [] on a degraded part — the row is still seekable, per M20's ladder. */
  words: TranscriptWord[];
  edited: boolean;
}

/** Wire shape. Storage uses `{w, s, e}` — see `toWords` for why they differ. */
export interface TranscriptWord {
  w: string;
  start_ms: number;
  end_ms: number;
}

/** What the worker actually writes into `transcript_segment.words`. */
interface StoredWord {
  w: string;
  s: number;
  e: number;
}

/**
 * Storage shape → wire shape.
 *
 * These are deliberately different and the translation belongs HERE. The
 * worker stores `{w, s, e}`: a word array is the largest payload in the
 * system and those keys are repeated once per word, so short keys are a real
 * saving in jsonb. The wire is a published contract read by people, so it
 * spells `start_ms`/`end_ms` like every other timestamp in the API.
 *
 * This function is the entire reason the two can differ safely — without it
 * the jsonb went out verbatim and every consumer's `word.start_ms` was
 * `undefined`. That shipped for about an hour and BOTH test suites stayed
 * green, because the worker's fixtures were written in the storage shape and
 * mine in the wire shape, so neither ever saw the other's. `test/…` now pins
 * the storage shape explicitly so a future change to the writer fails a test
 * with a legible name instead of degrading in production.
 *
 * A malformed word degrades the whole ROW to `[]` rather than being coerced.
 * That is not a new concept: `[]` already means "this row has line-level
 * timing only", it is a state every consumer handles, and it is honest.
 * Inventing a 0ms timestamp to fill a gap would put a fabricated number on
 * screen under a seek affordance, which is the one thing worse than no
 * affordance.
 */
export function toWords(raw: unknown): TranscriptWord[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const words: TranscriptWord[] = [];
  for (const item of raw as StoredWord[]) {
    if (
      typeof item?.w !== "string"
      || !Number.isFinite(item.s) || !Number.isFinite(item.e)
    ) {
      return [];   // degrade the row, do not fabricate
    }
    words.push({ w: item.w, start_ms: item.s, end_ms: item.e });
  }
  return words;
}

export interface SpeakerRecord {
  id: string;
  label: string;
  /** Set when the audio was two-channel and no diarization ran (M6). */
  channel: number | null;
  person_id: string | null;
  /** The linked person's name and title code, joined at read (0062) —
   *  null when the speaker is unlinked, which is a normal state. */
  person_name: string | null;
  person_title: string | null;
  sample_start_ms: number | null;
  sample_end_ms: number | null;
}

export interface SummaryVersion {
  id: string;
  version: number;
  body: string;
  model: string;
  created_at: string;
  created_by: string;
  agent_run_id: string | null;
  /**
   * 0087 grounding report. ABSENT until the migration runs on the
   * deployment; null = this version was never checked; otherwise the
   * verdict written at insert (clean, checking model, flagged claims).
   */
  grounding?: { clean: boolean; model: string; flags: { claim: string; note: string }[] } | null;
}

export interface SearchHit {
  call_id: string;
  call_title: string;
  /** "call" = the TITLE matched — the call itself, findable before it has words. */
  kind: "transcript" | "summary" | "call";
  /** Present for transcript hits so the client can seek to the moment. */
  start_ms: number | null;
  end_ms: number | null;
  snippet: string;
}

export const MAX_SEGMENTS = 2_000;
export const MAX_HITS = 50;

export function createTranscriptsRepo(db: Db) {
  return {
    /**
     * Windowed read: the whole transcript is unbounded, so callers page by
     * time. The agent's read_window tool uses the same shape (M4), which is
     * why the bound lives here rather than in each caller.
     */
    async segments(
      identity: Identity, callId: string,
      window: { fromMs?: number | undefined; toMs?: number | undefined; limit?: number | undefined } = {},
    ): Promise<TranscriptSegment[]> {
      const id = assertUuid(callId, "call id");
      const limit = Math.min(Math.max(window.limit ?? 500, 1), MAX_SEGMENTS);
      const fromMs = window.fromMs ?? null;
      const toMs = window.toMs ?? null;
      if (fromMs !== null && !Number.isFinite(fromMs)) throw new ValidationError("from_ms must be a number");
      if (toMs !== null && !Number.isFinite(toMs)) throw new ValidationError("to_ms must be a number");

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select s.id, s.seq, s.part_id, s.start_ms, s.end_ms,
                  s.call_speaker_id, s.channel,
                  s.text, s.words, (s.edited_at is not null) as edited
             from echo.transcript_segment s
            where s.call_id = $1
              and ($2::int is null or s.end_ms   >= $2::int)
              and ($3::int is null or s.start_ms <= $3::int)
            order by s.start_ms, s.seq
            limit $4`,
          [id, fromMs, toMs, limit],
        ),
      );
      return rows.map((row) => ({
        id: row.id as string,
        seq: row.seq as number,
        part_id: (row.part_id as string | null) ?? null,
        start_ms: row.start_ms as number,
        end_ms: row.end_ms as number,
        speaker_id: (row.call_speaker_id as string | null) ?? null,
        channel: (row.channel as number | null) ?? null,
        text: row.text as string,
        words: toWords(row.words),
        edited: Boolean(row.edited),
      }));
    },

    /**
     * The call's speaker roster.
     *
     * Segments carry `speaker_id` and it is NULLABLE — an unattributed line is
     * a real state, not a gap. Without this route the client has ids it cannot
     * resolve to names, which is how a roster lookup renders `undefined`
     * instead of "unattributed". The frontend found exactly that.
     */
    async speakers(identity: Identity, callId: string): Promise<SpeakerRecord[]> {
      const id = assertUuid(callId, "call id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          // LEFT join: an unlinked speaker is a normal state, not a lost row
          `select s.id, s.label, s.channel, s.person_id,
                  s.sample_start_ms, s.sample_end_ms,
                  p.display_name as person_name, p.title as person_title
             from echo.call_speaker s
             left join echo.person p on p.id = s.person_id
            where s.call_id = $1
            order by s.label`,
          [id],
        ),
      );
      return rows.map((row) => ({
        id: row.id as string,
        label: row.label as string,
        channel: (row.channel as number | null) ?? null,
        person_id: (row.person_id as string | null) ?? null,
        person_name: (row.person_name as string | null) ?? null,
        person_title: (row.person_title as string | null) ?? null,
        // Offsets on the call's timeline, never copied audio (db/0005).
        sample_start_ms: (row.sample_start_ms as number | null) ?? null,
        sample_end_ms: (row.sample_end_ms as number | null) ?? null,
      }));
    },

    /** Every version, newest first — a new summary never destroys the old. */
    async summaries(identity: Identity, callId: string): Promise<SummaryVersion[]> {
      const id = assertUuid(callId, "call id");
      const withGrounding = await hasSummaryGrounding(db);
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select id, version, body, model, created_at, created_by, agent_run_id${withGrounding ? ", grounding" : ""}
             from echo.summary
            where call_id = $1
            order by version desc`,
          [id],
        ),
      );
      return rows.map((row) => ({
        id: row.id as string,
        version: row.version as number,
        body: row.body as string,
        model: row.model as string,
        created_at: iso(row.created_at),
        created_by: row.created_by as string,
        agent_run_id: (row.agent_run_id as string | null) ?? null,
        // absent stays absent on an un-migrated deployment
        ...(withGrounding
          ? { grounding: (row.grounding as SummaryVersion["grounding"]) ?? null }
          : {}),
      }));
    },

    async currentSummary(identity: Identity, callId: string): Promise<SummaryVersion> {
      const versions = await this.summaries(identity, callId);
      const current = versions[0];
      // no summary yet and no such call are the same answer to the caller
      if (!current) throw new NotFoundError("no summary for this call");
      return current;
    },

    /**
     * Cross-call search over transcripts and summaries (M8).
     *
     * `echo.fa_fold` + `websearch_to_tsquery` on BOTH sides: the index was
     * built over folded text, so an unfolded query would silently fail to
     * match Persian variants (ي/ی, ك/ک, ZWNJ) — the same normalisation trap
     * the predecessor product hit, except here it would look like "search is
     * just bad" rather than an error.
     *
     * `ts_headline` deliberately runs over the RAW text, not the folded text.
     * fa_fold DELETES ZWNJ (0001, line 94), so highlighting folded text would
     * render «می‌رود» as «میرود» — mangled Persian in every snippet, to gain
     * marks. Raw text costs the opposite: a hit matched only *because* of the
     * fold (Arabic-keyboard spelling, ZWNJ) comes back correct but unmarked,
     * and ts_headline still returns a leading fragment. Right display always,
     * marks nearly always, beats mangled display always. Flagged to the
     * frontend — do NOT fold client-side to recover marks, that reintroduces
     * the drift this centralisation exists to prevent.
     */
    async search(
      identity: Identity, query: string,
      options: { limit?: number | undefined; callId?: string | undefined } = {},
    ): Promise<SearchHit[]> {
      const text = query.trim();
      if (text.length < 2) throw new ValidationError("query must be at least 2 characters");
      const limit = Math.min(Math.max(options.limit ?? 20, 1), MAX_HITS);
      const callId = options.callId ? assertUuid(options.callId, "call id") : null;
      /**
       * Titles match by escaped ILIKE, not tsquery — the members-directory
       * precedent: a NAME lookup is expected to prefix-match («call2» while
       * typing «call»), and websearch_to_tsquery would refuse exactly that.
       * Escaping is what keeps `%`/`_` in a query from silently turning the
       * filter off (2026-08-20: a call named "call2" was invisible to the
       * Sources picker because search only ever indexed transcript text and
       * summaries — a call with no words yet could not be found AT ALL).
       */
      const titlePattern = text.replace(/[\\%_]/g, (c) => `\\${c}`);

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `with q as (select websearch_to_tsquery('simple', echo.fa_fold($1)) as tsq)
           select * from (
             select s.call_id, c.title as call_title, 'transcript' as kind,
                    s.start_ms, s.end_ms,
                    ts_headline('simple', s.text, q.tsq,
                                'StartSel=<mark>,StopSel=</mark>,MaxWords=30,MinWords=10') as snippet,
                    ts_rank(s.search, q.tsq) as rank
               from echo.transcript_segment s
               join echo.call c on c.id = s.call_id
              cross join q
              where s.search @@ q.tsq
                and c.deleted_at is null
                and ($2::uuid is null or s.call_id = $2::uuid)
             union all
             select m.call_id, c.title, 'summary',
                    null::int, null::int,
                    ts_headline('simple', m.body, q.tsq,
                                'StartSel=<mark>,StopSel=</mark>,MaxWords=30,MinWords=10'),
                    ts_rank(m.search, q.tsq)
               from echo.summary m
               join echo.call c on c.id = m.call_id
              cross join q
              where m.search @@ q.tsq
                and c.deleted_at is null
                and ($2::uuid is null or m.call_id = $2::uuid)
             union all
             select c.id, c.title, 'call',
                    null::int, null::int,
                    c.title,
                    1.0::real
               from echo.call c
              where c.deleted_at is null
                and c.title is not null
                and ($2::uuid is null or c.id = $2::uuid)
                and echo.fa_fold(c.title) ilike ('%' || echo.fa_fold($4) || '%') escape '\\'
           ) hits
           order by rank desc, start_ms nulls last
           limit $3`,
          [text, callId, limit, titlePattern],
        ),
      );
      return rows.map((row) => ({
        call_id: row.call_id as string,
        call_title: row.call_title as string,
        kind: row.kind as "transcript" | "summary" | "call",
        start_ms: (row.start_ms as number | null) ?? null,
        end_ms: (row.end_ms as number | null) ?? null,
        snippet: row.snippet as string,
      }));
    },
  };
}

export type TranscriptsRepo = ReturnType<typeof createTranscriptsRepo>;
