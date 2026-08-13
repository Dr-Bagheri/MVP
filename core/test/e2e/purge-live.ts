/**
 * PURGE ACCEPTANCE — the one operation with no undo, run for real.
 *
 * The purge job is the only process holding DELETE, and its correctness is not
 * "did it delete something" but "did it delete EXACTLY what had expired". A
 * unit test cannot answer that: the filter is not in the code at all. The
 * query is `select id from echo.call order by purge_after` with NO where
 * clause — the expiry rule lives entirely in `echo_purge`'s RLS policy
 * (db/0013), so a fake connection with a fake policy proves nothing about the
 * only thing worth proving. This runs against the real database as the real
 * role, and the fixture is three calls that must be treated three ways.
 *
 * The bar it has to clear, in order of how badly each one hurts:
 *
 *   1. A live call is not touched.            (deleting present data)
 *   2. A deleted call inside its window is not touched.  (deleting early)
 *   3. An expired call is deleted, ROWS AND OBJECT.      (the promise)
 *   4. An object whose row is gone is impossible — objects go first.
 *   5. Running twice is the same as running once.
 *
 * Not a vitest file: it deletes rows from a shared database and needs the
 * storage key. Never in CI.
 *
 *   DATABASE_URL_PURGE=… ECHO_PLATFORM_DB_URL=… SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
 *   node --experimental-strip-types test/e2e/purge-live.ts
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { normalizeDbUrl } from "../../src/worker/main.ts";

const checks: [string, boolean, string | undefined][] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push([name, ok, detail]);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return value;
}

const BUCKET = process.env.ECHO_E2E_BUCKET ?? "call-audio";
const SUPABASE_URL = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
const SUPABASE_KEY = requireEnv("SUPABASE_SERVICE_KEY");

async function putObject(storagePath: string): Promise<void> {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${storagePath}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]), // a few bytes, not audio
    },
  );
  if (!response.ok) throw new Error(`upload failed (${response.status})`);
}

/** Status only, never the body: a storage path is the customer's business. */
async function objectExists(storagePath: string): Promise<boolean> {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${storagePath}`,
    { method: "GET", headers: { authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
  );
  return response.ok;
}

async function removeObject(storagePath: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${storagePath}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
  }).catch(() => undefined);
}

/**
 * Run the purge as a REAL PROCESS under the production runtime, and read its
 * exit code. Calling `runPurge()` in-process would skip main.ts entirely —
 * which is where a startup refusal, an entrypoint guard and the exit code all
 * live, and every one of those has been wrong at least once in this codebase.
 */
function runPurgeProcess(env: Record<string, string>): Promise<{ code: number; out: string }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const entry = path.resolve(here, "../../src/purge/main.ts");
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", entry],
      { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("exit", (code) => resolve({ code: code ?? -1, out }));
  });
}

async function main(): Promise<void> {
  const ownerSql = postgres(normalizeDbUrl(requireEnv("ECHO_PLATFORM_DB_URL")), {
    max: 2,
    ssl: { rejectUnauthorized: false },
  });
  const purgeSql = postgres(normalizeDbUrl(requireEnv("DATABASE_URL_PURGE")), {
    max: 1,
    ssl: { rejectUnauthorized: false },
  });

  const tag = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const ownerId = randomUUID();
  const expiredPath = `e2e-purge/${tag}/expired.bin`;
  const keptPath = `e2e-purge/${tag}/kept.bin`;
  const created: string[] = [];

  /** Age a soft-deleted call past its purge window, guard temporarily aside. */
  const backdate = (callId: string, deletedAgo: string, expiredAgo: string) =>
    ownerSql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx.unsafe(
        `update echo.call
            set deleted_at = now() - interval '${deletedAgo}',
                purge_after = now() - interval '${expiredAgo}'
          where id = $1`,
        [callId],
      );
    });

  try {
    console.log(`\n[1] fixture  (tag ${tag})`);
    await ownerSql`insert into echo.org (id, name, status) values (${orgId}, ${`purge acceptance ${tag}`}, 'active')`;
    const email = `purge-${ownerId}@example.invalid`;
    await ownerSql`insert into auth.users (id, email) values (${ownerId}, ${email})`;
    await ownerSql`
      insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at)
      values (${ownerId}, ${orgId}, ${email}, 'purge owner', 'member', 'active', now())`;

    // Three calls, one per behaviour the purge must distinguish.
    const mk = async (title: string): Promise<string> => {
      const rows = await ownerSql<{ id: string }[]>`
        insert into echo.call (org_id, owner_id, title, status, source)
        values (${orgId}, ${ownerId}, ${title}, 'ready', 'upload') returning id`;
      const id = rows[0]!.id;
      created.push(id);
      return id;
    };
    const expiredCall = await mk(`purge ${tag} EXPIRED`);
    const windowCall = await mk(`purge ${tag} INSIDE-WINDOW`);
    const liveCall = await mk(`purge ${tag} LIVE`);

    await putObject(expiredPath);
    await putObject(keptPath);
    await ownerSql`
      insert into echo.call_part (call_id, org_id, idx, offset_ms, duration_ms, storage_bucket, storage_path, status)
      values (${expiredCall}, ${orgId}, 0, 0, 60000, ${BUCKET}, ${expiredPath}, 'diarized')`;
    await ownerSql`
      insert into echo.call_part (call_id, org_id, idx, offset_ms, duration_ms, storage_bucket, storage_path, status)
      values (${liveCall}, ${orgId}, 0, 0, 60000, ${BUCKET}, ${keptPath}, 'diarized')`;

    // Real child rows on the expired call: the delete order is the thing under
    // test, and a call with no children exercises none of it.
    await ownerSql`
      insert into echo.transcript_segment (call_id, org_id, seq, start_ms, end_ms, text, words)
      values (${expiredCall}, ${orgId}, 0, 0, 5000, ${"سلام"}, ${ownerSql.json([{ w: "سلام", s: 0, e: 400 }])})`;
    const summaryRows = await ownerSql<{ id: string }[]>`
      insert into echo.summary (call_id, org_id, version, body, model, created_by)
      values (${expiredCall}, ${orgId}, 1, ${"خلاصه"}, 'test/model', ${ownerId}) returning id`;
    await ownerSql`update echo.call set current_summary_id = ${summaryRows[0]!.id} where id = ${expiredCall}`;

    // Soft-delete two of them.
    //
    // `deleted_by` is stamped by tg_call_guard from `echo.actor_id()`, and the
    // owner connection has no actor — without one the row lands with
    // deleted_at and purge_after set and deleted_by null, which is exactly the
    // 1-or-2-of-3 state `call_delete_consistent` exists to forbid. The
    // constraint is doing its job; the fixture has to bring an actor.
    await ownerSql.begin(async (tx) => {
      await tx`select set_config('echo.actor_id', ${ownerId}, true)`;
      await tx`update echo.call set deleted_at = now() where id in (${expiredCall}, ${windowCall})`;
    });
    // Then age the expired one past its window. The guard preserves
    // purge_after on every later UPDATE, so this needs the trigger out of the
    // way — inside ONE transaction, with SET LOCAL. A bare `SET` on a pooled
    // client can execute on a different connection than the UPDATE that
    // follows it, which fails in the direction that looks like success: the
    // guard silently still on, the row silently not aged.
    await backdate(expiredCall, "40 days", "10 days");

    const stamped = await ownerSql<{ id: string; deleted_at: Date | null; purge_after: Date | null }[]>`
      select id, deleted_at, purge_after from echo.call where id in (${expiredCall}, ${windowCall}, ${liveCall})`;
    const byId = new Map(stamped.map((r) => [r.id, r]));
    check(
      "fixture is the three cases it claims to be",
      byId.get(expiredCall)!.purge_after! < new Date() &&
        byId.get(windowCall)!.purge_after! > new Date() &&
        byId.get(liveCall)!.deleted_at === null,
      "expired / inside-window / live",
    );

    // ------------------------------------------------------------------
    // [2] What the role can SEE. This is the whole filter, so it is asserted
    // on its own before anything is deleted — a purge that deletes the right
    // rows because it was pointed at them proves nothing about the policy
    // that is supposed to be pointing it.
    // ------------------------------------------------------------------
    console.log("[2] what echo_purge can see");
    const visible = await purgeSql<{ id: string }[]>`select id from echo.call`;
    const visibleIds = new Set(visible.map((r) => r.id));
    check(
      "echo_purge sees the expired call",
      visibleIds.has(expiredCall),
      `${visible.length} row(s) visible in total`,
    );
    check("echo_purge CANNOT see a call still inside its window", !visibleIds.has(windowCall));
    check("echo_purge CANNOT see a live call", !visibleIds.has(liveCall));

    // ------------------------------------------------------------------
    // [3] The real process.
    // ------------------------------------------------------------------
    console.log("[3] running src/purge/main.ts as a real process");
    const first = await runPurgeProcess({
      DATABASE_URL_PURGE: requireEnv("DATABASE_URL_PURGE"),
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY: SUPABASE_KEY,
    });
    console.log(first.out.trim().split("\n").map((l) => `  ${l}`).join("\n"));
    check("the purge process exited 0", first.code === 0, `exit ${first.code}`);
    // `"refused":null` IS the completion line, so a bare /refus/ match reports
    // every successful run as a refusal. Assert the field, not the substring.
    check(
      "the purge completed rather than refusing",
      /"refused":null/.test(first.out) && /"msg":"purge complete"/.test(first.out),
    );

    const gone = await ownerSql<{ n: number }[]>`
      select count(*)::int as n from echo.call where id = ${expiredCall}`;
    check("the expired call's row is gone", gone[0]!.n === 0);
    for (const [table, column] of [
      ["call_part", "call_id"],
      ["transcript_segment", "call_id"],
      ["summary", "call_id"],
    ] as const) {
      const rows = await ownerSql<{ n: number }[]>`
        select count(*)::int as n from echo.${ownerSql(table)} where ${ownerSql(column)} = ${expiredCall}`;
      check(`its ${table} rows are gone`, rows[0]!.n === 0, `${rows[0]!.n} left`);
    }
    check("the expired call's AUDIO is gone from the bucket", !(await objectExists(expiredPath)));

    // The two that must survive — stated as their own checks, because "the
    // purge deleted something" and "the purge deleted only that" are different
    // claims and only the second one is the promise.
    const survivors = await ownerSql<{ id: string }[]>`
      select id from echo.call where id in (${windowCall}, ${liveCall})`;
    check("the call inside its window survived", survivors.some((r) => r.id === windowCall));
    check("the live call survived", survivors.some((r) => r.id === liveCall));
    check("the live call's audio survived", await objectExists(keptPath));

    // ------------------------------------------------------------------
    // [4] Again. A purge is retried after a partial failure as a matter of
    // course, so "idempotent" is an operational requirement, not a nicety.
    // ------------------------------------------------------------------
    console.log("[4] running it a second time");
    const second = await runPurgeProcess({
      DATABASE_URL_PURGE: requireEnv("DATABASE_URL_PURGE"),
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY: SUPABASE_KEY,
    });
    check("the second run also exited 0", second.code === 0, `exit ${second.code}`);
    check(
      "the second run found nothing to do",
      /"callsPurged":0/.test(second.out) || /callsPurged.{0,3}0/.test(second.out),
    );

    // ------------------------------------------------------------------
    // [5] An expired call whose object is ALREADY gone. Tolerated, not an
    // error: it is the state a run interrupted between the object delete and
    // the row delete leaves behind, and if that state jammed the purge, the
    // objects-first ordering would have created the deadlock it exists to
    // prevent.
    // ------------------------------------------------------------------
    console.log("[5] an expired call whose object is already absent");
    const orphan = await mk(`purge ${tag} ORPHANED`);
    await ownerSql`
      insert into echo.call_part (call_id, org_id, idx, offset_ms, storage_bucket, storage_path, status)
      values (${orphan}, ${orgId}, 0, 0, ${BUCKET}, ${`e2e-purge/${tag}/never-existed.bin`}, 'diarized')`;
    await ownerSql.begin(async (tx) => {
      await tx`select set_config('echo.actor_id', ${ownerId}, true)`;
      await tx`update echo.call set deleted_at = now() where id = ${orphan}`;
    });
    await backdate(orphan, "40 days", "1 day");

    const third = await runPurgeProcess({
      DATABASE_URL_PURGE: requireEnv("DATABASE_URL_PURGE"),
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY: SUPABASE_KEY,
    });
    console.log(third.out.trim().split("\n").map((l) => `  ${l}`).join("\n"));
    const orphanGone = await ownerSql<{ n: number }[]>`
      select count(*)::int as n from echo.call where id = ${orphan}`;
    check(
      "an already-absent object does not block the purge",
      third.code === 0 && orphanGone[0]!.n === 0,
      `exit ${third.code}, ${orphanGone[0]!.n} row(s) left`,
    );
    // And it is counted as absence, not as a deletion — the run's own report
    // has to stay truthful about what it actually removed.
    check("it was counted as already-absent, not as a deletion", /"objectsMissing":1/.test(third.out));
  } finally {
    // Whatever the run did or failed to do, the fixture leaves no residue.
    await removeObject(expiredPath);
    await removeObject(keptPath);
    for (const id of created) {
      await ownerSql`delete from echo.summary            where call_id = ${id}`;
      await ownerSql`delete from echo.agent_run          where call_id = ${id}`;
      await ownerSql`delete from echo.transcript_segment where call_id = ${id}`;
      await ownerSql`delete from echo.call_speaker       where call_id = ${id}`;
      await ownerSql`delete from echo.call_part          where call_id = ${id}`;
      await ownerSql`update echo.call set current_summary_id = null where id = ${id}`;
      await ownerSql`delete from echo.call               where id = ${id}`;
    }
    await ownerSql`delete from echo.app_user where id = ${ownerId}`;
    await ownerSql`delete from auth.users    where id = ${ownerId}`;
    await ownerSql`delete from echo.org      where id = ${orgId}`;
    await ownerSql.end();
    await purgeSql.end();
  }

  console.log("\n─── checks ───");
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`\n${failed === 0 ? "PURGE ACCEPTANCE PASSED" : `PURGE ACCEPTANCE FAILED (${failed})`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nharness failed:", (error as Error).message);
  process.exit(1);
});
