/**
 * Audit Logs (M25, Settings · COMPLIANCE) — the trail's three halves.
 *
 * Three tables record who did what, and they were written by three different
 * milestones with no thought of being read together:
 *
 *   echo.admin_action       — an admin changed something (M12's chain)
 *   echo.proposal_decision  — a human approved or rejected an inferred write (M4)
 *   echo.agent_run          — the assistant did something on someone's behalf (M3)
 *
 * They are unioned into one time-ordered feed because that is the question an
 * auditor actually asks — "what happened in this org, most recent first" —
 * and answering it from three separate endpoints would push the merge into
 * the client, where the ordering rule would be re-implemented and eventually
 * disagree with itself.
 *
 * ── Codes, not content ──────────────────────────────────────────────────────
 *
 * `agent_run.request` and `agent_run.steps` are jsonb holding the prompt and
 * the tool trace: transcript excerpts, quoted documents, whatever the person
 * asked about. **They are not selected here and must never be.** An audit
 * surface answers WHAT HAPPENED, not what was said — and the two are one
 * careless `select *` apart. That is the whole reason this file names every
 * column instead of taking the table's shape.
 *
 * The rule binds writers too: `admin_action.detail` IS forwarded, because it
 * is the record's own payload and an audit entry that cannot say which
 * setting changed is decoration. Whatever writes an admin_action owes it the
 * same discipline — kinds and identifiers, never secret values.
 *
 * Access is RLS's, not this file's: all three tables already scope to
 * `org_id = actor_org_id()` and (for admin_action) `actor_is_admin()`. The
 * route gates on requireAdmin so a member gets one refusal instead of an
 * empty list that looks like an org where nothing has ever happened.
 */
import { ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import { type Db, type SqlTx } from "../db/identity.ts";
import { hasDeletionLedger } from "../db/capabilities.ts";
import type { Identity } from "../agent/types.ts";

/**
 * Re-exported from `vocabulary.ts`, which is where closed vocabularies live
 * so a browser consumer can import them without this module's dependencies.
 * Kept exported here because every existing importer looks for it here.
 */
export { AUDIT_SOURCES, type AuditSource } from "./vocabulary.ts";
import { AUDIT_SOURCES } from "./vocabulary.ts";
import type { AuditSource } from "./vocabulary.ts";

export interface AuditEntry {
  source: AuditSource;
  /** The source row's own id — NOT unique across sources; pair with `source`. */
  id: string;
  at: string;
  actor_id: string;
  /**
   * The actor's display name at read time, or NULL when it cannot be
   * resolved — which on this surface means something specific: the person was
   * tombstoned (M24 true delete empties the name and keeps the row so
   * references still resolve).
   *
   * Joined here rather than left to the client, because the alternative is a
   * second place that maps people to names and the two eventually disagree.
   * NULL is not "unknown"; it is "this actor no longer exists", and an audit
   * screen should render that as something other than a blank.
   */
  actor_name: string | null;
  /** What happened, in the source's own vocabulary (an action, a decision, a status). */
  action: string;
  target_type: string;
  target_id: string | null;
  /** Codes and identifiers. Never prompt text, never transcript, never secrets. */
  detail: Record<string, unknown>;
}

/**
 * Where the next page starts. Opaque to the client — pass it back verbatim.
 *
 * A timestamp alone is NOT a cursor here, and FE3 caught why: the order is
 * `(at, source, id)` but `before` filtered on `at` only, so any rows sharing
 * the last row's exact timestamp were silently skipped at the page boundary.
 * On an audit surface a dropped row is the worst possible kind of nothing —
 * the reader has no way to know the feed lied to them.
 *
 * Three fields, compared row-wise against the same three the ORDER BY uses.
 */
export interface AuditCursor {
  /**
   * FULL-PRECISION timestamp text, not the display `at`, and the difference
   * is a bug rather than a nicety.
   *
   * `iso()` renders milliseconds; Postgres stores microseconds. A cursor
   * carrying the truncated value re-opens the very skip the composite cursor
   * closed: with the last row at `…341567`, a cursor of `…341000` excludes
   * every row between `.341000` and `.341567` — rows that sort AFTER the last
   * one and belong on the next page. The keyset would be correct in shape and
   * lossy in practice.
   *
   * FE3 found the precision detail while reasoning about their own interim
   * `+1ms` workaround. They were describing why a microsecond step would not
   * advance their page; the same fact says my cursor cannot be built from a
   * displayed timestamp.
   *
   * So this is `feed.at::text` straight from Postgres, opaque to the client
   * and deliberately NOT equal to the entry's `at`. Pass it back verbatim.
   */
  at: string;
  source: string;
  id: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  /**
   * Null means the feed is exhausted — the reliable end signal.
   *
   * Prefer it to `entries.length < limit`: that inference happens to hold
   * today (RLS filters inside the union, so the outer LIMIT sees only visible
   * rows), but it is a fact about the query plan rather than a promise, and
   * it would quietly stop being true if the outer query ever filtered.
   */
  next_cursor: AuditCursor | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * One SELECT per source, unioned.
 *
 * Every column is named. `agent_run` in particular contributes a hand-built
 * `detail` object rather than its row: `request` and `steps` are content and
 * stay in the database (see the header).
 */
export const AUDIT_FEED_SQL = `
  select 'admin_action' as source,
         a.id::text as id,
         a.created_at as at,
         a.actor_id,
         a.action,
         a.target_type,
         a.target_id::text as target_id,
         a.detail
    from echo.admin_action a
  union all
  select 'proposal_decision',
         d.proposal_id::text,
         d.decided_at,
         d.decided_by,
         d.decision::text,
         'proposal',
         d.call_id::text,
         jsonb_build_object('kind', d.kind, 'run_id', d.run_id)
    from echo.proposal_decision d
  union all
  select 'agent_run',
         r.id::text,
         r.started_at,
         r.actor_id,
         r.status::text,
         'agent_run',
         r.call_id::text,
         jsonb_build_object(
           'kind', r.kind,
           'model', r.model,
           'skill_id', r.skill_id,
           'tokens_in', r.tokens_in,
           'tokens_out', r.tokens_out,
           'error', r.error,
           'finished_at', r.finished_at
         )
    from echo.agent_run r
`;

/**
 * The deletion ledger's arm (db/0085) — appended only when the table
 * exists (the capability pattern: code deploys ahead of the migration, and
 * a feed naming a missing table would 500 the whole compliance page).
 * The DETAIL carries the actor's reason — their own sentence, the same
 * posture as the platform audit — never titles or content.
 */
export const DELETION_FEED_ARM = `
  union all
  select 'deletion',
         d.id::text,
         d.created_at,
         d.actor_id,
         d.kind,
         'deletion',
         d.target_id::text,
         jsonb_build_object('reason', d.reason)
    from echo.deletion_record d
`;

export function createAuditRepo(db: Db) {
  return {
    /**
     * Most recent first, keyset-paged.
     *
     * ── The bug this shape exists to fix (FE3 found it) ──────────────────────
     *
     * The first version ordered by `(at, source, id)` and filtered `at < $before`.
     * The order was total; the FILTER was not. Any rows sharing the last row's
     * exact timestamp — a burst of admin actions in the same transaction, or
     * an agent run and its proposal decision landing together — fell between
     * the pages and were never shown. Silently.
     *
     * On an audit surface that is the worst kind of nothing available: the
     * reader cannot tell a complete page from a lossy one, and the whole
     * purpose of the screen is that it is complete.
     *
     * So the cursor is the same three fields the ORDER BY uses, compared
     * row-wise. All three sort DESC — the tiebreak direction is arbitrary, and
     * making it uniform is what lets `(a, b, c) < (x, y, z)` mean exactly
     * "strictly after this row in the order", which is the definition of a
     * correct keyset page boundary.
     */
    async list(
      identity: Identity,
      options: {
        limit?: number | undefined;
        cursor?: AuditCursor | undefined;
        source?: string | undefined;
      } = {},
    ): Promise<AuditPage> {
      const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new ValidationError("limit must be a positive number");
      }
      if (options.source !== undefined
          && !AUDIT_SOURCES.includes(options.source as AuditSource)) {
        // Named, not silently ignored: a typo'd filter that quietly returns
        // everything reads as "nothing was filtered out", which on an audit
        // screen is the opposite of the truth the reader wanted.
        throw new ValidationError(`source must be one of: ${AUDIT_SOURCES.join(", ")}`);
      }
      const cursor = options.cursor;
      if (cursor !== undefined) {
        // Parsed only to REJECT nonsense — the value sent to Postgres is the
        // caller's original text, so the microseconds survive the round trip.
        // `new Date(...)` would quietly truncate them, which is the bug this
        // whole cursor exists to avoid.
        if (typeof cursor.at !== "string" || Number.isNaN(new Date(cursor.at).getTime())) {
          throw new ValidationError("cursor.at must be a timestamp");
        }
        if (typeof cursor.source !== "string" || typeof cursor.id !== "string") {
          throw new ValidationError("cursor must carry at, source and id");
        }
      }

      /**
       * One extra row, to answer "is there more" without a second query and
       * without inferring it from the page being short. It is dropped before
       * the entries are returned; its only job is to decide the cursor.
       */
      const feedSql = (await hasDeletionLedger(db))
        ? AUDIT_FEED_SQL + DELETION_FEED_ARM
        : AUDIT_FEED_SQL;
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          // `feed.at::text` keeps the microseconds Postgres stores and the
          // JS Date the driver hands back cannot hold — it is the cursor's
          // value, never the displayed one.
          `select feed.*, feed.at::text as at_cursor, u.display_name as actor_name
             from (${feedSql}) feed
             left join echo.app_user u on u.id = feed.actor_id
            where ($2::timestamptz is null
                   or (feed.at, feed.source, feed.id)
                      < ($2::timestamptz, $3::text, $4::text))
              and ($5::text is null or feed.source = $5::text)
            order by feed.at desc, feed.source desc, feed.id desc
            limit $1`,
          [
            limit + 1,
            // The caller's text verbatim, cast by Postgres — NOT round-tripped
            // through a JS Date, which holds milliseconds only.
            cursor?.at ?? null,
            cursor?.source ?? null,
            cursor?.id ?? null,
            options.source ?? null,
          ],
        ),
      );

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        entries: page.map((row) => ({
          source: row.source as AuditSource,
          id: String(row.id),
          at: iso(row.at),
          actor_id: String(row.actor_id),
          // NULL survives as null: on this surface it means the actor was
          // tombstoned, which is a fact worth rendering, not a blank.
          actor_name: (row.actor_name as string | null) || null,
          action: String(row.action),
          target_type: String(row.target_type),
          target_id: (row.target_id as string | null) ?? null,
          detail: (row.detail as Record<string, unknown>) ?? {},
        })),
        next_cursor: rows.length > limit && last
          // `at_cursor`, not `iso(last.at)` — see AuditCursor. The displayed
          // timestamp and the paging key are deliberately different values.
          ? { at: String(last.at_cursor), source: String(last.source), id: String(last.id) }
          : null,
      };
    },
  };
}

export type AuditRepo = ReturnType<typeof createAuditRepo>;
