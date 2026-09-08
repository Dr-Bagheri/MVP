-- db/0215 — a skill keeps every wording it has had.
--
-- The migration's self-checks ran once, on the day it was applied. They
-- cannot see the trigger dropped, the grants widened, or the read policy
-- rewritten two migrations from now — which are exactly the edits they exist
-- for (0189's lesson). So the rules live here as well.
--
-- The load-bearing one is not "a version is written". It is **nobody can
-- write one**: a history the api can author is a history the api can also
-- forge, and a procedure a team relies on is worth exactly as much as the
-- record of how it changed.
--
--   alice  owner,  org A   01…01
--   bob    member, org A   02…02
--   erin   owner,  org B   05…05

reset role;

-- ── an org skill and a personal one ───────────────────────────────────────
insert into echo.skill (id, level, org_id, slug, name, description, prompt, created_by)
values ('16000000-0000-4000-8000-000000000a01'::uuid, 'org',
        '0a000000-0000-4000-8000-00000000000a',
        'test-0215-org', 'روش پذیرش', 'برای تست', 'نسخهٔ یک',
        '01000000-0000-4000-8000-000000000001');

insert into echo.skill (id, level, org_id, user_id, slug, name, description, prompt, created_by)
values ('16000000-0000-4000-8000-000000000a02'::uuid, 'user',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        'test-0215-mine', 'مال باب', '', 'خصوصی',
        '02000000-0000-4000-8000-000000000002');

select t.ok(
  (select count(*) = 1 from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a01' and version = 1),
  '0215: a new skill is born with version 1');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0215 tests run under a non-bypass product role');
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, admin

-- ── AN EDIT APPENDS, AND IS ATTRIBUTED TO WHOEVER MADE IT ─────────────────
update echo.skill set prompt = 'نسخهٔ دو'
 where id = '16000000-0000-4000-8000-000000000a01';

select t.ok(
  (select count(*) = 2 from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a01'),
  '0215: editing the wording appends a version');
select t.ok(
  (select created_by = '01000000-0000-4000-8000-000000000001'
     from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a01' and version = 2),
  '0215: and the version carries the actor who saved it');
select t.ok(
  (select prompt = 'نسخهٔ یک' from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a01' and version = 1),
  '0215: the OLD wording is still readable — the whole point');

-- ── A STATE CHANGE IS NOT AN EDIT ─────────────────────────────────────────
--
-- Without this, a version per toggle buries the four edits that matter in
-- forty that do not, and the question the table answers («what did it used to
-- say») stops being answerable by reading it.
update echo.skill set enabled = false
 where id = '16000000-0000-4000-8000-000000000a01';
select t.ok(
  (select count(*) = 2 from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a01'),
  '0215: toggling enabled appends nothing');
/* the control: an edit in the SAME statement shape still appends, so the line
   above is about what changed and not about updates in general */
update echo.skill set enabled = true, name = 'روش پذیرش مشتری'
 where id = '16000000-0000-4000-8000-000000000a01';
select t.ok(
  (select count(*) = 3 from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a01'),
  '0215: ...and a rename in the same shape does append');

-- ── NOBODY WRITES A VERSION BY HAND ───────────────────────────────────────
--
-- The wall. These are GRANT refusals, so they raise — `t.denied`, not an
-- assertion on the record (0186: a policy-walled write matches zero rows and
-- succeeds, and asserting the record would report a working wall as broken).
select t.denied(
  $$insert into echo.skill_version
      (skill_id, level, org_id, version, name, description, prompt, tools)
    values ('16000000-0000-4000-8000-000000000a01', 'org',
            '0a000000-0000-4000-8000-00000000000a', 99, 'x', '', 'forged', '[]')$$,
  '0215: an admin cannot write a version by hand');
select t.denied(
  $$update echo.skill_version set prompt = 'rewritten'
     where skill_id = '16000000-0000-4000-8000-000000000a01'$$,
  '0215: nor rewrite one');
select t.denied(
  $$delete from echo.skill_version
     where skill_id = '16000000-0000-4000-8000-000000000a01'$$,
  '0215: nor delete one');
select t.ok(
  has_table_privilege('echo_app', 'echo.skill_version', 'SELECT'),
  '0215: and the discriminating half — a history nobody can read is useless');

-- ── A VERSION IS VISIBLE EXACTLY WHEN ITS SKILL IS ────────────────────────
--
-- The policy is 0018's `skill_read` word for word over this table's own
-- copies of level/org_id/user_id. A new index onto a table is where a wall
-- stops being true, so both directions are asserted.
select t.ok(
  (select count(*) = 0 from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a02'),
  '0215: an admin does not read a colleague''s PERSONAL skill history');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  (select count(*) = 1 from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a02'),
  '0215: ...and its owner does');
select t.ok(
  (select count(*) >= 3 from echo.skill_version
    where skill_id = '16000000-0000-4000-8000-000000000a01'),
  '0215: a member reads the ORG skill''s history, as they read the skill');

select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin, org B
select t.ok(
  (select count(*) = 0 from echo.skill_version
    where skill_id in ('16000000-0000-4000-8000-000000000a01',
                       '16000000-0000-4000-8000-000000000a02')),
  '0215: another organisation reads neither');

-- ── AND THE AGENT READS BUT NEVER WRITES ──────────────────────────────────
select t.ok(
  has_table_privilege('echo_agent', 'echo.skill_version', 'SELECT'),
  '0215: the agent may read a skill''s history');
select t.ok(
  not has_table_privilege('echo_agent', 'echo.skill_version', 'INSERT'),
  '0215: and may not write one');

-- ── A DELETED SKILL TAKES ITS HISTORY ─────────────────────────────────────
reset role;
delete from echo.skill where id in ('16000000-0000-4000-8000-000000000a01',
                                    '16000000-0000-4000-8000-000000000a02');
select t.ok(
  (select count(*) = 0 from echo.skill_version
    where skill_id in ('16000000-0000-4000-8000-000000000a01',
                       '16000000-0000-4000-8000-000000000a02')),
  '0215: versions do not outlive their skill');

-- ── THE PURGE NAMES IT ────────────────────────────────────────────────────
select t.ok(
  position('delete from echo.skill_version' in (
    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.proname = 'platform_purge_org')) > 0,
  '0215: the purge deletes skill versions');
