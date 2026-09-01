-- db/0145 — meetings: org-shared, org-walled, never deleted.
--
-- The matrix, same shape as the task board's (100_tasks.sql):
--   · any active member reads the org's meetings and reschedules one;
--   · created_by is pinned at insert;
--   · another org sees nothing and cannot write in;
--   · the row never deletes — archived_at is the only way off the list;
--   · a pending member sees nothing.

reset role;

insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by)
values ('b0000000-0000-4000-8000-000000000101',
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ برنامه‌ریزی', '2099-01-01T09:00:00Z', 'online',
        '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0145 policy tests run under a non-bypass product role');

-- ─── bob, an ordinary MEMBER of org A ────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.ok(
  (select count(*) from echo.meeting) = 1,
  '0145: a member reads the org''s meetings');

update echo.meeting set scheduled_at = '2099-02-01T10:00:00Z'
 where id = 'b0000000-0000-4000-8000-000000000101';
select t.ok(
  (select scheduled_at = '2099-02-01T10:00:00Z'::timestamptz from echo.meeting
    where id = 'b0000000-0000-4000-8000-000000000101'),
  '0145: a member reschedules a meeting they did not create — the plan is shared');

select t.denied(
  $$insert into echo.meeting (org_id, title, scheduled_at, created_by)
    values ('0a000000-0000-4000-8000-00000000000a', 'x', now(),
            '01000000-0000-4000-8000-000000000001')$$,
  '0145: created_by cannot be supplied as someone else');

/* 0148 REVERSED 0145's no-delete rule with an argument: a meeting is a
   PLAN, not a record. The load-bearing half is what the delete cannot
   reach — the call it produced is a separate row with its own ladder. */
insert into echo.call (id, org_id, owner_id, title, status, source, scope, language)
values ('c0000000-0000-4000-8000-0000000000c1',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        'رکورد جلسه', 'ready', 'web', 'private', 'fa');
update echo.meeting set call_id = 'c0000000-0000-4000-8000-0000000000c1'
 where id = 'b0000000-0000-4000-8000-000000000101';

delete from echo.meeting where id = 'b0000000-0000-4000-8000-000000000101';
select t.ok(
  not exists (select 1 from echo.meeting
               where id = 'b0000000-0000-4000-8000-000000000101'),
  '0148: a member deletes a meeting — the plan is theirs to drop');
select t.ok(
  exists (select 1 from echo.call
           where id = 'c0000000-0000-4000-8000-0000000000c1'),
  '0148: deleting the PLAN leaves the RECORD standing — nothing cascades from a meeting');

-- a fresh row for the checks below (the one above is gone by design)
insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by)
values ('b0000000-0000-4000-8000-000000000102',
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ دوم', '2099-03-01T09:00:00Z', 'online',
        '02000000-0000-4000-8000-000000000002');

-- the mode vocabulary is a constraint, not a convention
select t.denied(
  $$update echo.meeting set mode = 'telepathy'
     where id = 'b0000000-0000-4000-8000-000000000102'$$,
  '0145: a holding mode outside the closed set is refused by the table itself');

-- ─── erin, in ANOTHER ORG ────────────────────────────────────────────────
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);

select t.ok(
  (select count(*) from echo.meeting) = 0,
  '0145: another org sees none of org A''s meetings');

select t.denied(
  $$insert into echo.meeting (org_id, title, scheduled_at, created_by)
    values ('0a000000-0000-4000-8000-00000000000a', 'x', now(),
            '05000000-0000-4000-8000-000000000005')$$,
  '0145: a stranger cannot write into org A''s plan');

-- ─── dan, PENDING in org A ───────────────────────────────────────────────
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true);
select t.ok(
  (select count(*) from echo.meeting) = 0,
  '0145: a pending member sees no meetings — active status is part of the wall');
