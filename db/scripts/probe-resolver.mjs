/**
 * ACCEPTANCE for the entity resolver (core/src/api/entities.ts) against the
 * REAL schema, under the REAL app role, with REAL RLS.
 *
 *   node db/scripts/probe-resolver.mjs
 *
 * Opt-in, not in any suite (rule 7's live-lane standard): it needs a real
 * database and the owner connection from .env.
 *
 * Why not a fake: the resolve is a recursive CTE walking `merged_into`, and a
 * fake that follows the chain in JavaScript is my own belief about what that
 * SQL does — the one thing a fake cannot check. Its first run earned its keep
 * by refusing two assertions I had written against my own wrong model of what
 * `attachAlias` leaves behind.
 *
 * Why this cannot damage production: everything happens inside ONE
 * transaction that is ROLLED BACK in a finally, and the file contains no
 * COMMIT. The counts are re-read afterwards on a fresh connection to prove
 * nothing landed.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  attachAlias, detachAlias, ensureEntity, resolveAlias,
} from "../../core/src/api/entities.ts";

const raw = readFileSync("C:/Users/Asus/Desktop/neurai-mvp/MVP/.env", "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const norm = (u) => {
  const m = /^(postgres(?:ql)?:\/\/)([^:]+):([^@]*)@(.+)$/.exec(u);
  return m ? `${m[1]}${m[2]}:${encodeURIComponent(m[3])}@${m[4]}` : u;
};

let passed = 0;
const checks = [];
const ok = (cond, label) => { checks.push([!!cond, label]); if (cond) passed += 1; };

/*
 * This laptop's .env carries only the OWNER connection, so the run drops to
 * echo_app the way db/test does — `set local role`. Which makes rule 11's
 * precondition mandatory rather than decorative: run as the owner and every
 * policy check passes unconditionally and reports the wall it exists for as
 * intact. Check 0 below is that assertion.
 */
const appClient = new pg.Client({
  connectionString: norm(env.DATABASE_URL),
  ssl: { rejectUnauthorized: false },
});
await appClient.connect();

/** the SqlTx shape entities.ts uses: only `unsafe` */
const tx = { unsafe: async (sql, params = []) => (await appClient.query(sql, params)).rows };

// an ACTIVE member of a real org to act as
const ownerRow = await new pg.Client({
  connectionString: norm(env.DATABASE_URL), ssl: { rejectUnauthorized: false },
});
await ownerRow.connect();
const who = (await ownerRow.query(
  `select u.id, u.org_id from echo.app_user u
    where u.status = 'active' and u.tombstoned_at is null
      and u.org_id = (select id from echo.org where name = 'neurai')
    order by (u.role::text = 'owner') desc limit 1`,
)).rows[0];
const before = (await ownerRow.query(
  `select (select count(*)::int from echo.entity) e,
          (select count(*)::int from echo.entity_alias) a,
          (select count(*)::int from echo.entity where merged_into is not null) m`,
)).rows[0];

try {
  await appClient.query("begin");
  await appClient.query(
    `select set_config('role', 'echo_app', true), set_config('echo.actor_id', $1, true)`,
    [who.id],
  );

  // 0. THE PRECONDITION (rule 11): prove we are BELOW the wall before
  //    measuring it. A superuser passes every policy check unconditionally.
  const guard = (await appClient.query(
    `select current_user as who, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
  )).rows[0];
  ok(guard.who === "echo_app" && guard.bypass === false,
     `running below the wall (current_user=${guard.who}, bypassrls=${guard.bypass})`);

  const stamp = Date.now();
  const A = { source: "neurai", kind: "external_id", value: `ACCEPT-A-${stamp}` };
  const B = { source: "neurai", kind: "external_id", value: `ACCEPT-B-${stamp}` };

  // 1. an identifier nobody has ever seen resolves to NOTHING (not an error)
  ok((await resolveAlias(tx, A)) === null, "an unknown identifier resolves to null");

  // 2. ensure creates the node and the identifier names it
  const e1 = await ensureEntity(tx, A, { kind: "person", displayName: "پذیرش الف" }, who.id);
  ok(e1?.id && e1.display_name === "پذیرش الف", "ensure created a node with the seeded Persian name");
  ok((await resolveAlias(tx, A))?.id === e1.id, "the identifier now resolves to it");

  // 3. ensure is idempotent — a second call is a READ
  const again = await ensureEntity(tx, A, { kind: "person", displayName: "ignored" }, who.id);
  ok(again.id === e1.id, "ensure a second time returns the same node, not a new one");

  // 4. a second node, and attaching A's identifier to it MOVES it and merges
  const e2 = await ensureEntity(tx, B, { kind: "person", displayName: "پذیرش ب" }, who.id);
  ok(e2.id !== e1.id, "the second identifier made its own node");
  const moved = await attachAlias(tx, { alias: A, toEntityId: e2.id, actorId: who.id, evidence: { t: "accept" } });
  ok(moved.moved === true && moved.mergedEmptied === true, "attach moved it and emptied node one");

  // 5. THE RECURSIVE WALK: the OLD node's id still resolves, through merged_into
  ok((await resolveAlias(tx, A))?.id === e2.id, "the moved identifier resolves to the keeper");
  const chain = await tx.unsafe(`select merged_into from echo.entity where id = $1`, [e1.id]);
  ok(chain[0]?.merged_into === e2.id, "the emptied node points at the keeper");

  /*
   * 6. THE MERGE WALK. This state is the one a node-merge door leaves —
   *    aliases STAY on the loser and the loser points at the winner (0230's
   *    own model). No such door exists yet, so it is written here directly,
   *    which is exactly what that door will do. Without this the recursive
   *    CTE would be unexercised code: `attachAlias` only ever merges a node
   *    it has just EMPTIED, and an empty node has no alias to walk from.
   */
  const C = { source: "neurai", kind: "external_id", value: `ACCEPT-C-${stamp}` };
  const e3 = await ensureEntity(tx, C, { kind: "person", displayName: "پذیرش ج" }, who.id);
  await tx.unsafe(`update echo.entity set merged_into = $1, merged_at = now() where id = $2`,
                  [e3.id, e2.id]);
  ok((await resolveAlias(tx, B))?.id === e3.id,
     "an alias left on a merged node resolves to the winner (one hop)");

  // a genuine TWO-hop chain: X -> e2 -> e3, with the alias down at X
  const X = { source: "neurai", kind: "external_id", value: `ACCEPT-X-${stamp}` };
  const eX = await ensureEntity(tx, X, { kind: "person", displayName: "پذیرش ایکس" }, who.id);
  await tx.unsafe(`update echo.entity set merged_into = $1, merged_at = now() where id = $2`,
                  [e2.id, eX.id]);
  ok((await resolveAlias(tx, X))?.id === e3.id,
     "and through TWO hops: the alias's node -> a merged node -> the winner");

  // 7. attach is idempotent — attaching where it already sits does nothing
  const twice = await attachAlias(tx, { alias: C, toEntityId: e3.id, actorId: who.id });
  ok(twice.moved === false && twice.mergedEmptied === false, "attaching where it already is does nothing");

  // 8. detach gives it a node of its own again
  const split = await detachAlias(tx, {
    alias: A, seed: { kind: "person", displayName: "پذیرش الف" }, actorId: who.id,
  });
  ok(split.id !== e3.id, "detach created a fresh node");
  ok((await resolveAlias(tx, A))?.id === split.id, "the identifier resolves to the fresh node");
  ok((await resolveAlias(tx, B))?.id === e3.id, "the OTHER identifier still resolves to the survivor");

  // 9. detach on an identifier the spine has never met still gives it a node
  const D = { source: "manual", kind: "handle", value: `ACCEPT-D-${stamp}` };
  const fresh = await detachAlias(tx, { alias: D, seed: { kind: "person", displayName: "تازه" }, actorId: who.id });
  ok((await resolveAlias(tx, D))?.id === fresh.id, "detach on an unknown identifier creates and names a node");

  // 10. the value is normalized on the way in AND on the way out
  const E = { source: "manual", kind: "email", value: `  ACCEPT-E-${stamp}@X.COM  ` };
  const eE = await ensureEntity(tx, E, { kind: "person", displayName: "ایمیل" }, who.id);
  ok((await resolveAlias(tx, { ...E, value: `accept-e-${stamp}@x.com` }))?.id === eE.id,
     "a differently-cased, padded identifier resolves to the same node");

  /*
   * 11. THE WALL IS STILL THE WALL: no product role may delete a node.
   *
   * Inside a SAVEPOINT, because a refused statement ABORTS the transaction
   * and every check after it would then fail with 25P02 — which is how this
   * probe first ran, and the same fact that made `ensureEntity`'s original
   * catch-and-retry dead code.
   */
  let refused = false;
  await appClient.query("savepoint wall_probe");
  try { await appClient.query(`delete from echo.entity where id = $1`, [eE.id]); }
  catch (err) { refused = err.code === "42501"; }
  await appClient.query("rollback to savepoint wall_probe");
  ok(refused, "echo_app is still refused DELETE on the spine (42501)");

  /*
   * 11b. THE RACE, against the real constraint.
   *
   * `ensureEntity` reads, then inserts `on conflict do nothing`; zero rows
   * back means somebody else claimed the identifier in between. That branch
   * is a recovery path, and this repo's rule is that the states a recovery
   * path handles are mandatory fixtures — the purge's already-absent branch
   * was dead code for exactly as long as nobody built the state it was for.
   *
   * The interleaving is reproduced by blinding the first resolve: we looked
   * before they committed, and by the time we wrote, they had.
   */
  const R = { source: "manual", kind: "handle", value: `accept-race-${stamp}` };
  const rTheirs = await ensureEntity(tx, R, { kind: "person", displayName: "آنها" }, who.id);
  let blind = true;
  const racingTx = {
    unsafe: async (sql, params) => {
      if (blind && sql.includes("with recursive chain")) { blind = false; return []; }
      return tx.unsafe(sql, params);
    },
  };
  const rOurs = await ensureEntity(racingTx, R, { kind: "person", displayName: "ما" }, who.id);
  ok(rOurs.id === rTheirs.id && rOurs.display_name === "آنها",
     "a lost race hands back the winner's node, and the transaction is still usable");
  ok((await resolveAlias(tx, R))?.id === rTheirs.id,
     "and the identifier still names exactly one thing afterwards");

  /*
   * 12. THE PRODUCT PATH, end to end, on real rows.
   *
   * The directory link now runs inside the person UPDATE's own transaction,
   * which means a mistake in the spine SQL does not leave a stale brain — it
   * BREAKS LINKING. Nothing above proves that path: it proves the pieces. So
   * the real repo is driven here, against a real unlinked directory person
   * and the real account with the same name, and then rolled back with
   * everything else.
   */
  const { createDirectoryRepo } = await import("../../core/src/api/directory.ts");
  const { resetCapabilityCache } = await import("../../core/src/db/capabilities.ts");
  resetCapabilityCache();

  const pair = (await appClient.query(
    `select p.id as person_id, p.display_name, u.id as app_user_id
       from echo.person p
       join echo.app_user u on u.org_id = p.org_id and u.tombstoned_at is null
        and echo.fa_fold(u.display_name) = echo.fa_fold(p.display_name)
      where p.merged_into is null and p.app_user_id is null
      limit 1`,
  )).rows[0];

  if (!pair) {
    ok(false, "PRECONDITION: an unlinked directory person with a same-named account (none found — this check did not run)");
  } else {
    /* a Db that routes every door to the ONE rolled-back transaction */
    const db = {
      withIdentity: (_who, fn) => fn(tx),
      withoutIdentity: (fn) => fn(tx),
    };
    const identity = { userId: who.id, orgId: who.org_id, role: "owner", isActive: true };
    const repo = createDirectoryRepo(db);

    const linked = await repo.update(identity, pair.person_id, { appUserId: pair.app_user_id });
    ok(linked.app_user_id === pair.app_user_id,
       `the product fact landed: «${pair.display_name}» is linked to its account`);

    const personRef = { source: "neurai", kind: "person", value: pair.person_id };
    const accountRef = { source: "neurai", kind: "app_user", value: pair.app_user_id };
    const viaPerson = await resolveAlias(tx, personRef);
    const viaAccount = await resolveAlias(tx, accountRef);
    ok(viaPerson && viaAccount && viaPerson.id === viaAccount.id,
       "and the brain agrees: the directory row and the account resolve to ONE node");

    const unlinked = await repo.update(identity, pair.person_id, { appUserId: null });
    ok(unlinked.app_user_id === null, "clearing the link lands too");
    const after = await resolveAlias(tx, personRef);
    const account2 = await resolveAlias(tx, accountRef);
    ok(after && account2 && after.id !== account2.id,
       "and the brain retracts it: they are two nodes again");
  }
} finally {
  await appClient.query("rollback");
  await appClient.end();
}

const after = (await ownerRow.query(
  `select (select count(*)::int from echo.entity) e,
          (select count(*)::int from echo.entity_alias) a,
          (select count(*)::int from echo.entity where merged_into is not null) m`,
)).rows[0];
await ownerRow.end();

for (const [good, label] of checks) console.log((good ? "  PASS  " : "  FAIL  ") + label);
console.log(`\n${passed}/${checks.length} checks`);
console.log("counts before:", JSON.stringify(before));
console.log("counts after :", JSON.stringify(after));
const clean = before.e === after.e && before.a === after.a && before.m === after.m;
console.log(clean ? "ROLLED BACK CLEAN — production unchanged" : "!!! PRODUCTION CHANGED !!!");
process.exit(passed === checks.length && clean ? 0 : 1);
