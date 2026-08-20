/**
 * Server management reads (M25) — the Management surface's numbers.
 *
 * ── The rule this file is built around ──────────────────────────────────────
 *
 * **Not measured must never render as zero.** FE2 put it exactly right: "0
 * dead letters" is the most dangerous value this surface can show, because it
 * reads as healthy and an operator acts on it. So every metric carries its own
 * `measured_at`, and a null there means *we did not find out* — the client
 * renders "—" and never a number. Same rule as `history_since` on the stat
 * tiles and `last_seen_at` on people; this is the third place it has mattered.
 *
 * That is also why each metric answers independently rather than the endpoint
 * failing as a unit: one unreadable source must not blank four working ones,
 * and a page-level "not connected" banner over four live numbers is a lie in
 * the other direction.
 *
 * ── What `echo_app` can actually read, measured rather than assumed ─────────
 *
 * The dispatch said queue reads were "already permitted". Half true:
 *
 *   pgmq.list_queues()          OK
 *   select count(*) from q_…    OK   ← depth
 *   select count(*) from a_…    OK   ← archived
 *   pgmq.metrics(), metrics_all()  42501 — permission denied for the queue's
 *                               msg_id SEQUENCE, so the convenient call is
 *                               exactly the one we cannot use
 *   storage.objects / buckets   42501 — permission denied for schema storage
 *
 * So depths are counted directly, and storage usage reports itself
 * unavailable with a reason rather than guessing or returning zero.
 */
import { iso } from "./vocabulary.ts";
import { isPlatformRoot } from "./platform.ts";
import { type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

/**
 * A message read this many times without being deleted has failed that many
 * times. pgmq has no dead-letter queue of its own — `a_…` is the ARCHIVE,
 * which holds successes too — so this is the closest honest proxy, and it is
 * named `retrying` rather than `dead_letters` because that is what it counts.
 * Calling it a dead letter would be a claim the data does not support.
 */
const RETRY_ALARM = 3;

export interface QueueHealth {
  name: string;
  depth: number;
  /** Messages read >= RETRY_ALARM times without completing. */
  retrying: number;
  /** pgmq's archive: completed AND failed messages both land here. */
  archived: number;
}

export interface ServerHealth {
  queues: { measured_at: string | null; unavailable?: string; items: QueueHealth[] };
  keys: { measured_at: string | null; unavailable?: string; active: number | null; revoked: number | null };
  storage: { measured_at: string | null; unavailable?: string; bytes: number | null };
}

/**
 * pgmq table names cannot be parameterised, so they are interpolated — which
 * makes this the one place in the api where a value reaches SQL as text.
 *
 * Two things make it safe, and both are needed: the names come from
 * `pgmq.list_queues()` rather than from a caller, AND each is re-checked
 * against this pattern before use. The second is not redundant — it means a
 * compromised or renamed queue cannot smuggle anything through, and it keeps
 * the guarantee local to the line that needs it instead of depending on what
 * another function returned.
 */
const SAFE_QUEUE_NAME = /^[a-z0-9_]{1,48}$/;

export function createHealthRepo(db: Db) {
  return {
    async read(identity: Identity): Promise<ServerHealth> {
      const now = iso(new Date());
      const health: ServerHealth = {
        queues: { measured_at: null, items: [] },
        keys: { measured_at: null, active: null, revoked: null },
        storage: {
          measured_at: null,
          bytes: null,
          // Stated, not silently null: an operator asking "why is this blank"
          // deserves the answer, and it names the fix (a grant, or a reader
          // running under a role that has one).
          unavailable: "the api role cannot read the storage schema",
        },
      };

      // Queues. Each metric is attempted independently — see the header.
      //
      // Platform-root only (2026-08-20 tenancy audit): pgmq queues are not
      // org-scoped, so these counts are DEPLOYMENT-WIDE — an org admin reading
      // them learns how busy every other tenant is. Counts-only, no content,
      // but activity volume is still a cross-tenant signal. The keys metric
      // below stays for every admin because RLS scopes echo.api_key to their
      // org; this one cannot be scoped, so it is gated instead — and it says
      // so, rather than rendering an empty list that reads as "no queues".
      try {
        if (!(await isPlatformRoot(db, identity))) {
          health.queues.unavailable =
            "queue depths are platform-wide and visible to platform operators only";
        } else {
          await db.withIdentity(identity, async (tx: SqlTx) => {
            const queues = await tx.unsafe<{ queue_name: string }>(
              `select queue_name from pgmq.list_queues() order by queue_name`,
            );
            for (const { queue_name: name } of queues) {
              if (!SAFE_QUEUE_NAME.test(name)) continue;
              const [depth] = await tx.unsafe<{ n: number; retrying: number }>(
                `select count(*)::int as n,
                        count(*) filter (where read_ct >= $1)::int as retrying
                   from pgmq.q_${name}`,
                [RETRY_ALARM],
              );
              const [archived] = await tx.unsafe<{ n: number }>(
                `select count(*)::int as n from pgmq.a_${name}`,
              );
              health.queues.items.push({
                name,
                depth: Number(depth?.n ?? 0),
                retrying: Number(depth?.retrying ?? 0),
                archived: Number(archived?.n ?? 0),
              });
            }
          });
          health.queues.measured_at = now;
        }
      } catch (error) {
        health.queues.items = [];
        health.queues.unavailable = describe(error);
      }

      // Gateway keys: how many are live, how many revoked (M17).
      try {
        const [counts] = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ active: number; revoked: number }>(
            `select count(*) filter (where revoked_at is null)::int  as active,
                    count(*) filter (where revoked_at is not null)::int as revoked
               from echo.api_key`,
          ),
        );
        health.keys.active = Number(counts?.active ?? 0);
        health.keys.revoked = Number(counts?.revoked ?? 0);
        health.keys.measured_at = now;
      } catch (error) {
        health.keys.unavailable = describe(error);
      }

      return health;
    },
  };
}

/**
 * What went wrong, as a CODE rather than a database message.
 *
 * A Postgres error message can quote a row, and this surface is read by
 * people rather than by machines — "permission denied for schema storage" is
 * fine, but the general case is not, so only the SQLSTATE travels.
 */
function describe(error: unknown): string {
  const code = (error as { code?: string })?.code;
  return code === "42501" ? "the api role may not read this" : `unavailable (${code ?? "unknown"})`;
}

export type HealthRepo = ReturnType<typeof createHealthRepo>;
