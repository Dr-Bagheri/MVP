-- db/0204 — echo.meeting_take_status: the one bit a meeting reader needs
-- that call_read will not give them.
--
-- The matrix:
--   · a colleague who CANNOT read the call still learns the take is running;
--   · …and learns when it stops, which is the whole point (the poll that
--     closes the session for everybody hangs off this word);
--   · a meeting with no linked call answers NULL, and that NULL is not the
--     same nothing as "still recording" — the caller has call_id to tell
--     them apart;
--   · another org's meeting answers NULL;
--   · a PENDING member answers NULL — the door restates meeting_read's
--     terms rather than trusting the caller's context;
--   · and the door hands back nothing else about the call.

reset role;

-- ── the meeting, its take, and a colleague who is not the owner ──────────
-- alice hosts and owns the recording; bob is an ordinary member of the same
-- org who may read the meeting and may NOT read a private call.
insert into echo.call (id, org_id, owner_id, title, status, scope)
values ('c1160000-0000-4000-8000-000000000116',
        '0a000000-0000-4000-8000-00000000000a',
        '01000000-0000-4000-8000-000000000001',
        'take under test', 'recording', 'private');

insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by, call_id)
values ('b1160000-0000-4000-8000-000000000116',
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ در حال ضبط', '2099-03-01T09:00:00Z', 'online',
        '01000000-0000-4000-8000-000000000001',
        'c1160000-0000-4000-8000-000000000116');

insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by)
values ('b1160000-0000-4000-8000-000000000117',
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ بدون ضبط', '2099-03-01T11:00:00Z', 'online',
        '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0204 door tests run under a non-bypass product role');

-- ─── bob, an ordinary MEMBER who is not the recording's owner ────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

-- THE CONTROL, and the reason this function exists. If bob could read the
-- call, core's existing `left join echo.call` would already answer him and
-- the door would be a second spelling of a fact he already had.
select t.ok(
  (select count(*) from echo.call
    where id = 'c1160000-0000-4000-8000-000000000116') = 0,
  '0204 control: a colleague cannot read the private call — which is why the join could not answer him');

select t.ok(
  (select count(*) from echo.meeting
    where id = 'b1160000-0000-4000-8000-000000000116') = 1,
  '0204: …but he can read the meeting');

select t.ok(
  echo.meeting_take_status('b1160000-0000-4000-8000-000000000116') = 'recording',
  '0204: a colleague learns the take is STILL RUNNING — the session must not close on him yet');

select t.ok(
  echo.meeting_take_status('b1160000-0000-4000-8000-000000000117') is null,
  '0204: a meeting with no linked call answers null — no take, not a running one');

select t.ok(
  echo.meeting_take_status('b0000000-0000-4000-8000-000000000ff0') is null,
  '0204: a meeting that does not exist answers null, the same as one he may not read');

-- ─── the take ENDS — the transition the whole feature hangs on ───────────
reset role;
update echo.call set status = 'processing'
 where id = 'c1160000-0000-4000-8000-000000000116';

set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  echo.meeting_take_status('b1160000-0000-4000-8000-000000000116') = 'processing',
  '0204: and he learns when it stops — without this the poll can only guess');

-- ─── the host reads the same word ────────────────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  echo.meeting_take_status('b1160000-0000-4000-8000-000000000116') = 'processing',
  '0204: the host reads the same word as the colleague — one fact, one spelling');

-- ─── another org sees nothing ────────────────────────────────────────────
-- erin (05) is org B's owner: an ADMIN elsewhere, which is the harder case —
-- admin-ness must not travel across the org wall.
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.ok(
  echo.meeting_take_status('b1160000-0000-4000-8000-000000000116') is null,
  '0204: another org''s member gets nothing — the door restates the org wall');

-- ─── a PENDING member sees nothing ───────────────────────────────────────
-- dan (04) is pending. A definer function sees everything, so "active" has
-- to be asked here or it is not asked at all.
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true);
select t.ok(
  echo.meeting_take_status('b1160000-0000-4000-8000-000000000116') is null,
  '0204: a pending member gets nothing — actor_is_active is asked inside the door');

-- ─── the door hands back ONE word and nothing else ───────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  (select pg_catalog.pg_get_function_result(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'echo' and p.proname = 'meeting_take_status') = 'text',
  '0204: the door returns TEXT — a security surface that is a SHAPE cannot be widened by forgetting a filter');

reset role;
