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
import {
  AGENT_RUN_STATUSES, CALL_STATUSES, PART_STATUSES, WEBHOOK_EVENTS,
} from "../../src/api/vocabulary.ts";

const url = process.env.ECHO_APP_DB_URL;
if (!url) {
  console.error("ECHO_APP_DB_URL is required (read it from the secret store, never a literal)");
  process.exit(2);
}

const sql = postgres(url, { max: 1 });
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

  console.log("webhook events are identifiers the schema will accept");
  check("core/ publishes a non-empty closed event set", WEBHOOK_EVENTS.length > 0, [...WEBHOOK_EVENTS]);

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

  // TypeScript-side consumers: everything under core/src.
  const coreText = (function read(dir: URL): string {
    let text = "";
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      text += entry.isDirectory() ? read(child) : readFileSync(child, "utf8");
    }
    return text;
  })(new URL("../../src/", import.meta.url));

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
