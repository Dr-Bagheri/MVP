-- db/0195 — a SET NULL names its column.
--
-- Two halves, standing:
--
-- THE CLASS: no composite foreign key in echo whose delete action is SET NULL
-- may omit its column list when the key holds a NOT NULL column — 0188's
-- lesson ("the cascade applies to the WHOLE KEY") as a query over the
-- catalogue rather than a sentence four migrations later forgot. The control
-- is the part that makes it a test: a table pair with exactly that constraint
-- is STAGED, the query must find it, and then it is dropped. A query that
-- reports "none" about a schema it cannot see into would pass here forever;
-- the staged offender is the one question it must answer YES to.
--
-- THE ORDINARY PATH: a call with a meeting and a task pointing at it is
-- deleted — the 30-day purge's own statement — and both must survive with
-- their org intact and their pointers cleared. Owner altitude, as the purge
-- runs (`echo_app` holds no DELETE on echo.call, and that is right).
--
--   org A  0a000000-0000-4000-8000-00000000000a
--   alice  01000000-0000-4000-8000-000000000001  owner, org A
--   bob    02000000-0000-4000-8000-000000000002  member, org A

reset role;

-- ── the class is empty ─────────────────────────────────────────────────────
do $t$
declare
  v_bad text;
begin
  select string_agg(conrelid::regclass::text || '.' || conname, ', ' order by conname)
    into v_bad
    from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'echo'::regnamespace
     and c.confdeltype = 'n'
     and array_length(c.conkey, 1) > 1
     and coalesce(array_length(c.confdelsetcols, 1), 0) = 0
     and exists (
       select 1 from pg_attribute a
        where a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attnotnull
     );
  perform t.ok(v_bad is null,
    'no composite SET NULL foreign key in echo omits its column list over a NOT NULL column'
    || coalesce(' — offenders: ' || v_bad, ''));
end $t$;

-- ── THE CONTROL: the query finds a staged offender ─────────────────────────
create table echo.t109_parent (id uuid primary key, org_id uuid not null, unique (id, org_id));
create table echo.t109_child (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null,
  ref_id  uuid,
  constraint t109_bare_set_null
    foreign key (ref_id, org_id) references echo.t109_parent (id, org_id)
    on delete set null
);
do $t$
declare
  v_found int;
begin
  select count(*) into v_found
    from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'echo'::regnamespace
     and c.confdeltype = 'n'
     and array_length(c.conkey, 1) > 1
     and coalesce(array_length(c.confdelsetcols, 1), 0) = 0
     and c.conname = 't109_bare_set_null'
     and exists (
       select 1 from pg_attribute a
        where a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attnotnull
     );
  perform t.ok(v_found = 1, 'the control: a staged bare composite SET NULL is found by the class query');
end $t$;
drop table echo.t109_child;
drop table echo.t109_parent;

-- ── the ordinary path, attempted ───────────────────────────────────────────
insert into echo.call (id, org_id, owner_id, title, scope, status) values
  ('c9000000-0000-4000-8000-000000000109', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'رکورد ۱۰۹', 'private', 'ready');

insert into echo.meeting (id, org_id, title, scheduled_at, call_id, created_by) values
  ('a9000000-0000-4000-8000-000000000109', '0a000000-0000-4000-8000-00000000000a',
   'جلسهٔ ۱۰۹', now(), 'c9000000-0000-4000-8000-000000000109',
   '02000000-0000-4000-8000-000000000002');

insert into echo.task_column (id, org_id, name, tone, position, created_by) values
  ('a9000000-0000-4000-8000-0000000001e9', '0a000000-0000-4000-8000-00000000000a',
   'ستون ۱۰۹', 'grey', 1090, '01000000-0000-4000-8000-000000000001');

insert into echo.task (id, org_id, column_id, title, call_id, created_by) values
  ('a9000000-0000-4000-8000-0000000000f9', '0a000000-0000-4000-8000-00000000000a',
   'a9000000-0000-4000-8000-0000000001e9', 'کار ۱۰۹',
   'c9000000-0000-4000-8000-000000000109', '02000000-0000-4000-8000-000000000002');

/* the subject exists BEFORE the delete — a probe with nothing to delete
   passes every assertion below for the wrong reason */
select t.ok(
  (select count(*) from echo.meeting where call_id = 'c9000000-0000-4000-8000-000000000109') = 1
  and (select count(*) from echo.task where call_id = 'c9000000-0000-4000-8000-000000000109') = 1,
  'the call has a meeting and a task pointing at it before the delete');

delete from echo.call where id = 'c9000000-0000-4000-8000-000000000109';

select t.ok(
  (select org_id from echo.meeting where id = 'a9000000-0000-4000-8000-000000000109')
    = '0a000000-0000-4000-8000-00000000000a',
  'deleting the call kept the meeting with its org intact');
select t.ok(
  (select call_id from echo.meeting where id = 'a9000000-0000-4000-8000-000000000109') is null,
  'deleting the call cleared the meeting''s pointer');
select t.ok(
  (select org_id from echo.task where id = 'a9000000-0000-4000-8000-0000000000f9')
    = '0a000000-0000-4000-8000-00000000000a',
  'deleting the call kept the task with its org intact');
select t.ok(
  (select call_id from echo.task where id = 'a9000000-0000-4000-8000-0000000000f9') is null,
  'deleting the call cleared the task''s pointer');

delete from echo.task where id = 'a9000000-0000-4000-8000-0000000000f9';
delete from echo.task_column where id = 'a9000000-0000-4000-8000-0000000001e9';
delete from echo.meeting where id = 'a9000000-0000-4000-8000-000000000109';
