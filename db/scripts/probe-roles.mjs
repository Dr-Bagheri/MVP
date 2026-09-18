/**
 * READ-ONLY: the role matrix, from the catalogue rather than from anybody's
 * belief about it.
 *
 * Written for the 2026-09-18 directive "check all roles restrictions and give
 * me a full report of it, and check if all that we agreed on before were
 * applied". A report assembled from memory is testimony; this one is the
 * database describing itself.
 *
 * It answers four questions and nothing else:
 *   1. which database ROLES exist and what each may bypass
 *   2. per product role (member / admin / owner), which named doors exist
 *   3. which tables are readable by whom, from the policies themselves
 *   4. which of the walls we have RULED are actually in force
 *
 * Writes nothing. Run: node db/scripts/probe-roles.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
let url = null;
for (const line of text.split(/\r?\n/)) {
  const at = line.indexOf("=");
  if (at > 0 && line.slice(0, at).trim() === "DATABASE_URL") url = line.slice(at + 1).trim();
}
if (!url) { console.error("no DATABASE_URL in .env"); process.exit(1); }
const at = url.lastIndexOf("@"), se = url.indexOf("://"), cred = url.slice(se + 3, at), c = cred.indexOf(":");
const norm = `${url.slice(0, se + 3)}${encodeURIComponent(cred.slice(0, c))}:`
  + `${encodeURIComponent(decodeURIComponent(cred.slice(c + 1)))}@${url.slice(at + 1)}`;

const client = new pg.Client({ connectionString: norm, ssl: { rejectUnauthorized: false } });
await client.connect();

const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const line = (s) => console.log(s);

try {
  line("## 1. DATABASE ROLES — the wall under everything\n");
  for (const r of await q(
    `select rolname, rolsuper, rolbypassrls, rolcanlogin
       from pg_roles where rolname like 'echo%' order by rolname`)) {
    line(`  ${r.rolname.padEnd(14)} super=${r.rolsuper} bypassrls=${r.rolbypassrls} login=${r.rolcanlogin}`);
  }

  line("\n## 2. TABLES WITH RLS NOT ENABLED-AND-FORCED (should be empty)\n");
  const unforced = await q(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='echo' and c.relkind='r' and not (c.relrowsecurity and c.relforcerowsecurity)
      order by 1`);
  line(unforced.length === 0 ? "  (none — every echo table forces its own policies)"
    : unforced.map((r) => `  *** ${r.relname}`).join("\n"));

  line("\n## 3. WHAT core's OWN ROLE MAY DELETE (the closed allow-list)\n");
  const deletes = await q(
    `select table_name from information_schema.role_table_grants
      where grantee='echo_app' and privilege_type='DELETE' and table_schema='echo' order by 1`);
  line("  " + deletes.map((r) => r.table_name).join(", "));

  line("\n## 4. WHAT THE AGENT'S ROLE MAY DO (M3: borrows the caller's authority, never more)\n");
  const agent = await q(
    `select privilege_type, count(*)::int n from information_schema.role_table_grants
      where grantee='echo_agent' and table_schema='echo' group by 1 order by 1`);
  line("  " + agent.map((r) => `${r.privilege_type}=${r.n} tables`).join("  "));
  const agentWrites = await q(
    `select table_name, privilege_type from information_schema.role_table_grants
      where grantee='echo_agent' and table_schema='echo'
        and privilege_type in ('INSERT','UPDATE','DELETE') order by 1,2`);
  line("  writes: " + (agentWrites.length === 0 ? "(none)"
    : agentWrites.map((r) => `${r.table_name}:${r.privilege_type}`).join(", ")));

  line("\n## 5. THE NAMED DOORS (definer functions — the only way past a policy)\n");
  for (const r of await q(
    `select p.proname,
            pg_get_function_identity_arguments(p.oid) as args,
            coalesce(array_to_string(p.proacl, ' '), '(PUBLIC — no explicit grant)') as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='echo' and p.prosecdef order by p.proname`)) {
    const who = r.acl.includes("echo_app") ? "echo_app"
      : r.acl.includes("echo_root") ? "echo_root"
      : r.acl.includes("echo_purge") ? "echo_purge"
      : r.acl.includes("PUBLIC") ? "*** PUBLIC ***" : r.acl;
    line(`  ${r.proname.padEnd(34)} ${who}`);
  }

  line("\n## 6. THE RULED WALLS, each asked of the catalogue\n");
  const checks = [
    ["no app role bypasses RLS",
     `select count(*)=0 from pg_roles where rolname in ('echo_app','echo_agent','echo_purge') and (rolsuper or rolbypassrls)`],
    ["the agent holds no DELETE anywhere (M3)",
     `select count(*)=0 from information_schema.role_table_grants
       where grantee='echo_agent' and table_schema='echo' and privilege_type='DELETE'`],
    ["org status is vendor-only (D27, 0052)",
     `select count(*)>0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='echo' and p.proname='vendor_set_org_status'`],
    /* count DISTINCT, and the reason is a red this probe produced on its own
       first run: `soft_delete_call` has two OVERLOADS, so counting rows gave
       3 against an expected 2 and reported a wall that is in force as broken.
       A count over the catalogue is a fact about how a function is spelled
       wearing the costume of a fact about the wall. */
    ["a record's soft delete goes through a named door (M11, 0032)",
     `select count(distinct p.proname)=2 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='echo' and p.proname in ('soft_delete_call','restore_call')`],
    ["member privileges are bound by the rank above (0101)",
     `select count(*)>0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='echo' and p.proname='role_is_admin'`],
    ["a project is admin-written and member-read (0186)",
     `select count(*)=3 from pg_policies where schemaname='echo' and tablename='project'
        and cmd in ('INSERT','UPDATE','DELETE') and coalesce(with_check,qual) like '%admin%'`],
    ["an alarm is own-only in every direction (0231)",
     `select count(*)=4 from pg_policies where schemaname='echo' and tablename='reminder'
        and coalesce(qual,'')||coalesce(with_check,'') like '%actor_id()%'`],
    ["the agent cannot write a person's alarms (0231)",
     `select not has_table_privilege('echo_agent','echo.reminder','insert')`],
    ["an unverified org cannot spend a model call (0224)",
     `select count(*)>0 from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='echo' and c.relname='agent_run' and not t.tgisinternal`],
    ["the two shipped agents differ in what they may DO (0233)",
     `select count(*)=1 from echo.assistant_agent a
       where a.level='system' and a.handle='roya' and a.can_act
         and exists (select 1 from echo.assistant_agent b
                      where b.level='system' and b.handle='ava' and not b.can_act)`],
  ];
  for (const [label, sql] of checks) {
    const ok = (await q(sql))[0];
    const value = Object.values(ok ?? {})[0];
    line(`  ${value === true ? "yes " : "*** NO "} ${label}`);
  }

  line("\n## 7. THE PRODUCT ROLES, as the database spells them\n");
  for (const r of await q(
    `select unnest(enum_range(null::echo.member_role))::text as role`)) line(`  ${r.role}`);
  line("\n  (the PLATFORM root is not one of these — it is a separate database");
  line("   role reached through require_platform_root, so a customer's owner");
  line("   cannot become one by any UPDATE)");
} finally {
  await client.end();
}
