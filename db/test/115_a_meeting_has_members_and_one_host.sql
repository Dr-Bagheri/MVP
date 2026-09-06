-- 0202: a meeting's MEMBERS, and the host's own recording.
--
-- Two rules, and the matrix is walked whole for each (rule 7's ordinary-path
-- corollary): who may add, who may see, who may stamp their own attendance —
-- and who may move `meeting.call_id`, which is the bug this migration was
-- written for ("all that come to the meeting have the ability to get it for
-- themselves as well and it's a bug").

reset role;

-- alice (01, owner) hosts; bob (02) and carol (03) are members of the org
insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by)
values ('b0000000-0000-4000-8000-000000000202',
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ میزبان', '2099-02-02T09:00:00Z', 'online',
        '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0202 policy test runs under a non-bypass product role');

-- ── the host puts two colleagues on the meeting ─────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
insert into echo.meeting_attendee (meeting_id, user_id, org_id, added_by)
values ('b0000000-0000-4000-8000-000000000202', '02000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001'),
       ('b0000000-0000-4000-8000-000000000202', '03000000-0000-4000-8000-000000000003',
        '0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001');
select t.ok(
  (select count(*) from echo.meeting_attendee
    where meeting_id = 'b0000000-0000-4000-8000-000000000202') = 2,
  'the host adds members to the meeting');

-- a fact must not be supplyable: added_by is the actor, never an argument
select t.denied(
  $$insert into echo.meeting_attendee (meeting_id, user_id, org_id, added_by)
    values ('b0000000-0000-4000-8000-000000000202', '06000000-0000-4000-8000-000000000006',
            '0a000000-0000-4000-8000-00000000000a', '02000000-0000-4000-8000-000000000002')$$,
  'added_by cannot be supplied as somebody else');

-- ── who is coming is part of the meeting, and the meeting is org-readable ──
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  (select count(*) from echo.meeting_attendee
    where meeting_id = 'b0000000-0000-4000-8000-000000000202') = 2,
  'a colleague reads who is coming');

-- ── attendance is YOUR OWN ──────────────────────────────────────────────
update echo.meeting_attendee set attended_at = now()
 where meeting_id = 'b0000000-0000-4000-8000-000000000202'
   and user_id = '03000000-0000-4000-8000-000000000003';
select t.ok(
  (select attended_at from echo.meeting_attendee
    where meeting_id = 'b0000000-0000-4000-8000-000000000202'
      and user_id = '03000000-0000-4000-8000-000000000003') is not null,
  'a member stamps their own attendance');
/* an UPDATE walled by a policy's USING clause is not refused — it matches
   zero rows and succeeds (the 0186 lesson), so the assertion is on the
   RECORD rather than on the statement */
update echo.meeting_attendee set attended_at = now()
 where meeting_id = 'b0000000-0000-4000-8000-000000000202'
   and user_id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select attended_at from echo.meeting_attendee
    where meeting_id = 'b0000000-0000-4000-8000-000000000202'
      and user_id = '02000000-0000-4000-8000-000000000002') is null,
  'nobody stamps somebody else into the room');

-- ── the recording is the host's ─────────────────────────────────────────
reset role;
insert into echo.call (id, org_id, owner_id, title, status, source, scope, language)
values ('ca000000-0000-4000-8000-000000000202', '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002', 'ضبط جلسه', 'ready', 'upload', 'org', 'fa');
set local role echo_app;

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, not the host
select t.denied(
  $$update echo.meeting set call_id = 'ca000000-0000-4000-8000-000000000202'
     where id = 'b0000000-0000-4000-8000-000000000202'$$,
  'a member who is not the host cannot hand the meeting a recording');

/* the ORDINARY path is the product: the same write, by the host, works — and
   without this the refusal above is satisfied by a trigger that refuses
   everybody (the authorization-matrix corollary) */
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, the host
update echo.meeting set call_id = 'ca000000-0000-4000-8000-000000000202'
 where id = 'b0000000-0000-4000-8000-000000000202';
select t.ok(
  (select call_id from echo.meeting where id = 'b0000000-0000-4000-8000-000000000202')
    = 'ca000000-0000-4000-8000-000000000202',
  'the host links the record their own recording produced');

-- and everything else about the meeting stays org-editable (0145)
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
update echo.meeting set location = 'اتاق ۲' where id = 'b0000000-0000-4000-8000-000000000202';
select t.ok(
  (select location from echo.meeting where id = 'b0000000-0000-4000-8000-000000000202') = 'اتاق ۲',
  'a colleague still reschedules and edits the meeting — only the recording is the host''s');

-- ── the agent role reads and never writes ───────────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select count(*) from echo.meeting_attendee
    where meeting_id = 'b0000000-0000-4000-8000-000000000202') = 2,
  'the agent reads the roster like any member');
select t.denied(
  $$insert into echo.meeting_attendee (meeting_id, user_id, org_id, added_by)
    values ('b0000000-0000-4000-8000-000000000202', '06000000-0000-4000-8000-000000000006',
            '0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001')$$,
  'the agent role cannot put anybody on a meeting');

reset role;
