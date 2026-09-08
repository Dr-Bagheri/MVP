-- db/0208 — a project has a stage, a lead, a priority and two dates.
--
-- 0208's own self-checks ran once, on the day it was applied. This is the
-- standing half: it survives a later migration dropping and recreating any of
-- these walls, which is the edit the self-checks cannot see.
--
-- FOUR WALLS, each with the half that must be ACCEPTED beside the half that
-- must be REFUSED. A file that only asserts refusals passes against a column
-- nobody can write at all — the authorization-matrix corollary pointed at a
-- CHECK constraint instead of a policy.
--
--   alice  owner,  org A   01000000-0000-4000-8000-000000000001
--   dave   admin,  org A   — writes are admin-walled by 0186 and that has not
--                            moved; these tests are about the COLUMNS, so
--                            they run as an admin and any refusal here is the
--                            constraint's, never the policy's
--   bob    member, org A   02000000-0000-4000-8000-000000000002
--   erin   owner,  org B   05000000-0000-4000-8000-000000000005
--
-- The lead FK is the one that needed a migration's care (0188): its cascade
-- names its single column, because the composite key holds a NOT NULL org_id
-- and a bare SET NULL over it can only ever raise. 109 asserts that CLASS
-- across the schema; this file asserts this constraint does the job the class
-- is about — a lead's row is deleted and the project survives without one.

reset role;

insert into echo.project (id, org_id, name, created_by)
values ('a8000000-0000-4000-8000-000000000f08'::uuid,
        '0a000000-0000-4000-8000-00000000000a',
        'پروژهٔ ۰۲۰۸', '01000000-0000-4000-8000-000000000001');

-- ── the defaults an existing row takes ─────────────────────────────────────
select t.ok(
  (select stage = 'active' and priority = 'medium'
      and lead_id is null and starts_on is null and due_on is null
     from echo.project where id = 'a8000000-0000-4000-8000-000000000f08'),
  '0208: a new project is active, medium, with no lead and no dates');

-- ── the closed sets, both directions ───────────────────────────────────────
select t.raises(
  $$update echo.project set stage = 'finished'
     where id = 'a8000000-0000-4000-8000-000000000f08'$$,
  '23514', '0208: an unknown stage is refused');
select t.raises(
  $$update echo.project set priority = 'urgent'
     where id = 'a8000000-0000-4000-8000-000000000f08'$$,
  '23514', '0208: an unknown priority is refused');

/* THE DISCRIMINATING HALF. Without these two the pair above passes against a
   constraint that refuses every value, which is the version of this wall that
   is completely wrong and completely green. */
update echo.project set stage = 'paused', priority = 'critical'
 where id = 'a8000000-0000-4000-8000-000000000f08';
select t.ok(
  (select stage = 'paused' and priority = 'critical'
     from echo.project where id = 'a8000000-0000-4000-8000-000000000f08'),
  '0208: a permitted stage and priority are accepted');

-- ── the dates are ordered, both directions ─────────────────────────────────
select t.raises(
  $$update echo.project set starts_on = date '2026-10-01', due_on = date '2026-09-01'
     where id = 'a8000000-0000-4000-8000-000000000f08'$$,
  '23514', '0208: a project cannot end before it starts');

update echo.project set starts_on = date '2026-09-01', due_on = date '2026-10-01'
 where id = 'a8000000-0000-4000-8000-000000000f08';
select t.ok(
  (select starts_on = date '2026-09-01' and due_on = date '2026-10-01'
     from echo.project where id = 'a8000000-0000-4000-8000-000000000f08'),
  '0208: an ordered pair of dates is accepted');

/* AND EACH ONE ALONE. `starts_on is null or due_on is null or ...` is three
   branches, and a check written as a bare comparison would refuse a project
   that has only a deadline — the ordinary state of a project somebody has not
   said when they began. */
update echo.project set starts_on = null where id = 'a8000000-0000-4000-8000-000000000f08';
select t.ok(
  (select starts_on is null and due_on = date '2026-10-01'
     from echo.project where id = 'a8000000-0000-4000-8000-000000000f08'),
  '0208: a deadline with no start date is a legal project');

-- ── the lead belongs to the org, and only to this one ──────────────────────
update echo.project set lead_id = '02000000-0000-4000-8000-000000000002'
 where id = 'a8000000-0000-4000-8000-000000000f08';
select t.ok(
  (select lead_id = '02000000-0000-4000-8000-000000000002'
     from echo.project where id = 'a8000000-0000-4000-8000-000000000f08'),
  '0208: a colleague in the same org can be the lead');

select t.raises(
  $$update echo.project set lead_id = '05000000-0000-4000-8000-000000000005'
     where id = 'a8000000-0000-4000-8000-000000000f08'$$,
  '23503', '0208: somebody from another organisation cannot be the lead');

/* THE CASCADE, exercised rather than read. A lead is deleted and the project
   must survive WITHOUT one — the state 0188's bare `set null` could not
   produce, because nulling the whole key would take org_id with it and
   org_id is NOT NULL. Owner altitude: echo_app holds no DELETE on app_user,
   and this is a fact about the constraint rather than about a role. */
do $t$
declare
  v_org constant uuid := '0a000000-0000-4000-8000-00000000000a';
  v_tmp constant uuid := 'a8000000-0000-4000-8000-0000000001ea';
begin
  /* the AUTH IDENTITY first: 0171's trigger refuses a human member without
     one, and the first draft of this block minted the member alone and was
     refused for a reason that had nothing to do with 0208 — the fixture's own
     shape is the one that works (test/fixture.sql seeds both, in this order) */
  insert into auth.users (id, email) values (v_tmp, 'lead-0208@example.com');
  insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at)
  values (v_tmp, v_org, 'lead-0208@example.com', 'سرپرست موقت',
          'member', 'active', now());

  update echo.project set lead_id = v_tmp
   where id = 'a8000000-0000-4000-8000-000000000f08';

  delete from echo.app_user where id = v_tmp;

  perform t.ok(
    (select lead_id is null and org_id = v_org
       from echo.project where id = 'a8000000-0000-4000-8000-000000000f08'),
    '0208: deleting the lead clears the pointer and leaves the project in its org');

  delete from auth.users where id = v_tmp;
end $t$;

-- ── a member still cannot write any of it (0186 has not moved) ─────────────
--
-- The new columns are on a table whose UPDATE policy is admin-only, and a
-- narrowing's most likely silent failure is a new column arriving outside the
-- wall the rest of the row is behind. An UPDATE a policy filters is not
-- refused — it matches nothing and succeeds — so the assertion is on the
-- RECORD, never on the statement (0186's own note).
set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0208 tests run under a non-bypass product role');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, member
update echo.project set stage = 'done', priority = 'low'
 where id = 'a8000000-0000-4000-8000-000000000f08';

reset role;
select t.ok(
  (select stage = 'paused' and priority = 'critical'
     from echo.project where id = 'a8000000-0000-4000-8000-000000000f08'),
  '0208: a member''s write to the new columns moves nothing');

-- and the admin's does, which is what makes the line above about the ROLE
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner
update echo.project set stage = 'done'
 where id = 'a8000000-0000-4000-8000-000000000f08';
reset role;
select t.ok(
  (select stage = 'done' from echo.project where id = 'a8000000-0000-4000-8000-000000000f08'),
  '0208: an admin sets the stage');

delete from echo.project where id = 'a8000000-0000-4000-8000-000000000f08';
