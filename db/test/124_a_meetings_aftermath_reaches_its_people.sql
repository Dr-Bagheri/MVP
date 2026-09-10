-- db/0217 — a meeting's aftermath reaches the people it concerns.
--
-- The migration's self-checks read the STRUCTURE (the kinds, the named
-- set-null, the grant) because a behavioural check inside a migration depends
-- on whatever the database holds on the day. This file SEEDS ITS OWN meeting
-- (rule 9) and walks the whole matrix, because the ordinary path is the
-- product: the roster is told the summary is ready, each owner is told what
-- they owe, the host is told only what they owe, a pending colleague is told
-- nothing, a decision and an unowned action reach nobody's bell, a second
-- delivery adds nothing, a colleague who is not the host is refused, another
-- organisation gets «no such meeting», the WALL behind the door has not moved
-- (echo_app still cannot write into a colleague's inbox directly), the agent
-- has no key, nobody reads anybody else's card, and a deleted meeting leaves
-- its cards standing with the pointer nulled.
--
--   alice  owner,   org A   01…01      dave   admin,  org A   06…06
--   bob    member,  org A   02…02      carol  member, org A   03…03
--   dan    PENDING, org A   04…04      erin   owner,  org B   05…05

reset role;

-- ── the meeting: hosted by bob; carol, dave and (pending) dan on the roster ─
insert into echo.meeting (id, org_id, title, scheduled_at, created_by, mode)
values ('16000000-0000-4000-8000-000000000a01'::uuid,
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ برنامه‌ریزی', now() - interval '1 hour',
        '02000000-0000-4000-8000-000000000002', 'in_person');

insert into echo.meeting_attendee (meeting_id, user_id, org_id, added_by) values
  ('16000000-0000-4000-8000-000000000a01', '03000000-0000-4000-8000-000000000003',
   '0a000000-0000-4000-8000-00000000000a', '02000000-0000-4000-8000-000000000002'),
  ('16000000-0000-4000-8000-000000000a01', '06000000-0000-4000-8000-000000000006',
   '0a000000-0000-4000-8000-00000000000a', '02000000-0000-4000-8000-000000000002'),
  ('16000000-0000-4000-8000-000000000a01', '04000000-0000-4000-8000-000000000004',
   '0a000000-0000-4000-8000-00000000000a', '02000000-0000-4000-8000-000000000002');

-- what the extraction landed: two owned commitments, one for a pending
-- colleague, one owned by nobody, and a decision
insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, owner_id, created_by) values
  ('17000000-0000-4000-8000-000000000b01', '16000000-0000-4000-8000-000000000a01',
   '0a000000-0000-4000-8000-00000000000a', 'action', 'گزارش هزینه‌ها را تا شنبه می‌فرستم', 'ai',
   '03000000-0000-4000-8000-000000000003', '02000000-0000-4000-8000-000000000002'),
  ('17000000-0000-4000-8000-000000000b02', '16000000-0000-4000-8000-000000000a01',
   '0a000000-0000-4000-8000-00000000000a', 'action', 'قرارداد را بازبینی می‌کنم', 'ai',
   '02000000-0000-4000-8000-000000000002', '02000000-0000-4000-8000-000000000002'),
  ('17000000-0000-4000-8000-000000000b03', '16000000-0000-4000-8000-000000000a01',
   '0a000000-0000-4000-8000-00000000000a', 'decision', 'بودجهٔ مهر تصویب شد', 'ai',
   null, '02000000-0000-4000-8000-000000000002'),
  ('17000000-0000-4000-8000-000000000b04', '16000000-0000-4000-8000-000000000a01',
   '0a000000-0000-4000-8000-00000000000a', 'action', 'با تأمین‌کننده تماس می‌گیریم', 'ai',
   null, '02000000-0000-4000-8000-000000000002'),
  ('17000000-0000-4000-8000-000000000b05', '16000000-0000-4000-8000-000000000a01',
   '0a000000-0000-4000-8000-00000000000a', 'action', 'اسلایدها را آماده می‌کنم', 'ai',
   '04000000-0000-4000-8000-000000000004', '02000000-0000-4000-8000-000000000002');

-- ── THE ORDINARY PATH: the host delivers ────────────────────────────────
set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0217 tests run under a non-bypass product role');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, the host
select set_config('echo.actor_org_id', '0a000000-0000-4000-8000-00000000000a', true);

select t.ok(
  echo.deliver_meeting_cards(
    '16000000-0000-4000-8000-000000000a01',
    array['17000000-0000-4000-8000-000000000b01', '17000000-0000-4000-8000-000000000b02',
          '17000000-0000-4000-8000-000000000b03', '17000000-0000-4000-8000-000000000b04',
          '17000000-0000-4000-8000-000000000b05']::uuid[]) = 4,
  '0217: four cards — «ready» for carol and dave, a commitment each for carol and the host');

reset role; -- read at owner altitude: a colleague's inbox is not the host's to see
select t.ok(
  (select count(*) from echo.agent_card
    where owner_id = '03000000-0000-4000-8000-000000000003'
      and meeting_id = '16000000-0000-4000-8000-000000000a01'
      and kind = 'meeting_ready' and title = 'جلسهٔ برنامه‌ریزی' and body = ''
      and from_user_id is null and read_at is null) = 1,
  '0217: carol is told the summary is ready — the meeting''s own title, no sender, unread');
select t.ok(
  (select count(*) from echo.agent_card
    where owner_id = '03000000-0000-4000-8000-000000000003'
      and meeting_id = '16000000-0000-4000-8000-000000000a01'
      and kind = 'meeting_commitment' and body = 'گزارش هزینه‌ها را تا شنبه می‌فرستم') = 1,
  '0217: carol is told what she owes, in the sentence the meeting heard');
select t.ok(
  (select array_agg(kind order by kind) from echo.agent_card
    where owner_id = '06000000-0000-4000-8000-000000000006'
      and meeting_id = '16000000-0000-4000-8000-000000000a01') = array['meeting_ready'],
  '0217: dave, on the roster with no commitment, gets the «ready» card and nothing else');
select t.ok(
  (select array_agg(kind order by kind) from echo.agent_card
    where owner_id = '02000000-0000-4000-8000-000000000002'
      and meeting_id = '16000000-0000-4000-8000-000000000a01') = array['meeting_commitment'],
  '0217: the HOST gets their own commitment and no «ready» card — the brief is theirs already');
select t.ok(
  not exists (select 1 from echo.agent_card
               where owner_id = '04000000-0000-4000-8000-000000000004'),
  '0217: a PENDING colleague on the roster is told nothing');
select t.ok(
  not exists (select 1 from echo.agent_card
               where body in ('بودجهٔ مهر تصویب شد', 'با تأمین‌کننده تماس می‌گیریم')),
  '0217: a decision and an unowned action reach nobody''s bell');

-- ── a second delivery adds nothing (a regenerated summary calls the door again)
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select set_config('echo.actor_org_id', '0a000000-0000-4000-8000-00000000000a', true);
select t.ok(
  echo.deliver_meeting_cards(
    '16000000-0000-4000-8000-000000000a01',
    array['17000000-0000-4000-8000-000000000b01', '17000000-0000-4000-8000-000000000b02']::uuid[]) = 0,
  '0217: delivering again writes nothing');
reset role;
select t.ok(
  (select count(*) from echo.agent_card
    where meeting_id = '16000000-0000-4000-8000-000000000a01') = 4,
  '0217: ...and the four cards are still four');

-- ── THE REFUSALS ─────────────────────────────────────────────────────────
set local role echo_app;
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol, on the roster
select set_config('echo.actor_org_id', '0a000000-0000-4000-8000-00000000000a', true);
select t.raises(
  $$select echo.deliver_meeting_cards('16000000-0000-4000-8000-000000000a01', array[]::uuid[])$$,
  '42501',
  '0217: a colleague who is not the host cannot deliver the meeting''s cards');

select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin, org B
select set_config('echo.actor_org_id', '0b000000-0000-4000-8000-00000000000b', true);
select t.raises(
  $$select echo.deliver_meeting_cards('16000000-0000-4000-8000-000000000a01', array[]::uuid[])$$,
  '22023',
  '0217: another organisation''s meeting is «no such meeting» — the same answer as a meeting that does not exist');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob again
select set_config('echo.actor_org_id', '0a000000-0000-4000-8000-00000000000a', true);
select t.raises(
  $$select echo.deliver_meeting_cards('ffffffff-0000-4000-8000-00000000ffff', array[]::uuid[])$$,
  '22023',
  '0217: ...and a meeting that does not exist says exactly that sentence');

-- ── THE WALL, still standing ─────────────────────────────────────────────
-- The door exists BECAUSE this is refused. If the direct insert ever starts
-- working, the door stops being the only way a card reaches somebody else.
select t.denied(
  $$insert into echo.agent_card (org_id, owner_id, kind, title, meeting_id)
    values ('0a000000-0000-4000-8000-00000000000a',
            '03000000-0000-4000-8000-000000000003', 'meeting_ready', 'direct',
            '16000000-0000-4000-8000-000000000a01')$$,
  '0217: echo_app still cannot write a card into a colleague''s inbox directly');

-- ── nobody reads anybody else's card ─────────────────────────────────────
select t.ok(
  (select count(*) from echo.agent_card
    where meeting_id = '16000000-0000-4000-8000-000000000a01') = 1,
  '0217: the host sees ONE card about the meeting — their own commitment — not the roster''s');
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  (select count(*) from echo.agent_card
    where meeting_id = '16000000-0000-4000-8000-000000000a01') = 2,
  '0217: carol sees her two and nobody else''s');

-- ── and the agent has no key to this door ────────────────────────────────
reset role;
select t.ok(
  not exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     left join pg_roles r on r.oid = a.grantee
    where n.nspname = 'echo' and p.proname = 'deliver_meeting_cards'
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or r.rolname in ('echo_agent', 'echo_purge'))
  ),
  '0217: neither the agent role, the purge role nor PUBLIC can execute the door');

-- ── a deleted meeting leaves its cards standing, pointer nulled ─────────
-- 0188's class: the FK names its column, so the delete nulls meeting_id and
-- never reaches org_id. A version with a bare `set null` would RAISE here.
delete from echo.meeting where id = '16000000-0000-4000-8000-000000000a01';
select t.ok(
  (select count(*) from echo.agent_card
    where title = 'جلسهٔ برنامه‌ریزی' and meeting_id is null
      and org_id = '0a000000-0000-4000-8000-00000000000a') = 4,
  '0217: the meeting is gone and its four cards remain, pointing at nothing');
