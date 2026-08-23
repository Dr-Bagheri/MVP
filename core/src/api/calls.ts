/**
 * Call queries for /v1.
 *
 * These are deliberately thin. RLS (db/0013) already decides which rows this
 * caller may see — private calls to their owner, org-scoped calls to the org,
 * everything to an admin — so the app layer does NOT re-implement that
 * predicate. Re-stating it here would create two rules that can disagree, and
 * the one in SQL is the one that actually enforces.
 *
 * What the app layer DOES own: shape, pagination bounds, validation, and
 * turning "no row" into a 404 rather than a 403 (existence is information).
 */
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import { hasCallTags } from "../db/capabilities.ts";
import type { Identity } from "../agent/types.ts";

// The published vocabularies live in vocabulary.ts, which imports nothing so
// that web/ can consume it without pulling this module's dependencies.
// Re-exported here because that is where consumers already look.
export {
  CALL_STATUSES, PART_STATUSES, TRANSCRIPT_TIMINGS,
  type CallStatus, type PartStatus, type TranscriptTiming,
} from "./vocabulary.ts";
import { iso, isoOrNull } from "./vocabulary.ts";
import type { TranscriptTiming } from "./vocabulary.ts";

/**
 * db/0032's deletion functions refuse with 42501 — "not yours" for
 * `soft_delete_call`, "admin only" for `restore_call` — and this turns both
 * into the 404 every other invisible row gets. A member must not learn that a
 * deleted call exists by being told they are merely not permitted to touch it.
 *
 * It has to be caught HERE rather than in errors.ts, and the reason is easy to
 * miss: errors.ts pins its RLS branch to `routine === "ExecWithCheckOptions"`,
 * which is the executor's policy path. A plpgsql `raise … using errcode =
 * 'insufficient_privilege'` carries `exec_stmt_raise` instead, so it would
 * sail past that branch into a 500 — the api reporting its own fault for a
 * refusal the database issued on purpose.
 */
/**
 * One part of a call's recording, as the wire sees it.
 *
 * What is deliberately NOT here is the point. `echo.call_part` also carries
 * `storage_bucket`, `storage_path` and `audio_sha256` — where the bytes live
 * and how to verify them. A client never addresses storage directly (audio is
 * served through the api, which is what keeps the sealed-object rule
 * enforceable), so those fields would be pure infrastructure disclosure: a
 * map of the bucket layout handed to anyone who can read a call. `attempts`
 * is retry bookkeeping that means nothing outside the worker.
 *
 * `failure_reason` IS included: a part that failed is a visible gap in the
 * transcript (M20), and "some of this recording is missing" without "why" is
 * the kind of half-answer that generates a support ticket per occurrence.
 */
export interface CallPart {
  id: string;
  /** Position in the recording. THE ordering field — see `parts()`. */
  idx: number;
  offset_ms: number;
  duration_ms: number | null;
  status: string;
  /** M20's ladder: does this part have per-word timing, or only segments? */
  has_word_timestamps: boolean;
  /** The bytes never arrived. A gap the UI must show rather than skip over. */
  missing: boolean;
  failure_reason: string | null;
  audio_format: string | null;
  byte_size: number | null;
}

const PART_COLUMNS = `
  id, idx, offset_ms, duration_ms, status, has_word_timestamps,
  missing, failure_reason, audio_format, byte_size
`;

const toPart = (row: Record<string, unknown>): CallPart => ({
  id: row.id as string,
  idx: Number(row.idx),
  offset_ms: Number(row.offset_ms),
  duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
  status: String(row.status),
  has_word_timestamps: row.has_word_timestamps === true,
  missing: row.missing === true,
  failure_reason: (row.failure_reason as string | null) ?? null,
  audio_format: (row.audio_format as string | null) ?? null,
  // bigint: postgres.js hands these back as strings, and `byte_size: "1048576"`
  // on the wire turns a size comparison into a lexicographic one in the client.
  byte_size: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
});

function refusalIsNotFound(error: unknown): never {
  if ((error as { code?: unknown })?.code === "42501") {
    throw new NotFoundError("call not found");
  }
  throw error;
}

/** One annotation row (0079): a timestamped note or a named chapter. */
export interface CallNote {
  id: string;
  kind: "note" | "chapter";
  at_ms: number | null;
  body: string;
  created_by: string;
  created_at: string;
}

export interface CallSummary {
  id: string;
  title: string;
  scope: "private" | "org";
  /**
   * One of CALL_STATUSES. Typed as string deliberately: a consumer must
   * tolerate a value added by a later migration rather than crashing on it.
   */
  status: string;
  language: string;
  started_at: string;
  duration_ms: number | null;
  owner_id: string;
  /**
   * Lifecycle fields the SCHEMA has always carried and this wire did not.
   *
   * `archived_at`, `deleted_at`, `purge_after` and `current_summary_id` are
   * real columns on `echo.call`; I shipped a narrower select and the frontend
   * built archive/restore, a purge countdown and a version pointer against
   * data the api simply never sent. Not "not built" — unexposed, which from
   * the outside is indistinguishable.
   *
   * `deleted_at` is always null in a normal listing (the query filters
   * soft-deleted rows out); it is here so a future restore surface reads the
   * same shape rather than needing a parallel one.
   */
  source: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  /** When a soft-deleted call becomes purgeable — the countdown's source. */
  purge_after: string | null;
  /** Pointer to the current summary row, or null if none has been written. */
  current_summary_id: string | null;
  /**
   * Provenance summary, NOT a gate (steward-ratified).
   *   "full"  — every part has word timing
   *   "mixed" — some parts do, some fell back to a timing-less lane
   *   "none"  — no part has word timing (or nothing transcribed yet)
   *
   * Deliberately an enum rather than a boolean: a boolean is truthy, and a
   * truthy call-level value invites `call.flag && row.words.length` as a
   * per-row gate — which strips click-a-word from fully-timed rows in a
   * mixed call. The frontend shipped exactly that bug against the boolean.
   * M20's ladder is per ROW: the row's own words array is the only
   * authority. This field exists to explain provenance in the UI, and
   * "mixed" vs "none" is information the boolean could not carry.
   */
  transcript_timing: TranscriptTiming | null;
  /**
   * db/0086 — labels the record wears. ABSENT (not []) until the migration
   * has run on this deployment: a consumer must treat "no field" as
   * "feature not migrated", never as "no tags".
   */
  tags?: string[];
}

/**
 * NOTE the `| null` above, and that it is NOT a fourth enum member: null
 * means "no transcript exists" — nothing has been transcribed yet, or the
 * call failed. "none" would claim a real prose-only transcript exists, which
 * is a lie about a failed call. Absent is not the same as present-and-empty.
 * (The old boolean forced that lie: failed calls carried `true` and nobody
 * noticed, because a boolean has no way to say "not applicable".)
 *
 * The three members are TRANSCRIPT_TIMINGS in vocabulary.ts; the `| null` is
 * deliberately NOT in that list, because it is the absence of a value rather
 * than one of them.
 */

/**
 * "This part has word timing" — now db/0020's stored flag, written by the
 * worker once it has written the whole part.
 *
 * This REPLACED a segment-derived `exists (… s.words <> '[]')`. The two are
 * not the same predicate and the difference matters:
 *
 *   derived = ANY segment has words        stored = ALL segments have words
 *
 * 0020 also ships `tg_segment_words_demote`, which flips the flag false when
 * an agent correction blanks one line's words. That makes the disagreement
 * reachable, not theoretical: after such a correction the derived predicate
 * still reports the part fully timed — it over-claims exactly where the data
 * got worse. The stored flag is conservative by construction (it may demote,
 * never promote), and a conservative flag is the right error to make about a
 * claim the UI shows to users.
 *
 * It is also what 0020 was written for: this used to be a correlated
 * sub-query per row on the list.
 *
 * KNOWN WINDOW, and it is deliberate. The worker asserts the flag once
 * AFTER writing a part's segments, so between "segments landed" and "flag
 * asserted" a part counts as transcribed-but-not-timed and the call reports
 * "none" for an instant before settling on "full". A transient "none" is a
 * strong claim to make wrongly — which is precisely why the frontend
 * suppresses this field until the pipeline has passed transcription, and is
 * the real reason that gate is load-bearing rather than cosmetic.
 */
const PART_HAS_WORDS = `p.has_word_timestamps`;

const PART_HAS_SEGMENTS = `
  exists (
    select 1 from echo.transcript_segment s where s.part_id = p.id
  )
`;

const CALL_COLUMNS = `
  c.id, c.title, c.scope, c.status, c.language, c.started_at,
  c.duration_ms, c.owner_id, c.source, c.archived_at, c.deleted_at,
  c.purge_after, c.current_summary_id,
  (select count(*) from echo.call_part p
    where p.call_id = c.id and ${PART_HAS_SEGMENTS}) as transcribed_part_count,
  (select count(*) from echo.call_part p
    where p.call_id = c.id and ${PART_HAS_WORDS}) as timed_part_count
`;

interface CallRow {
  id: string; title: string; scope: "private" | "org"; status: string;
  language: string; started_at: string; duration_ms: number | null;
  owner_id: string;
  source: string | null;
  archived_at: unknown;
  deleted_at: unknown;
  purge_after: unknown;
  current_summary_id: string | null;
  transcribed_part_count: number | string;
  timed_part_count: number | string;
  /** present only when the 0086 column exists and was selected */
  tags?: string[];
}

/**
 * Counts arrive as strings from pg's bigint — `"2" === 2` is false, so
 * normalise before comparing or every call reports "mixed" in production
 * while every unit test passes.
 *
 * Computed over TRANSCRIBED parts, not all parts: for a call still being
 * processed this reports what the transcript looks like so far, which is
 * honest and self-corrects as parts land. Nothing transcribed → null.
 *
 * A consequence worth stating, because a consumer guessed wrong about it:
 * a part that has not been transcribed yet is not counted AT ALL — it is not
 * an untimed part. So a half-done call whose finished parts are all timed
 * reports "full", not "mixed". Mid-flight the value moves full → mixed (a
 * later part degrades) or none → mixed, never mixed → full: "mixed" is
 * monotone and never retracts once the flags have settled.
 */
export function timingFromCounts(transcribed: number, timed: number): TranscriptTiming | null {
  if (transcribed === 0) return null;   // absent, not "none"
  if (timed === 0) return "none";
  return timed === transcribed ? "full" : "mixed";
}

const toSummary = (row: CallRow): CallSummary => ({
  id: row.id,
  title: row.title,
  scope: row.scope,
  status: row.status,
  language: row.language,
  // Normalised, not passed through. pg hands back a Date; JSON.stringify
  // happens to render that as ISO, so the wire was right by accident while
  // the declared type (`string`) was a lie to anything in-process — a
  // `.slice()` or a `===` against an ISO string would fail on a value that
  // looks fine in a response body.
  started_at: iso(row.started_at),
  duration_ms: row.duration_ms,
  owner_id: row.owner_id,
  source: row.source,
  archived_at: isoOrNull(row.archived_at),
  deleted_at: isoOrNull(row.deleted_at),
  purge_after: isoOrNull(row.purge_after),
  current_summary_id: row.current_summary_id,
  transcript_timing: timingFromCounts(
    Number(row.transcribed_part_count), Number(row.timed_part_count),
  ),
  // absent stays absent — [] would claim "no tags" on an un-migrated deploy
  ...(row.tags !== undefined ? { tags: row.tags } : {}),
});

export const MAX_PAGE = 100;

export interface ListOptions {
  limit?: number | undefined;
  /** Keyset pagination: started_at of the last row seen. */
  before?: string | undefined;
  /** 0086: only calls wearing this tag (array-contains over the GIN index). */
  tag?: string | undefined;
}

export function createCallsRepo(db: Db) {
  return {
    async list(identity: Identity, options: ListOptions = {}): Promise<CallSummary[]> {
      const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_PAGE);
      const before = options.before ?? null;
      if (before !== null && Number.isNaN(Date.parse(before))) {
        throw new ValidationError("before must be an ISO timestamp");
      }
      const withTags = await hasCallTags(db);
      if (options.tag !== undefined && !withTags) {
        // filtering by a column that does not exist must refuse, not
        // silently return everything — a filter that stops filtering is
        // the failure mode, not a fallback
        throw new ConflictError("not_migrated");
      }
      const tag = options.tag?.trim() || null;
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<CallRow>(
          `select ${CALL_COLUMNS}${withTags ? ", c.tags" : ""}
             from echo.call c
            where c.deleted_at is null
              and ($2::timestamptz is null or c.started_at < $2::timestamptz)
              ${withTags ? "and ($3::text is null or c.tags @> array[$3::text])" : ""}
            order by c.started_at desc
            limit $1`,
          withTags ? [limit, before, tag] : [limit, before],
        ),
      );
      return rows.map(toSummary);
    },

    async get(identity: Identity, callId: string): Promise<CallSummary> {
      const id = assertUuid(callId, "call id");
      const withTags = await hasCallTags(db);
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<CallRow>(
          `select ${CALL_COLUMNS}${withTags ? ", c.tags" : ""} from echo.call c
            where c.id = $1 and c.deleted_at is null limit 1`,
          [id],
        ),
      );
      const row = rows[0];
      // invisible and non-existent are the same answer — not probeable
      if (!row) throw new NotFoundError("call not found");
      return toSummary(row);
    },

    /**
     * Rename / re-scope. RLS + db/0011's tg_call_guard decide whether this
     * caller may change these columns; a refused update simply affects no
     * rows, which we report as 404 for the same not-probeable reason.
     */
    async update(
      identity: Identity, callId: string,
      patch: {
        title?: string | undefined;
        scope?: "private" | "org" | undefined;
        /** 0086: the FULL replacement set — tags are a small list someone
            edits whole, so there is no merge semantics to get wrong. */
        tags?: string[] | undefined;
      },
    ): Promise<CallSummary> {
      const id = assertUuid(callId, "call id");
      if (patch.title === undefined && patch.scope === undefined && patch.tags === undefined) {
        throw new ValidationError("nothing to update");
      }
      if (patch.title !== undefined && patch.title.trim().length === 0) {
        throw new ValidationError("title cannot be empty");
      }
      if (patch.scope !== undefined && patch.scope !== "private" && patch.scope !== "org") {
        throw new ValidationError("scope must be private or org");
      }
      let tags: string[] | null = null;
      if (patch.tags !== undefined) {
        if (!(await hasCallTags(db))) throw new ConflictError("not_migrated");
        if (!Array.isArray(patch.tags) || patch.tags.some((t) => typeof t !== "string")) {
          throw new ValidationError("tags must be an array of strings");
        }
        // the api re-speaks the 0086 trigger's sentence; the trigger is the wall
        tags = patch.tags.map((t) => t.trim()).filter((t) => t !== "");
        if (tags.length > 10) {
          throw new ValidationError("at most 10 tags", { code: "too_many_tags", params: { max: 10 } });
        }
        if (tags.some((t) => t.length > 40)) {
          throw new ValidationError("each tag is at most 40 characters",
            { code: "tag_too_long", params: { max: 40 } });
        }
        tags = [...new Set(tags)];
      }
      const withTags = patch.tags !== undefined;
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.call
              set title = coalesce($2, title),
                  scope = coalesce($3::echo.call_scope, scope)
                  ${withTags ? ", tags = $4::text[]" : ""}
            where id = $1 and deleted_at is null
            returning id`,
          withTags
            ? [id, patch.title ?? null, patch.scope ?? null, tags]
            : [id, patch.title ?? null, patch.scope ?? null],
        ),
      );
      if (!rows[0]) throw new NotFoundError("call not found");
      return this.get(identity, id);
    },

    /**
     * The call's parts (M7, M20) — the recording's segments on disk.
     *
     * On the DETAIL response only, never the list. The list already carries
     * `transcribed_part_count` and `timed_part_count`, which is what a list
     * row needs; attaching every part to every row would multiply a page of
     * fifty calls by however many parts each has, to render a number.
     *
     * Order the caller must be able to rely on: `idx`, which is the part's
     * position in the recording. `offset_ms` agrees with it today, and if a
     * future feature ever inserts a part out of band, `idx` is the field that
     * still means "the nth piece".
     *
     * Called AFTER `get()` in the route, and that sequencing is the whole
     * answer to rule 12 here: `call_part_read` filters by `can_read_call`, so
     * a call you may not see and a call with no parts both return zero rows.
     * `get()` has already turned the first case into a 404, so an empty array
     * from here unambiguously means "no parts".
     */
    async parts(identity: Identity, callId: string): Promise<CallPart[]> {
      const id = assertUuid(callId, "call id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${PART_COLUMNS} from echo.call_part
            where call_id = $1 order by idx`,
          [id],
        ),
      );
      return rows.map(toPart);
    },

    /**
     * Archive / unarchive.
     *
     * A timestamp, not a boolean — "when" carries strictly more than
     * "whether", and the archived filter becomes `archived_at is null`
     * rather than a flag that can drift out of sync with the moment it
     * happened. The frontend independently reached the same conclusion from
     * the payload, which is the good kind of agreement.
     *
     * NOT owner-only: db/0011's `tg_call_guard` refuses content edits from a
     * non-owner but says in its own message that "others may archive, delete
     * or restore it". So an admin can file away a call they cannot rewrite,
     * and this layer does not narrow that — RLS and the trigger already say
     * exactly who may do what.
     */
    async setArchived(identity: Identity, callId: string, archived: boolean): Promise<CallSummary> {
      const id = assertUuid(callId, "call id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.call
              set archived_at = case when $2::boolean then now() else null end
            where id = $1 and deleted_at is null
            returning id`,
          [id, archived],
        ),
      );
      // A deleted call cannot be archived: it is already out of the way, and
      // the two states would then need an order of precedence nobody has
      // decided. Reported as 404 like every other invisible row.
      if (!rows[0]) throw new NotFoundError("call not found");
      return this.get(identity, id);
    },

    /**
     * Restore a soft-deleted call within its purge window (M11).
     *
     * The only read in this file that must NOT filter `deleted_at is null` —
     * the row it is looking for is precisely the one every other query hides.
     * Clearing `purge_after` too, or the purge job would still take it: a
     * restore that leaves the countdown running is a promise the product
     * does not keep.
     *
     * Past the window the row may already be gone, and that is a 404 rather
     * than an error — the retention policy did what it said.
     */
    async restore(identity: Identity, callId: string): Promise<CallSummary> {
      const id = assertUuid(callId, "call id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ restored: boolean }>(
          `select echo.restore_call($1::uuid) as restored`, [id],
        ),
      ).catch(refusalIsNotFound);
      // `false` = already live. Idempotent, not an error: two clicks on one
      // restore button is not a failure, and the caller wanted the call back
      // — which it now is. `true` and `false` both end with the same read.
      if (!rows[0]) throw new NotFoundError("no deleted call with that id");
      return this.get(identity, id);
    },

    /**
     * Soft delete (M11) — a named database operation, not an UPDATE.
     *
     * echo_app holds no DELETE grant anywhere: deletion in this product means
     * marking the row, and only echo_purge removes it after the window.
     *
     * The history is worth keeping, because I got the diagnosis half right
     * and the fix wrong. An owner deleting their own call was refused with
     * 42501 while an ADMIN doing the same succeeded. My first theory was that
     * `RETURNING` made Postgres apply the SELECT policy to a row `call_read`
     * hides from non-admins — so I dropped the RETURNING and read the
     * affected count instead. **It still failed.** Setting `deleted_at` moves
     * the row outside the actor's own read policy whether or not you ask to
     * read it back, and Postgres refuses an UPDATE whose result the actor
     * could not see.
     *
     * db/0032 answered it by making deletion a function rather than widening
     * `call_read` — which I had suggested and which would also have worked,
     * at the cost of every call an owner ever deleted becoming permanently
     * visible to them in every listing. That is a ruled product behaviour
     * ("deletion feels like deletion"), and it would then have survived only
     * in whatever WHERE clause this file remembered to write. The rule
     * belongs in the wall, not in my filters.
     *
     * Direct `deleted_at` writes now raise for application roles — including
     * the admin path that used to work. One door, deliberately.
     */
    async softDelete(identity: Identity, callId: string, reason: string): Promise<void> {
      const id = assertUuid(callId, "call id");
      if (reason.trim().length < 3) {
        // 0085: a deletion carries its reason into the ledger — asked at
        // the button, required at every layer beneath it
        throw new ValidationError("a reason is required (at least 3 characters)",
          { code: "reason_required" });
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ deleted: boolean }>(
          `select echo.soft_delete_call($1::uuid, $2::text) as deleted`, [id, reason.trim()],
        ),
      ).catch((cause) => {
        if ((cause as { code?: string }).code === "42883") {
          throw new ConflictError("not_migrated"); // db/0085 pending here
        }
        return refusalIsNotFound(cause);
      });
      // true = deleted, false = already deleted. Both mean "it is gone now",
      // so both are success — a retry is not a failure.
      if (!rows[0]) throw new NotFoundError("call not found");
    },

    /**
     * Notes and chapters (0079) — annotations of a call, never the record.
     * Listed AFTER the route has 404'd unreadable calls via get(), so an
     * empty array means "no notes", not "no access" (the parts pattern —
     * the two nothings are separated by sequencing).
     */
    async listNotes(identity: Identity, callId: string): Promise<CallNote[]> {
      const id = assertUuid(callId, "call id");
      return db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<CallNote>(
          `select id, kind, at_ms, body, created_by, created_at
             from echo.call_note
            where call_id = $1
            order by at_ms nulls last, created_at`,
          [id],
        ),
      );
    },

    async addNote(
      identity: Identity, callId: string,
      input: { kind: string; at_ms?: number | null | undefined; body: string },
    ): Promise<CallNote> {
      const id = assertUuid(callId, "call id");
      if (input.kind !== "note" && input.kind !== "chapter") {
        throw new ValidationError("kind must be note or chapter");
      }
      const body = input.body.trim();
      if (body.length === 0) throw new ValidationError("a note needs words");
      if (body.length > 2000) throw new ValidationError("a note tops out at 2000 characters");
      const atMs = input.at_ms ?? null;
      if (atMs !== null && (!Number.isInteger(atMs) || atMs < 0)) {
        throw new ValidationError("at_ms must be a non-negative integer");
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<CallNote>(
          `insert into echo.call_note (call_id, org_id, kind, at_ms, body, created_by)
           values ($1, $2, $3, $4, $5, $6)
           returning id, kind, at_ms, body, created_by, created_at`,
          [id, identity.orgId, input.kind, atMs, body, identity.userId],
        ),
      ).catch(refusalIsNotFound);
      if (!rows[0]) throw new NotFoundError("call not found");
      return rows[0];
    },

    /** Author's own only — RLS filters, so a foreign id is a clean 404. */
    async deleteNote(identity: Identity, noteId: string): Promise<void> {
      const id = assertUuid(noteId, "note id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `delete from echo.call_note where id = $1 returning id`, [id],
        ),
      );
      if (!rows[0]) throw new NotFoundError("note not found");
    },
  };
}

export type CallsRepo = ReturnType<typeof createCallsRepo>;
