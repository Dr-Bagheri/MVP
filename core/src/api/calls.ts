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
import { NotFoundError, ValidationError } from "./errors.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface CallSummary {
  id: string;
  title: string;
  scope: "private" | "org";
  status: string;
  language: string;
  startedAt: string;
  durationMs: number | null;
  ownerId: string;
  /** Derived per M20: true only when every part has word timing. */
  wordTimestamps: boolean;
}

/**
 * M20's derived call-level flag: true only when EVERY part has word timing.
 *
 * Derived, not stored: there is no `call_part.word_timestamps` column (I
 * assumed one and checked — the truth lives in `transcript_segment.words`,
 * a jsonb array that a degraded part leaves empty). So "this part has word
 * timing" is "it has at least one segment whose words array is non-empty",
 * and the call is seekable when no part fails that.
 *
 * A call with no parts yet is NOT claimed seekable — absence of evidence
 * isn't evidence of word timing.
 *
 * Cost note: this is two correlated sub-queries per row. Fine for a detail
 * fetch, questionable on a long list — I've asked Backend 3 whether the
 * worker should maintain a stored per-part flag instead (it knows the answer
 * at write time). If that lands, this predicate collapses to a cheap scan.
 */
const CALL_COLUMNS = `
  c.id, c.title, c.scope, c.status, c.language, c.started_at,
  c.duration_ms, c.owner_id,
  (exists (select 1 from echo.call_part p where p.call_id = c.id)
   and not exists (
     select 1
       from echo.call_part p
      where p.call_id = c.id
        and not exists (
          select 1 from echo.transcript_segment s
           where s.part_id = p.id and s.words <> '[]'::jsonb
        )
   )) as word_timestamps
`;

interface CallRow {
  id: string; title: string; scope: "private" | "org"; status: string;
  language: string; started_at: string; duration_ms: number | null;
  owner_id: string; word_timestamps: boolean;
}

const toSummary = (row: CallRow): CallSummary => ({
  id: row.id,
  title: row.title,
  scope: row.scope,
  status: row.status,
  language: row.language,
  startedAt: row.started_at,
  durationMs: row.duration_ms,
  ownerId: row.owner_id,
  wordTimestamps: Boolean(row.word_timestamps),
});

export const MAX_PAGE = 100;

export interface ListOptions {
  limit?: number | undefined;
  /** Keyset pagination: started_at of the last row seen. */
  before?: string | undefined;
}

export function createCallsRepo(db: Db) {
  return {
    async list(identity: Identity, options: ListOptions = {}): Promise<CallSummary[]> {
      const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_PAGE);
      const before = options.before ?? null;
      if (before !== null && Number.isNaN(Date.parse(before))) {
        throw new ValidationError("before must be an ISO timestamp");
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<CallRow>(
          `select ${CALL_COLUMNS}
             from echo.call c
            where c.deleted_at is null
              and ($2::timestamptz is null or c.started_at < $2::timestamptz)
            order by c.started_at desc
            limit $1`,
          [limit, before],
        ),
      );
      return rows.map(toSummary);
    },

    async get(identity: Identity, callId: string): Promise<CallSummary> {
      const id = assertUuid(callId, "call id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<CallRow>(
          `select ${CALL_COLUMNS} from echo.call c
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
      patch: { title?: string | undefined; scope?: "private" | "org" | undefined },
    ): Promise<CallSummary> {
      const id = assertUuid(callId, "call id");
      if (patch.title === undefined && patch.scope === undefined) {
        throw new ValidationError("nothing to update");
      }
      if (patch.title !== undefined && patch.title.trim().length === 0) {
        throw new ValidationError("title cannot be empty");
      }
      if (patch.scope !== undefined && patch.scope !== "private" && patch.scope !== "org") {
        throw new ValidationError("scope must be private or org");
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.call
              set title = coalesce($2, title),
                  scope = coalesce($3::echo.call_scope, scope)
            where id = $1 and deleted_at is null
            returning id`,
          [id, patch.title ?? null, patch.scope ?? null],
        ),
      );
      if (!rows[0]) throw new NotFoundError("call not found");
      return this.get(identity, id);
    },

    /**
     * Soft delete (M11). echo_app holds no DELETE grant anywhere — deletion
     * in this product is setting deleted_at, and the purge job (echo_purge,
     * the only role with DELETE) removes rows after the window.
     */
    async softDelete(identity: Identity, callId: string): Promise<void> {
      const id = assertUuid(callId, "call id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.call
              set deleted_at = now(), deleted_by = $2
            where id = $1 and deleted_at is null
            returning id`,
          [id, identity.userId],
        ),
      );
      if (!rows[0]) throw new NotFoundError("call not found");
    },
  };
}

export type CallsRepo = ReturnType<typeof createCallsRepo>;
