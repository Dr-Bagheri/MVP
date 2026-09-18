-- db/0230 — the entity spine.
--
-- THE WHOLE MATRIX (rule 7's corollary: the ordinary path is the product).
-- What this file holds in place is the small set of facts the brain will be
-- built on, each of which is silently wrong in a plausible implementation:
--
--   · one identifier names one thing per organisation (that is what makes
--     resolution a lookup rather than a search)
--   · a NAME is not an identifier — two entities may share one, and a spine
--     that enforced otherwise would refuse this organisation's two «سینا»
--   · an alias cannot point across organisations, refused by STRUCTURE
--   · a pending member writes nothing; the agent reads and writes nothing
--   · nobody may DELETE — a node a fact points at cannot vanish under it
--
--   alice  01…  owner,  org A      dan  04…  PENDING, org A
--   bob    02…  member, org A ACTIVE (the ordinary member the wall is about)
--   erin   05…  org B — the other side of every cross-org line
--   org A  0a…a   org B  0b…b

reset role;
select t.ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'echo' and c.relname in ('entity','entity_alias')) = 2,
  '0230: echo.entity and echo.entity_alias exist');

select t.ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'echo' and c.relname in ('entity','entity_alias')
      and c.relrowsecurity and c.relforcerowsecurity) = 2,
  '0230: both spine tables have RLS enabled AND forced');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0230 tests run under a non-bypass product role');

-- ─── AN ACTIVE MEMBER WRITES THE SPINE ───────────────────────────────────
-- The resolver runs on the caller's behalf, so an ordinary member writing a
-- node is the ordinary path, not an admin's privilege.
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

insert into echo.entity (id, org_id, kind, display_name, created_by)
values ('e1000000-0000-4000-8000-000000000e01'::uuid, echo.actor_org_id(), 'person',
        'سینا سپاسی', echo.actor_id());
select t.ok(
  (select count(*) from echo.entity where id = 'e1000000-0000-4000-8000-000000000e01') = 1,
  '0230: an active member created an entity and reads it back');

insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by)
values (echo.actor_org_id(), 'e1000000-0000-4000-8000-000000000e01', 'slack', 'handle',
        'sina', echo.actor_id());
select t.ok(
  (select entity_id from echo.entity_alias
    where org_id = echo.actor_org_id() and source = 'slack' and kind = 'handle' and value = 'sina')
    = 'e1000000-0000-4000-8000-000000000e01'::uuid,
  '0230: an identifier resolves to its entity in one lookup');

-- ─── ONE IDENTIFIER NAMES ONE THING ──────────────────────────────────────
insert into echo.entity (id, org_id, kind, display_name, created_by)
values ('e2000000-0000-4000-8000-000000000e02'::uuid, echo.actor_org_id(), 'person',
        'سینا رضایی', echo.actor_id());

select t.denied(
  $$insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by)
    values (echo.actor_org_id(), 'e2000000-0000-4000-8000-000000000e02', 'slack', 'handle',
            'sina', echo.actor_id())$$,
  '0230: the same slack handle cannot name a second entity in one organisation');

-- ─── BUT A NAME IS NOT AN IDENTIFIER ─────────────────────────────────────
-- This organisation really does have two «سینا» (2026-09-08's ambiguous-name
-- fixture). A spine that made the name unique would refuse the second person,
-- and one that treated it as a link would answer "who is سینا" with a guess.
insert into echo.entity (id, org_id, kind, display_name, created_by)
values ('e3000000-0000-4000-8000-000000000e03'::uuid, echo.actor_org_id(), 'person',
        'سینا سپاسی', echo.actor_id());
select t.ok(
  (select count(*) from echo.entity
    where org_id = echo.actor_org_id() and echo.fa_fold(display_name) = echo.fa_fold('سینا سپاسی')) = 2,
  '0230: two entities may share a name, and the fold finds BOTH as candidates');

-- ─── THE CROSS-ORG LINE, REFUSED BY STRUCTURE ────────────────────────────
-- Not by whoever happens to be running: the composite FK over
-- (entity_id, org_id) is what refuses it (D9 — a policy would only refuse the
-- people it runs as).
select t.denied(
  $$insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by)
    values (echo.actor_org_id(), 'e9000000-0000-4000-8000-000000000e99', 'crm', 'external_id',
            'ACME-1', echo.actor_id())$$,
  '0230: an alias cannot point at an entity id this organisation does not hold');

select t.denied(
  $$update echo.entity set merged_into = 'e9000000-0000-4000-8000-000000000e99'
     where id = 'e3000000-0000-4000-8000-000000000e03'$$,
  '0230: a merge cannot point at an entity id this organisation does not hold');

-- a real merge, inside the org, is fine — the loser keeps its aliases
update echo.entity set merged_into = 'e1000000-0000-4000-8000-000000000e01',
                       merged_at = now(), merged_by = echo.actor_id()
 where id = 'e3000000-0000-4000-8000-000000000e03';
select t.ok(
  (select merged_into from echo.entity where id = 'e3000000-0000-4000-8000-000000000e03')
    = 'e1000000-0000-4000-8000-000000000e01'::uuid,
  '0230: two nodes that turn out to be one thing merge inside the organisation');

-- ─── ANOTHER ORGANISATION SEES NOTHING ───────────────────────────────────
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin, org B
select t.ok(
  (select count(*) from echo.entity where id = 'e1000000-0000-4000-8000-000000000e01') = 0,
  '0230: another organisation cannot read this one''s entities');
select t.ok(
  (select count(*) from echo.entity_alias where value = 'sina') = 0,
  '0230: another organisation cannot read this one''s aliases');

-- ─── A PENDING MEMBER WRITES NOTHING ─────────────────────────────────────
-- 04 is dan, who is PENDING: without this line every "a member may write"
-- assertion above would be measuring actor_is_active() rather than the policy.
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true); -- dan
select t.denied(
  $$insert into echo.entity (org_id, kind, display_name, created_by)
    values (echo.actor_org_id(), 'person', 'کسی', echo.actor_id())$$,
  '0230: a pending member cannot write to the spine');

-- ─── THE AGENT READS AND WRITES NOTHING ──────────────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  (select count(*) from echo.entity where id = 'e1000000-0000-4000-8000-000000000e01') = 1,
  '0230: the agent reads the spine (it answers questions from it)');
select t.denied(
  $$insert into echo.entity (org_id, kind, display_name, created_by)
    values (echo.actor_org_id(), 'person', 'ساختهٔ عامل', echo.actor_id())$$,
  '0230: the agent cannot write the spine');

-- ─── NOBODY MAY DELETE ───────────────────────────────────────────────────
reset role;
-- scoped to `echo\_%`: role_table_grants also reports the table OWNER's
-- implicit privileges, and counting those measures who owns the table rather
-- than who may delete from it (rule 11's catalogue trap — it cost 0230 a run)
select t.ok(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'echo' and table_name in ('entity','entity_alias')
      and privilege_type = 'DELETE' and grantee like 'echo\_%') = 0,
  '0230: no product role holds DELETE on the spine — a node a fact points at cannot vanish');

-- ─── THE PURGE KNOWS BOTH, CHILDREN FIRST ────────────────────────────────
select t.ok(
  (select position('delete from echo.entity_alias' in pg_get_functiondef(p.oid)) > 0
      and position('delete from echo.entity ' in pg_get_functiondef(p.oid)) > 0
      and position('delete from echo.entity_alias' in pg_get_functiondef(p.oid))
        < position('delete from echo.entity ' in pg_get_functiondef(p.oid))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'echo' and p.proname = 'platform_purge_org'),
  '0230: the purge deletes the aliases before the entities');
