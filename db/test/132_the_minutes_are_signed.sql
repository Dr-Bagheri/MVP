-- db/0229 — the minutes are SIGNED by the people in the room.
--
-- THE WHOLE MATRIX, both ways (rule 7's ordinary-path corollary): who may
-- keep a signature on file and who may read it; who may place one on a
-- meeting, who may not, and who may take whose back. Asserted here rather
-- than in 0229's own self-checks because those run once, on the day the
-- migration is applied, and would have to sign a real meeting as a real
-- person to catch a refusal.
--
--   alice 01 OWNER, hosts the meeting · bob 02 member, ON the roster ·
--   carol 03 member, NOT on it · dave 06 admin, not on it · dan 04 PENDING ·
--   erin 05 another organisation

reset role;

-- alice hosts; bob is on the roster; nobody else is
insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by)
values ('b0000000-0000-4000-8000-000000000229',
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ امضاشده', '2099-02-02T09:00:00Z', 'in_person',
        '01000000-0000-4000-8000-000000000001');
insert into echo.meeting_attendee (meeting_id, user_id, org_id, added_by)
values ('b0000000-0000-4000-8000-000000000229', '02000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0229 tests run under a non-bypass product role');

-- ─── A SIGNATURE ON FILE IS ITS OWNER'S, IN EVERY DIRECTION ────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
insert into echo.user_signature (user_id, org_id, bytes, mime)
values ('02000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
        '\x89504e470d0a1a0a'::bytea, 'image/png');
select t.ok(
  (select count(*) from echo.user_signature) = 1,
  '0229: a person keeps their own signature on file');

-- a fact must not be supplyable: a row about somebody else is refused by
-- the policy (WITH CHECK raises), not filtered
select t.raises(
  $$insert into echo.user_signature (user_id, org_id, bytes, mime)
    values ('03000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a',
            '\x89504e470d0a1a0a'::bytea, 'image/png')$$,
  '42501', '0229: nobody files a signature in a colleague''s name');

-- THE LIST and THE CEILING, tried rather than trusted
select t.raises(
  $$update echo.user_signature set mime = 'image/svg+xml'
     where user_id = '02000000-0000-4000-8000-000000000002'$$,
  '23514', '0229: an SVG is not a signature');
select t.raises(
  $$update echo.user_signature set bytes = lpad('', 1048577, 'x')::bytea
     where user_id = '02000000-0000-4000-8000-000000000002'$$,
  '23514', '0229: a signature past a megabyte is refused');

-- NOBODY ELSE READS IT — not a colleague, not an admin, not the owner. The
-- three are asserted separately because "an admin sees everything" is the
-- reflex this table exists to refuse.
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok((select count(*) from echo.user_signature) = 0,
  '0229: a colleague cannot read a person''s signature on file');
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, admin
select t.ok((select count(*) from echo.user_signature) = 0,
  '0229: an admin cannot read a colleague''s signature on file');
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner
select t.ok((select count(*) from echo.user_signature) = 0,
  '0229: the org owner cannot read a colleague''s signature on file');
-- …and cannot take it away either: the policy filters, so the assertion is
-- on the row surviving, read back at owner altitude
select t.writes_nothing(
  $$delete from echo.user_signature where user_id = '02000000-0000-4000-8000-000000000002'$$,
  '0229: the org owner cannot remove a colleague''s signature on file');

-- ─── PLACING A SIGNATURE ON A MEETING ──────────────────────────────────────
-- bob, ON the roster: the ordinary path, and the product
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
insert into echo.meeting_signature (meeting_id, user_id, org_id, bytes, mime)
select 'b0000000-0000-4000-8000-000000000229', user_id, org_id, bytes, mime
  from echo.user_signature where user_id = echo.actor_id();
select t.ok(
  (select count(*) from echo.meeting_signature
    where meeting_id = 'b0000000-0000-4000-8000-000000000229'
      and user_id = '02000000-0000-4000-8000-000000000002') = 1,
  '0229: a person on the roster signs the meeting with the signature on file');

-- ONCE: a second placing is the primary key refusing, and that is the wall
-- against "signed twice at two times" — re-signing is withdraw-then-sign
select t.raises(
  $$insert into echo.meeting_signature (meeting_id, user_id, org_id, bytes, mime)
    values ('b0000000-0000-4000-8000-000000000229', '02000000-0000-4000-8000-000000000002',
            '0a000000-0000-4000-8000-00000000000a', '\x89504e470d0a1a0a'::bytea, 'image/png')$$,
  '23505', '0229: a meeting is signed once per person');

-- and NEVER in somebody else's name, even by somebody who is in the room
select t.raises(
  $$insert into echo.meeting_signature (meeting_id, user_id, org_id, bytes, mime)
    values ('b0000000-0000-4000-8000-000000000229', '03000000-0000-4000-8000-000000000003',
            '0a000000-0000-4000-8000-00000000000a', '\x89504e470d0a1a0a'::bytea, 'image/png')$$,
  '42501', '0229: nobody signs a meeting in a colleague''s name');

-- carol, NOT on the roster: refused by the policy, however she came by a picture
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.raises(
  $$insert into echo.meeting_signature (meeting_id, user_id, org_id, bytes, mime)
    values ('b0000000-0000-4000-8000-000000000229', '03000000-0000-4000-8000-000000000003',
            '0a000000-0000-4000-8000-00000000000a', '\x89504e470d0a1a0a'::bytea, 'image/png')$$,
  '42501', '0229: a colleague who was not in the room cannot sign its minutes');
-- an ADMIN who was not in the room, likewise — being an admin is not being there
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave
select t.raises(
  $$insert into echo.meeting_signature (meeting_id, user_id, org_id, bytes, mime)
    values ('b0000000-0000-4000-8000-000000000229', '06000000-0000-4000-8000-000000000006',
            '0a000000-0000-4000-8000-00000000000a', '\x89504e470d0a1a0a'::bytea, 'image/png')$$,
  '42501', '0229: an admin who was not in the room cannot sign its minutes');

-- THE HOST signs too: they are on the meeting by being its author, without
-- a roster row (nobody invites themselves — the third surface to learn it)
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
insert into echo.meeting_signature (meeting_id, user_id, org_id, bytes, mime)
values ('b0000000-0000-4000-8000-000000000229', '01000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a', '\xffd8ffe0'::bytea, 'image/jpeg');
select t.ok(
  (select count(*) from echo.meeting_signature
    where meeting_id = 'b0000000-0000-4000-8000-000000000229') = 2,
  '0229: the host signs without a roster row');

-- ─── WHO READS THE PLACED SIGNATURES: everybody who reads the meeting ──────
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  (select count(*) from echo.meeting_signature
    where meeting_id = 'b0000000-0000-4000-8000-000000000229') = 2,
  '0229: a colleague reads who signed — the printed document carries it');
-- the picture itself travels with the row: this is what the host prints
select t.ok(
  (select octet_length(bytes) from echo.meeting_signature
    where meeting_id = 'b0000000-0000-4000-8000-000000000229'
      and user_id = '02000000-0000-4000-8000-000000000002') = 8,
  '0229: the placed signature carries the picture');
-- a PENDING colleague reads nothing (actor_is_active is the gate)
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true); -- dan
select t.ok((select count(*) from echo.meeting_signature) = 0,
  '0229: a pending member reads no signatures');
-- and another organisation reads nothing
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin
select t.ok((select count(*) from echo.meeting_signature) = 0,
  '0229: another organisation reads no signatures');

-- ─── A SNAPSHOT, not a pointer ────────────────────────────────────────────
-- bob replaces the signature on file; the one already placed does not move
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
update echo.user_signature set bytes = '\x89504e470d0a1a0a00'::bytea
 where user_id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select octet_length(bytes) from echo.meeting_signature
    where meeting_id = 'b0000000-0000-4000-8000-000000000229'
      and user_id = '02000000-0000-4000-8000-000000000002') = 8,
  '0229: a new signature on file does not re-sign the meetings already signed');

-- ─── WITHDRAWING: your own, and nobody else's ─────────────────────────────
-- the host cannot strike a colleague's signature (the policy filters — the
-- assertion is on the row surviving)
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
select t.writes_nothing(
  $$delete from echo.meeting_signature
     where meeting_id = 'b0000000-0000-4000-8000-000000000229'
       and user_id = '02000000-0000-4000-8000-000000000002'$$,
  '0229: the host cannot withdraw a colleague''s signature');
-- nor edit one in place: the GRANT is the wall, for everybody, which is why
-- this one is `denied` rather than `writes_nothing`
select t.denied(
  $$update echo.meeting_signature set bytes = '\x00'::bytea
     where meeting_id = 'b0000000-0000-4000-8000-000000000229'$$,
  '0229: a placed signature cannot be edited in place by anybody');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
delete from echo.meeting_signature
 where meeting_id = 'b0000000-0000-4000-8000-000000000229'
   and user_id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select count(*) from echo.meeting_signature
    where meeting_id = 'b0000000-0000-4000-8000-000000000229') = 1,
  '0229: a person withdraws their own signature');
select t.ok(
  (select count(*) from echo.user_signature) = 1,
  '0229: withdrawing from a meeting keeps the signature on file');
-- …and signs again, on purpose — the two acts that replace an in-place edit
insert into echo.meeting_signature (meeting_id, user_id, org_id, bytes, mime)
select 'b0000000-0000-4000-8000-000000000229', user_id, org_id, bytes, mime
  from echo.user_signature where user_id = echo.actor_id();
select t.ok(
  (select octet_length(bytes) from echo.meeting_signature
    where meeting_id = 'b0000000-0000-4000-8000-000000000229'
      and user_id = '02000000-0000-4000-8000-000000000002') = 9,
  '0229: signing again places the CURRENT signature on file');

-- ─── THE AGENT HOLDS NOTHING ───────────────────────────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.denied(
  $$select count(*) from echo.meeting_signature$$,
  '0229: the agent role cannot read a placed signature');
select t.denied(
  $$select count(*) from echo.user_signature$$,
  '0229: the agent role cannot read a signature on file');

-- ─── A SIGNATURE DIES WITH ITS MEETING ────────────────────────────────────
reset role;
delete from echo.meeting where id = 'b0000000-0000-4000-8000-000000000229';
select t.ok(
  (select count(*) from echo.meeting_signature
    where meeting_id = 'b0000000-0000-4000-8000-000000000229') = 0,
  '0229: deleting the meeting takes the signatures placed on it');
select t.ok(
  (select count(*) from echo.user_signature
    where user_id = '02000000-0000-4000-8000-000000000002') = 1,
  '0229: …and leaves the signature on file, which was never the meeting''s');

reset role;
