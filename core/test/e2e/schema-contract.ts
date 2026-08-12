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
} finally {
  await sql.end();
}

console.log(failures === 0 ? "\nschema contract: OK" : `\nschema contract: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
