/**
 * Type-vs-catalogue contract check (rule 10, applied to enums).
 *
 * `AgentRunStatus` used to read `running | succeeded | failed` while
 * `echo.agent_run_status` has always been `running | ok | error`. Every
 * terminal write threw `22P02`, so every agent run inserted as `running` and
 * could never leave: the audit trail recorded starts and no endings, and
 * invariant 5 ("runs are replayable") was false in practice.
 *
 * Seven unit tests were green throughout, and could not have been otherwise —
 * **a fake cannot disagree with a schema.** So this test doesn't assert a
 * belief about the database, it reads `pg_enum` and compares. It can go stale
 * only by the database changing, which is exactly when it should fail.
 *
 * Not a vitest file, for the same reason as pipeline-live.ts: it needs a real
 * connection, so it must never run in CI by accident and must never be
 * satisfiable by a mock.
 *
 *   ECHO_APP_DB_URL=… node --experimental-strip-types test/e2e/schema-contract.ts
 *
 * STATUS: written against the dev project's schema as reported by Backend 3.
 * Until it has been RUN against a live database it proves nothing — which is
 * precisely the failure it exists to prevent, so it is worth stating.
 */
import { readdirSync, readFileSync } from "node:fs";

import postgres from "postgres";

import { SYSTEM_SLUGS } from "../../src/agent/skill-store.ts";
import { AUDIT_FEED_SQL, createAuditRepo } from "../../src/api/audit.ts";
import { createMembersRepo, MEMBER_COLUMNS } from "../../src/api/members.ts";
import { createOrgRepo } from "../../src/api/org.ts";
import { THREAD_QUERY } from "../../src/api/sessions.ts";
import { createHealthRepo } from "../../src/api/health.ts";
import { createDb, type SqlClient } from "../../src/db/identity.ts";
import {
  AGENT_RUN_STATUSES, CALL_STATUSES, MEMBER_ROLES, PART_STATUSES,
  USER_STATUSES,
} from "../../src/api/vocabulary.ts";

const url = process.env.ECHO_APP_DB_URL;
if (!url) {
  console.error("ECHO_APP_DB_URL is required (read it from the secret store, never a literal)");
  process.exit(2);
}

/**
 * `idle_in_transaction_session_timeout` is not tuning — it is the fix for a
 * shared-infrastructure incident this harness caused.
 *
 * A run of this file deadlocked (a repo call opened a nested transaction
 * inside the one connection this harness was already holding) and I killed
 * the foreground command without killing the process. It sat `idle in
 * transaction` for THIRTY MINUTES holding AccessShare/RowShare locks on
 * `echo.org`, and Backend 3's `ALTER TABLE` died on `statement_timeout`
 * waiting behind it. The cost landed three packages away from the cause, on
 * someone who had to diagnose it from `pg_stat_activity` and then ask me
 * whether they were allowed to kill my backend.
 *
 * Their observation is the one worth keeping: **a hang and a leak look
 * identical from here and completely different from everyone else's seat.**
 * The hang stopped my harness so I noticed it; the leak stopped nothing of
 * mine, so I did not.
 *
 * Thirty seconds is far longer than any check here takes and far shorter than
 * anyone's patience for a blocked migration. It turns this class of mistake
 * into a self-healing annoyance instead of a stall on shared infrastructure.
 */
const sql = postgres(url, {
  max: 1,
  // Milliseconds — the GUC takes an integer, and postgres.js types it as one.
  connection: { idle_in_transaction_session_timeout: 30_000 },
});
let failures = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`  ok   ${what}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${what}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

/** Labels of a Postgres enum, in declaration order. */
async function enumLabels(typeName: string): Promise<string[]> {
  const rows = await sql<{ label: string }[]>`
    select e.enumlabel as label
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'echo' and t.typname = ${typeName}
     order by e.enumsortorder
  `;
  return rows.map((r) => r.label);
}

try {
  console.log("agent_run_status");
  const statuses = await enumLabels("agent_run_status");
  // Non-empty first: an empty result would otherwise "match" a bug where the
  // type name is wrong, and report success for a check that ran on nothing.
  check("the enum exists in the catalogue", statuses.length > 0, statuses);
  check(
    "TypeScript's AgentRunStatus matches pg_enum exactly",
    JSON.stringify(statuses) === JSON.stringify([...AGENT_RUN_STATUSES]),
    { catalogue: statuses, typescript: [...AGENT_RUN_STATUSES] },
  );

  console.log("call_status");
  const callStatuses = await enumLabels("call_status");
  check("the call status enum exists", callStatuses.length > 0, callStatuses);
  check(
    "core/'s published CALL_STATUSES matches pg_enum exactly",
    JSON.stringify(callStatuses) === JSON.stringify([...CALL_STATUSES]),
    { catalogue: callStatuses, typescript: [...CALL_STATUSES] },
  );

  console.log("part_status");
  const partStatuses = await enumLabels("part_status");
  check("the part status enum exists", partStatuses.length > 0, partStatuses);
  check(
    "core/'s published PART_STATUSES matches pg_enum exactly",
    JSON.stringify(partStatuses) === JSON.stringify([...PART_STATUSES]),
    { catalogue: partStatuses, typescript: [...PART_STATUSES] },
  );

  /**
   * M23's tripwire, planted before the change rather than after it.
   *
   * `member_role` gains `owner` when db/'s package lands. This check is
   * written to be RED on that day: it compares the catalogue to
   * `MEMBER_ROLES`, which deliberately still says `member | admin`. That is
   * the whole design — the api learns about a new role from a failing check
   * naming the drift, not from a support question about a missing dropdown
   * option, and not from the api quietly treating an owner as "not an admin"
   * because its union never heard of them.
   *
   * The same shape that caught `agent_run_status` after the fact. This is the
   * first time we get to plant it before.
   */
  console.log("member_role and user_status (M23 lands here)");
  const roles = await enumLabels("member_role");
  check("the role enum exists", roles.length > 0, roles);
  check(
    "core/'s MEMBER_ROLES matches pg_enum exactly (RED when M23's owner lands)",
    JSON.stringify(roles) === JSON.stringify([...MEMBER_ROLES]),
    { catalogue: roles, typescript: [...MEMBER_ROLES] },
  );
  const userStatuses = await enumLabels("user_status");
  check("the user status enum exists", userStatuses.length > 0, userStatuses);
  check(
    "core/'s USER_STATUSES matches pg_enum exactly",
    JSON.stringify(userStatuses) === JSON.stringify([...USER_STATUSES]),
    { catalogue: userStatuses, typescript: [...USER_STATUSES] },
  );

  console.log("skill.max_tool_calls (db/0025, M4 amendment)");
  const ceiling = await sql<{ column_name: string; is_nullable: string }[]>`
    select column_name, is_nullable
      from information_schema.columns
     where table_schema = 'echo' and table_name = 'skill' and column_name = 'max_tool_calls'
  `;
  check("the column exists", ceiling.length === 1, ceiling);
  // nullable is the contract, not an accident: NULL means inherit the
  // runtime default, and NOT NULL would force every skill to pin a number
  check("it is nullable — NULL means inherit, not unlimited",
    ceiling[0]?.is_nullable === "YES", ceiling[0]?.is_nullable);

  console.log("api_key.allow_assistant (db/0022, M17 amendment)");
  const columns = await sql<{ column_name: string; data_type: string; column_default: string | null }[]>`
    select column_name, data_type, column_default
      from information_schema.columns
     where table_schema = 'echo' and table_name = 'api_key' and column_name = 'allow_assistant'
  `;
  check("the column exists", columns.length === 1, columns);
  check("it defaults to false — a new key cannot spend by accident",
    /false/i.test(columns[0]?.column_default ?? ""), columns[0]?.column_default);

  console.log("resolve_api_key returns the flag, not just the actor");
  // The gateway has no identity at resolution time, so it CANNOT read
  // allow_assistant back from echo.api_key: that table's policies require an
  // active admin, and the read would return zero rows — indistinguishable
  // from a closed key. The flag has to arrive from the resolution itself.
  const resolverColumns = await sql<{ argnames: string[] | null }[]>`
    select p.proargnames as argnames
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.proname = 'resolve_api_key'
  `;
  const names = resolverColumns[0]?.argnames ?? [];
  check("resolve_api_key returns allow_assistant", names.includes("allow_assistant"), names);


  /**
   * Seeded SYSTEM ROWS, not just types (the frontend's suggestion, and they
   * were right that it's the same shape one costume over: a migration
   * declares the row, the database may not have it, and nothing fails —
   * `resolveSkill` just returns undefined and something helpful absorbs it).
   *
   * The check must be read WITH AN IDENTITY, because db/0018 moved
   * `skill_read`'s system clause behind `actor_is_active()`. Reading without
   * one returns empty and looks exactly like a missing seed — which is the
   * mistake I made and reported. So this distinguishes the two explicitly:
   * no identity to look with is a DIFFERENT failure from a missing row, and
   * conflating them is what cost an afternoon.
   */
  console.log("seeded system skills (db/0015)");
  const DEV_MEMBER = process.env.ECHO_DEV_ACTOR ?? "0d000000-0000-4000-8000-000000000002";
  await sql.begin(async (tx) => {
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [DEV_MEMBER]);
    const visible = await tx.unsafe<{ slug: string }[]>(
      `select slug from echo.skill where level = 'system' and enabled and archived_at is null`,
    );
    const actor = await tx.unsafe<{ id: string }[]>(
      `select id from echo.app_user where id = $1`, [DEV_MEMBER],
    );
    if (actor.length === 0) {
      // NOT reported as a missing skill: we cannot see skills at all from
      // here, so we know nothing about them.
      check(
        `the reading identity ${DEV_MEMBER} exists (run db/scripts/seed-dev.mjs, or set ECHO_DEV_ACTOR)`,
        false, "no app_user row — system-skill visibility is unknowable, not absent",
      );
      return;
    }
    const slugs = visible.map((r) => r.slug);
    for (const slug of SYSTEM_SLUGS) {
      check(`system skill "${slug}" is seeded and enabled`, slugs.includes(slug), slugs);
    }
  });
  /**
   * M11: the OWNER of a call can soft-delete it.
   *
   * This is a policy check rather than a shape check, and it is here because
   * it cannot live anywhere else: no unit test can see it (a fake db accepts
   * every update) and the api's own answer actively hides it — an RLS refusal
   * maps to 404, so a delete that the database refuses is indistinguishable,
   * over HTTP, from a call that was never there.
   *
   * It is currently RED, and the failure is the point. Live, as a member who
   * owns the row, in the same transaction:
   *
   *     update … set archived_at = now()  → 1 row
   *     update … set deleted_at  = now()  → 42501
   *
   * with every term of `call_update`'s WITH CHECK true (org_ok, owner_ok) and
   * the same statement succeeding for an admin. The one clause in the whole
   * policy set that names `deleted_at` and separates the two is in `call_read`:
   * `((deleted_at IS NULL) OR echo.actor_is_admin())`. The post-update row is
   * invisible to its own owner, so the write is refused — soft delete works
   * only for admins, which is the opposite of what M11 asks for.
   *
   * db/ owns the fix. This check is the reproduction, and it turns green on
   * its own when the policy changes.
   */
  console.log("M11: an owner may soft-delete their own call (db/0011 policies)");
  await sql.begin(async (tx) => {
    /**
     * Drop to the application role FIRST, and prove we are not above the law.
     *
     * A policy check run as a role that bypasses RLS — a superuser, or the
     * owner of the table — passes unconditionally and proves nothing. It
     * would have reported this very bug as fixed. `set local role` is what
     * the api itself does on every request, so this runs at the same altitude
     * the product does (rule 11).
     */
    await tx.unsafe("set local role echo_app");
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [DEV_MEMBER]);
    const [privilege] = await tx.unsafe<{ bypasses: boolean; owns: boolean }[]>(
      `select r.rolbypassrls as bypasses,
              (select c.relowner = r.oid from pg_class c where c.oid = 'echo.call'::regclass) as owns
         from pg_roles r where r.rolname = current_user`,
    );
    check("the check runs under row-level security, not above it",
      privilege?.bypasses === false && privilege?.owns === false, privilege);

    /**
     * Seed the call this check deletes, rather than finding one (rule 9).
     *
     * It used to grab any live call the member owned — and then I swept the
     * dev project's fixture calls, there were none left, and the check could
     * not run at all. It reported that honestly instead of passing, which is
     * the only reason this is a footnote rather than a second silent hole.
     *
     * Seeding costs nothing here because the whole transaction rolls back, so
     * the check now depends on no ambient data and leaves none behind.
     */
    const [seeded] = await tx.unsafe<{ id: string }[]>(
      `insert into echo.call (org_id, owner_id, title, scope, status, language, started_at)
       select org_id, id, 'schema-contract M11 probe', 'private', 'ready', 'fa', now()
         from echo.app_user where id = $1
       returning id`, [DEV_MEMBER],
    );
    const call = seeded;
    if (!call) {
      // rule 12: not being able to make a call to try this on is a DIFFERENT
      // failure from the try failing, and must not be reported as the latter.
      check("a call could be seeded to run the M11 check against",
        false, "insert produced no row — the M11 check did not run, its result is unknown");
      return;
    }
    try {
      const [deleted] = await tx.unsafe<{ deleted: boolean }[]>(
        `select echo.soft_delete_call($1::uuid) as deleted`, [call.id]);
      check("the owner's own soft delete succeeds", deleted?.deleted === true, deleted);

      // Idempotence is part of the contract, not a nicety: a second click on
      // one delete button must not be an error.
      const [again] = await tx.unsafe<{ deleted: boolean }[]>(
        `select echo.soft_delete_call($1::uuid) as deleted`, [call.id]);
      check("deleting an already-deleted call answers false, not an error",
        again?.deleted === false, again);

      /**
       * The other direction, which Backend 3 asked for and which I would not
       * have thought to check before it bit: restore used to match zero rows
       * and raise NOTHING — no error at any layer, indistinguishable from a
       * call that never existed. It is now a refusal a caller can see.
       *
       * A non-admin restoring is REFUSED (Q2: deletion feels like deletion,
       * only an admin restores). So the assertion is that it raises — this
       * check goes red if that ruling is ever quietly reversed in the schema
       * without anyone amending Q2.
       */
      let refused = false;
      try {
        await tx.unsafe(`select echo.restore_call($1::uuid)`, [call.id]);
      } catch (error) {
        refused = (error as { code?: string }).code === "42501";
      }
      check("a non-admin restoring is refused OUT LOUD, not silently ignored",
        refused, { note: "Q2 — only an admin restores; silence here was the old bug" });
    } catch (error) {
      const pg = error as { code?: string; routine?: string };
      check("the owner's soft delete is not refused", false, { code: pg.code, routine: pg.routine });
    }
    // Never keep it: this runs against the dev database, and a contract check
    // that deletes a real call would be a worse bug than the one it reports.
    throw new Error("__rollback__");
  }).catch((error: unknown) => {
    if ((error as Error)?.message !== "__rollback__") throw error;
  });
  /**
   * The audit feed actually runs (M25).
   *
   * It unions three tables and names about twenty columns across them. Not
   * one unit test can tell you whether those columns exist: a fake returns
   * rows for any string, so the entire query could reference
   * `admin_action.actor` and every test would still pass. Only Postgres can
   * say, and only when asked.
   *
   * Run through the REPO rather than a copy of its SQL, or this becomes a
   * test that the harness agrees with itself — the closed loop that let a
   * frontend render four call statuses that never existed.
   */
  console.log("the audit feed runs against the real schema (M25)");
  // Admin, because the feed is admin-gated and `admin_action_read` requires
  // it — reading as the member would return an empty list and "parses" would
  // be true for a query that never touched two of the three tables.
  const DEV_ADMIN = process.env.ECHO_DEV_ADMIN ?? "0d000000-0000-4000-8000-000000000001";
  const DEV_ORG = process.env.ECHO_DEV_ORG ?? "0d000000-0000-4000-8000-00000000000d";
  const auditDb = createDb({
    app: sql as unknown as SqlClient,
    agent: sql as unknown as SqlClient,
  });
  try {
    const page = await createAuditRepo(auditDb).list(
      { userId: DEV_ADMIN, orgId: DEV_ORG, role: "admin", isActive: true },
      { limit: 5 },
    );
    const entries = page.entries;
    check("the three-table union parses and executes", Array.isArray(entries), entries.length);
    // Printed, not asserted. "Parses and executes" is the durable claim; a
    // row COUNT depends on ambient data and would make this check fail on a
    // freshly seeded database where nothing has happened yet. But a silent
    // zero and a healthy feed should not look identical to whoever runs this.
    console.log(`       (${entries.length} entr${entries.length === 1 ? "y" : "ies"} read back)`);
    // Content columns are not merely unselected — they must be ABSENT from
    // what comes back, whatever the query said.
    const leaked = entries.filter((e) =>
      "request" in e.detail || "steps" in e.detail || "prompt" in e.detail);
    check("no entry carries prompt or tool-trace content", leaked.length === 0, leaked.length);

    /**
     * The keyset boundary, exercised against real rows rather than reasoned
     * about — page one of one, then page two from its cursor, and assert the
     * two pages share nothing. A dropped-or-repeated row at the boundary is
     * the bug FE3 found, and it is invisible in a single page.
     */
    if (page.next_cursor) {
      const second = await createAuditRepo(auditDb).list(
        { userId: DEV_ADMIN, orgId: DEV_ORG, role: "admin", isActive: true },
        { limit: 5, cursor: page.next_cursor },
      );
      const firstKeys = new Set(entries.map((e) => `${e.source}:${e.id}`));
      const overlap = second.entries.filter((e) => firstKeys.has(`${e.source}:${e.id}`));
      check("page two repeats nothing from page one", overlap.length === 0, overlap.length);
    }
  } catch (error) {
    const pg = error as { code?: string; message?: string };
    // 42703 = undefined_column: exactly the drift this check exists for.
    check("the three-table union parses and executes", false,
      { code: pg.code, hint: pg.code === "42703" ? "a column was renamed or dropped" : undefined });
  }

  /**
   * The org read runs (M25). Same reasoning as the audit feed one line up:
   * `ORG_COLUMNS` names six columns and no unit test can tell you whether
   * they exist, because a fake answers to any string.
   */
  console.log("the org profile reads against the real schema (M25)");
  try {
    const record = await createOrgRepo(auditDb).get(
      { userId: DEV_ADMIN, orgId: DEV_ORG, role: "admin", isActive: true },
    );
    check("every column in ORG_COLUMNS exists and reads back",
      typeof record.name === "string" && Array.isArray(record.allowed_models), {
        // The org's NAME is org-identifying but not secret to its own admin;
        // still, only the shape is asserted — this output is read aloud in
        // cross-session messages and does not need the customer's name in it.
        has_name: record.name.length > 0, status: record.status, locale: record.locale,
      });
  } catch (error) {
    const pg = error as { code?: string };
    check("every column in ORG_COLUMNS exists and reads back", false,
      { code: pg.code, hint: pg.code === "42703" ? "a column was renamed or dropped" : undefined });
  }

  /**
   * The call parts read runs (M25). Ten columns, none of them checkable by a
   * fake — and `byte_size` is a bigint, so this also confirms the conversion
   * that keeps it a number on the wire rather than postgres.js's string.
   */
  console.log("call parts read against the real schema (M25)");
  await sql.begin(async (tx) => {
    await tx.unsafe("set local role echo_app");
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [DEV_MEMBER]);
    const [call] = await tx.unsafe<{ id: string }[]>(
      `insert into echo.call (org_id, owner_id, title, scope, status, language, started_at)
       select org_id, id, 'schema-contract parts probe', 'private', 'ready', 'fa', now()
         from echo.app_user where id = $1
       returning id`, [DEV_MEMBER],
    );
    if (!call) {
      check("a call could be seeded to read parts from", false, "insert produced no row");
      return;
    }
    await tx.unsafe(
      `insert into echo.call_part (call_id, org_id, idx, offset_ms, duration_ms, status, has_word_timestamps)
       select $1, org_id, 0, 0, 9000, 'diarized', false from echo.call where id = $1`,
      [call.id],
    );
    try {
      const rows = await tx.unsafe<Record<string, unknown>[]>(
        `select id, idx, offset_ms, duration_ms, status, has_word_timestamps,
                missing, failure_reason, audio_format, byte_size
           from echo.call_part where call_id = $1 order by idx`, [call.id],
      );
      check("every column in PART_COLUMNS exists and reads back", rows.length === 1, rows.length);
    } catch (error) {
      const pg = error as { code?: string };
      check("every column in PART_COLUMNS exists and reads back", false,
        { code: pg.code, hint: pg.code === "42703" ? "a column was renamed or dropped" : undefined });
    }
    throw new Error("__rollback__");   // seeded rows never survive the check
  }).catch((error: unknown) => {
    if ((error as Error)?.message !== "__rollback__") throw error;
  });

  /**
   * M24 round 1's tripwire: adopt the new member columns the day they land.
   *
   * `username` and `display_name_en` are coming in a db/ migration. The
   * steward gated the api work on it, which is right — and a gate nobody is
   * watching is just a thing that gets forgotten. So this asserts the
   * IMPLICATION rather than the presence: if the catalogue has the column,
   * `MEMBER_COLUMNS` must select it. While the migration is pending both
   * sides are absent and this passes honestly; the morning it lands, this is
   * the check that says so.
   *
   * Deliberately not a list of columns the api must have — that would fail on
   * every unrelated column db/ ever adds, and a check that cries wolf gets
   * muted, which is worse than not having it.
   */
  /**
   * The members query runs (M24). It casts to two enums, escapes a LIKE
   * pattern, and orders by a mapped key — none of which a fake can check,
   * and all of which fail at parse time if a cast or column name is wrong.
   */
  console.log("the members search/filter/sort runs against the real schema (M24)");
  try {
    const repo = createMembersRepo(auditDb);
    const admin = { userId: DEV_ADMIN, orgId: DEV_ORG, role: "admin" as const, isActive: true };
    // Every sort key, because each produces a different ORDER BY and only one
    // of them is exercised by a default call.
    for (const sort of ["default", "name", "created", "last_seen", "status"]) {
      await repo.list(admin, { sort, search: "a%_", status: "active", role: "admin" });
    }
    check("every sort key and filter combination parses and executes", true);

    // The stat tiles hit a table that landed today; `make_interval(days => …)`
    // and the status filters are both parse-time failures if wrong.
    const stats = await repo.stats(admin, { windowDays: 30 });
    check("the stat tiles read counts and movement",
      typeof stats.counts.total === "number" && typeof stats.trend.activated === "number",
      stats.counts);
    // Not an assertion about the VALUE — an empty log is the honest state
    // today. The point is that null survives to the wire as null.
    console.log(`       (history_since: ${stats.trend.history_since ?? "null — nothing recorded yet"})`);
  } catch (error) {
    const pg = error as { code?: string; message?: string };
    check("every sort key and filter combination parses and executes", false,
      { code: pg.code, hint: pg.code === "42703" ? "a column was renamed" : pg.code === "42P18" ? "a cast is missing" : undefined });
  }

  /**
   * The truncation stamp, whatever B3 ends up calling it.
   *
   * The steward ruled `COALESCE(stored, derived)`: a marker on
   * `agent_message` stamped at the moment its `agent_run` dies, because a
   * derived flag cannot outlive its source and "the record's honesty must not
   * have an expiry date". I do not know the column's NAME yet, so a
   * name-specific tripwire (the M24 pattern) cannot be written.
   *
   * So this watches the whole table instead: every column on `agent_message`
   * must be one this api reads. That is only tolerable because the table is
   * small, stable, and entirely mine to consume — the same check across a
   * table db/ evolves freely would cry wolf, and a checker that cries wolf
   * gets muted.
   *
   * `org_id` and `session_id` are scoping columns the reader never needs:
   * the session is the parameter and the org is RLS's business.
   */
  /**
   * Invitations and tombstone execute (M24/D25).
   *
   * The last surface built without a live check. Its statements are dense
   * with parse-time failures no fake can see — a `citext` cast, an
   * `echo.member_role` cast, `make_interval(days => …)`, and two function
   * signatures I read from the catalogue and could still have transcribed
   * wrong. The routes cannot be exercised end to end because minting a token
   * this instance accepts is no longer possible (the real JWT secret is in
   * place, by design), so the repo layer is where the proof has to happen.
   */
  console.log("invitations and tombstone execute against the real schema (M24)");
  await sql.begin(async (tx) => {
    await tx.unsafe("set local role echo_app");
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [DEV_ADMIN]);
    try {
      const [invite] = await tx.unsafe<{ id: string; token_prefix: string }[]>(
        `insert into echo.invitation
           (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
         select org_id, $2::citext, $3::echo.member_role, id, $4, $5,
                now() + make_interval(days => $6)
           from echo.app_user where id = $1
         returning id, token_prefix`,
        [DEV_ADMIN, "probe@example.com", "member", "0".repeat(64), "echo_inv_probe", 14],
      );
      check("an invitation can be issued", invite !== undefined);

      const listed = await tx.unsafe<Record<string, unknown>[]>(
        `select id, email, role, token_prefix, expires_at, redeemed_at, revoked_at, created_at
           from echo.invitation
          order by (redeemed_at is null and revoked_at is null) desc, created_at desc`,
      );
      check("every column the list selects exists", listed.length > 0, listed.length);
    } catch (error) {
      const pg = error as { code?: string };
      check("an invitation can be issued", false,
        { code: pg.code, hint: pg.code === "42883" ? "a cast or function signature is wrong" : undefined });
    }

    // Both named operations, called with values that CANNOT match anything —
    // so this proves the signatures and the refusal shape without touching a
    // real person or a real invite.
    for (const [what, statement, params] of [
      ["redeem_invitation", `select * from echo.redeem_invitation($1::text, $2::uuid, $3::citext)`,
        ["f".repeat(64), DEV_ADMIN, "nobody@example.invalid"]],
      ["tombstone_user", `select echo.tombstone_user($1::uuid)`,
        ["00000000-0000-4000-8000-000000000000"]],
    ] as const) {
      try {
        await tx.unsafe(statement, [...params]);
        check(`${what} accepts its arguments`, true);
      } catch (error) {
        const pg = error as { code?: string };
        // A REFUSAL proves the signature just as well as a success: what must
        // not happen is 42883 (no such function / wrong argument types).
        check(`${what} accepts its arguments`, pg.code !== "42883", { code: pg.code });
      }
    }
    throw new Error("__rollback__");
  }).catch((error: unknown) => {
    if ((error as Error)?.message !== "__rollback__") throw error;
  });

  console.log("agent_message columns are all consumed (the truncation stamp will land here)");
  const messageColumns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'echo' and table_name = 'agent_message'`;
  const readByApi = readFileSync(new URL("../../src/api/sessions.ts", import.meta.url), "utf8");
  const SCOPING_ONLY = ["org_id", "session_id"];
  const unconsumed = messageColumns
    .map((c) => c.column_name)
    /**
     * `m.<column>` — the QUALIFIED reference the SELECT must contain.
     *
     * The first version asked whether the name appeared anywhere in the file.
     * `truncated` landed in db/0046 and this check stayed GREEN, because the
     * file already held the word as a derived alias (`as truncated`) and a
     * wire field: **the name matched itself.** It reported "all consumed"
     * about a column nothing read — the exact vacuous pass this file exists
     * to prevent, in the instrument I wrote that morning to prevent it.
     *
     * I caught it only because I already knew the column had landed. Without
     * that I would have believed a green check, which is the whole failure
     * mode: an instrument that cannot fail is worse than none, because it is
     * trusted.
     */
    .filter((name) => !SCOPING_ONLY.includes(name) && !readByApi.includes(`m.${name}`));
  check(
    "every agent_message column is read by sessions.ts (RED when the stamp lands)",
    unconsumed.length === 0,
    unconsumed,
  );

  /**
   * The profile write runs, including the two columns db/0054 just added.
   *
   * A fake accepts any column name, so only this can say whether `calendar`
   * and `timezone` are really writable through `PATCH /v1/me` — and whether
   * the CHECK constraints agree with what my edge validation lets through.
   * Rolled back.
   */
  console.log("the profile update writes the new preference columns (M24/0054)");
  await sql.begin(async (tx) => {
    await tx.unsafe("set local role echo_app");
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [DEV_MEMBER]);
    for (const [what, calendar, timezone] of [
      ["a real zone", "jalali", "Pacific/Kiritimati"],
      ["the auto sentinels", "auto", "auto"],
    ] as const) {
      try {
        const rows = await tx.unsafe<{ calendar: string; timezone: string }[]>(
          `update echo.app_user set calendar = $2, timezone = $3
            where id = $1 returning calendar, timezone`,
          [DEV_MEMBER, calendar, timezone],
        );
        check(`${what} write and read back`,
          rows[0]?.calendar === calendar && rows[0]?.timezone === timezone, rows[0]);
      } catch (error) {
        check(`${what} write and read back`, false, { code: (error as { code?: string }).code });
      }
    }
    // And the constraint refuses what my edge refuses — two walls, one answer.
    try {
      await tx.unsafe(`update echo.app_user set calendar = 'hijri' where id = $1`, [DEV_MEMBER]);
      check("the database also refuses an unknown calendar", false, "it was accepted");
    } catch (error) {
      check("the database also refuses an unknown calendar",
        (error as { code?: string }).code === "23514", (error as { code?: string }).code);
    }
    throw new Error("__rollback__");
  }).catch((error: unknown) => {
    if ((error as Error)?.message !== "__rollback__") throw error;
  });

  console.log("M24: member columns are adopted as they land");
  const memberColumns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'echo' and table_name = 'app_user'`;
  const present = new Set(memberColumns.map((c) => c.column_name));
  const pending = ["username", "display_name_en"];
  const landedButUnexposed = pending.filter(
    (column) => present.has(column) && !MEMBER_COLUMNS.includes(column),
  );
  check(
    "no member column exists in the database while unexposed by the api",
    landedButUnexposed.length === 0,
    { landed_but_unexposed: landedButUnexposed, still_pending: pending.filter((c) => !present.has(c)) },
  );

  /**
   * THE INSTRUMENT, at table granularity: every table in `echo` is either
   * used by `core/src` or listed below with a reason.
   *
   * The function-level version caught `register_account` — granted,
   * documented, and called by nobody. Tables have the same failure mode and a
   * worse blast radius: a table nothing reads is either a feature that was
   * schema'd and never built, or a migration that landed while the consumer
   * was looking elsewhere. Both are invisible from inside either package.
   *
   * It earned itself on its first run, before it was even permanent:
   * `user_status_history` (M24's trends source, which I had been told was
   * pending) had already landed, and `agent_session` / `agent_message` turned
   * out to be a whole persisted-conversation schema with no api surface at
   * all.
   */
  /**
   * Conversations round-trip (M4, db/0018).
   *
   * This schema had never had a row written to it by anything — designed,
   * policied, and never exercised. So "does it work" is genuinely unknown
   * rather than merely untested, and only a real insert can say: the enum
   * cast on `role`, the `(session_id, seq)` uniqueness, and the jsonb
   * double-encoding trap are all runtime facts.
   *
   * Rolled back, so it depends on no ambient data and leaves none.
   */
  console.log("assistant conversations round-trip (M4, db/0018)");
  await sql.begin(async (tx) => {
    await tx.unsafe("set local role echo_app");
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [DEV_MEMBER]);
    try {
      const [session] = await tx.unsafe<{ id: string }[]>(
        `insert into echo.agent_session (org_id, actor_id, title, context)
         select org_id, id, 'schema-contract probe', '{}'::jsonb
           from echo.app_user where id = $1
         returning id`, [DEV_MEMBER],
      );
      check("a conversation can be opened", session !== undefined);
      if (!session) return;

      for (const [role, content] of [["user", "سلام"], ["assistant", "درود"]] as const) {
        await tx.unsafe(
          `insert into echo.agent_message (session_id, org_id, seq, role, content, tool_calls)
           select $1, org_id,
                  coalesce((select max(seq) + 1 from echo.agent_message where session_id = $1), 0),
                  $2::echo.agent_message_role, $3, $4::text::jsonb
             from echo.agent_session where id = $1`,
          [session.id, role, content, JSON.stringify([{ id: "t1", name: "search_calls" }])],
        );
      }
      const thread = await tx.unsafe<{ seq: number; role: string; tool_calls: unknown }[]>(
        `select seq, role, tool_calls from echo.agent_message
          where session_id = $1 order by seq`, [session.id],
      );
      check("both turns land, in order, with distinct seq",
        thread.length === 2 && thread[0]?.seq === 0 && thread[1]?.seq === 1,
        thread.map((t) => `${t.seq}:${t.role}`));
      // The double-encoding trap that cost a day on agent_run.steps: a jsonb
      // column fed a JSON *string* becomes an array of characters.
      check("tool_calls survives as an ARRAY, not a string",
        Array.isArray(thread[0]?.tool_calls), typeof thread[0]?.tool_calls);

      /**
       * The REPO's own read, not a hand-written copy of it.
       *
       * Added after adopting `echo.run_is_truncated`: B3 described a
       * two-argument signature, the catalogue had one, and the two-arg call
       * would have 42883'd every thread read in production while every unit
       * test stayed green — a fake answers any SQL. Nothing in this harness
       * caught it either, because the checks above write rows directly and
       * never execute `messages()`.
       *
       * So this runs the actual repo against the actual schema. It is the
       * only thing here that would notice the day that function's signature
       * changes underneath the call.
       */
      try {
        const live = await tx.unsafe<Record<string, unknown>[]>(THREAD_QUERY, [session.id]);
        check("the repo's thread query executes against the real schema", live.length === 2, live.length);
      } catch (error) {
        const pg = error as { code?: string };
        check("the repo's thread query executes against the real schema", false, {
          code: pg.code,
          hint: pg.code === "42883" ? "echo.run_is_truncated's signature changed" : undefined,
        });
      }
    } catch (error) {
      const pg = error as { code?: string; message?: string };
      check("a conversation can be opened", false, { code: pg.code });
    }
    throw new Error("__rollback__");
  }).catch((error: unknown) => {
    if ((error as Error)?.message !== "__rollback__") throw error;
  });

  /**
   * Server health reads (M25). Worth a live check more than most: it reads
   * `pgmq` — a schema outside `echo` entirely, with its own grants — and the
   * dispatch's claim that these reads were "already permitted" turned out to
   * be half true. `pgmq.metrics()` and the whole `storage` schema are 42501
   * for this role, which is only discoverable by asking.
   */
  console.log("server health reads execute (M25)");
  try {
    const health = await createHealthRepo(auditDb).read(
      { userId: DEV_ADMIN, orgId: DEV_ORG, role: "admin", isActive: true },
    );
    check("queue depths are readable", health.queues.measured_at !== null, health.queues.unavailable);
    check("key counts are readable", health.keys.measured_at !== null, health.keys.unavailable);
    // Storage is EXPECTED unavailable today. Asserted so the day a grant
    // appears, this goes red and the `unavailable` note stops being true.
    check("storage is honestly reported as unmeasured, not zero",
      health.storage.bytes === null && health.storage.measured_at === null,
      health.storage);
    console.log(`       (${health.queues.items.map((q) => `${q.name}: ${q.depth} queued, ${q.retrying} retrying, ${q.archived} archived`).join("; ")})`);
  } catch (error) {
    check("server health reads execute", false, { code: (error as { code?: string }).code });
  }

  /**
   * The audit feed's missing third, end to end (M25).
   *
   * `admin_action` had a table, policies and a reader, and no writer — so the
   * Audit Logs screen showed "no events match" for a third of itself while
   * looking complete. This runs a real admin mutation through the repo and
   * asserts the row comes back out of the FEED, because "the insert works" and
   * "it appears where a reader looks" are different claims.
   *
   * Rolled back, so it proves the path without leaving an audit row asserting
   * an org change that did not survive.
   */
  console.log("an admin action reaches the audit feed (M25 writer)");
  await sql.begin(async (tx) => {
    await tx.unsafe("set local role echo_app");
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [DEV_ADMIN]);
    const before = await tx.unsafe<{ n: number }[]>(
      `select count(*)::int as n from echo.admin_action`);
    await tx.unsafe(
      `update echo.org set name = name where id = echo.actor_org_id()`);
    await tx.unsafe(
      `insert into echo.admin_action (org_id, actor_id, action, target_type, target_id, detail)
       values (echo.actor_org_id(), $1, 'org_updated', 'org', echo.actor_org_id(), $2::text::jsonb)`,
      [DEV_ADMIN, JSON.stringify({ fields: ["name"] })]);

    const after = await tx.unsafe<{ n: number }[]>(
      `select count(*)::int as n from echo.admin_action`);
    check("an admin_action row can be written",
      (after[0]?.n ?? 0) === (before[0]?.n ?? 0) + 1, { before: before[0]?.n, after: after[0]?.n });

    // The part that matters: does it come back out of the FEED the screen
    // reads, with the shape the wire promises?
    const [seen] = await tx.unsafe<Record<string, unknown>[]>(
      `select feed.* from (${AUDIT_FEED_SQL}) feed
        where feed.source = 'admin_action' order by feed.at desc limit 1`);
    check("and it appears in the audit feed with codes, not values",
      seen?.action === "org_updated"
        && JSON.stringify(seen?.detail) === JSON.stringify({ fields: ["name"] }),
      seen ? { action: seen.action, detail: seen.detail } : "no row in feed");
    throw new Error("__rollback__");
  }).catch((error: unknown) => {
    if ((error as Error)?.message !== "__rollback__") throw error;
  });

  console.log("every table in echo is used by core/, or listed as deliberately not");
  /**
   * Everything under `core/src` as one string — the TypeScript-side consumer
   * evidence for BOTH instruments (tables here, granted functions below).
   * Declared once, above the first user: it was originally inside the
   * function check, and referencing it from up here would have been a
   * temporal-dead-zone crash rather than a failing check.
   */
  const coreText = (function read(dir: URL): string {
    let text = "";
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      text += entry.isDirectory() ? read(child) : readFileSync(child, "utf8");
    }
    return text;
  })(new URL("../../src/", import.meta.url));

  // Emptied when the steward scheduled the build the instrument surfaced:
  // `agent_session` and `agent_message` now have an api (src/api/sessions.ts),
  // so nothing here is deliberately unread. An entry returning to this map
  // should always come with a ruling, not a shrug.
  const KNOWN_UNREAD: Record<string, string> = {};
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
     where table_schema = 'echo' and table_type = 'BASE TABLE'`;
  const unread = tables
    .map((t) => t.table_name)
    .filter((name) => !coreText.includes(name) && !(name in KNOWN_UNREAD));
  check(
    "no table exists in the schema with nothing in core/ using it",
    unread.length === 0,
    unread,
  );
  for (const [table, why] of Object.entries(KNOWN_UNREAD)) {
    // A reason that is not a reason is how a finding becomes a shrug.
    check(`${table} is unread for a recorded reason`, why.length > 40);
  }

  /**
   * THE INSTRUMENT: every function granted to `echo_app` has a caller.
   *
   * `echo.register_account()` existed for weeks — SECURITY DEFINER, granted,
   * documented as "the only way an app_user row is created" — and nothing
   * called it. A person who signed up got a valid token, 401'd forever, and
   * never reached the admin's pending queue. Every layer was correct; the
   * chain had no link.
   *
   * No test could have caught it from inside one package, which is the whole
   * point: db/ could see the function was granted, core/ could see its own
   * routes pass, and neither could see the gap BETWEEN them. This check spans
   * the two — pg catalogue on one side, `core/src` text on the other — and it
   * is the cheapest possible instrument for it. Grep, not cleverness.
   *
   * "Caller" deliberately includes SQL-side consumers: a function used by a
   * policy, another function, or a trigger is consumed even though `core/`
   * never names it. Counting only TypeScript would flag every helper in
   * db/0003 and the noise would kill the check inside a week.
   */
  console.log("every function granted to echo_app has a consumer");
  const granted = await sql<{ proname: string; prosrc: string }[]>`
    select p.proname, p.prosrc
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'echo'
       and t.typname <> 'trigger'
       and has_function_privilege('echo_app', p.oid, 'execute')
     order by p.proname`;

  /**
   * SQL-side consumers: policy expressions, and the bodies of EVERY function
   * in the schema — not just the granted ones.
   *
   * My first version searched only the granted non-trigger bodies and duly
   * reported `purge_window` as having no caller. It is called by
   * `tg_call_guard`, a trigger function I had excluded from the very list I
   * was searching. A checker that manufactures its own false positives gets
   * muted within a week, and then it is worse than absent — so this is the
   * same vacuous-instrument trap the rolbypassrls guard above exists for,
   * pointed the other way: not "passes when it shouldn't" but "fails when it
   * shouldn't".
   */
  const policySources = await sql<{ src: string }[]>`
    select coalesce(qual, '') || ' ' || coalesce(with_check, '') as src
      from pg_policies where schemaname = 'echo'`;
  const allBodies = await sql<{ proname: string; prosrc: string }[]>`
    select p.proname, p.prosrc from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo'`;
  const sqlText = [
    ...policySources.map((p) => p.src),
    ...allBodies.map((f) => f.prosrc),
  ].join("\n");

  // TypeScript-side consumers: `coreText`, read once above the table check.
  const orphans = granted.filter((fn) => {
    if (coreText.includes(fn.proname)) return false;
    // Its own body always mentions its name in the CREATE text? No — prosrc
    // is the BODY only, so a self-match here would be a genuine recursive
    // call. Count every other function's body, and its own.
    const others = sqlText.split(fn.proname).length - 1;
    const self = fn.prosrc.split(fn.proname).length - 1;
    return others - self <= 0;
  });
  check(
    "no function is granted to echo_app with nothing calling it",
    orphans.length === 0,
    orphans.map((o) => o.proname),
  );
  console.log(`       (${granted.length} granted functions checked)`);
} finally {
  await sql.end();
}

console.log(failures === 0 ? "\nschema contract: OK" : `\nschema contract: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
