-- db/0197 + 0198 — an invitation that was answered does not block the next
-- one; withdrawing stays with the sender.
--
-- 0189's all-states unique made «دعوت همه» answer `invited: 0` forever for
-- anybody who had ever declined a room, with no error to see. 0197 replaced it
-- with ONE live invitation per person per target. 0197 also widened withdraw
-- to every admin — and 0198 took that back the same hour: 0189's read policy
-- admits the invitee and the inviter alone, by design, so a wider DELETE
-- policy was a permission nobody could exercise. Walked here: the re-invite,
-- the one-live rule, a member refused, another admin refused (and unable to
-- see it), the sender allowed.
--
--   alice  owner,  org A   01000000-0000-4000-8000-000000000001
--   dave   admin,  org A   06000000-0000-4000-8000-000000000006
--   bob    member, org A   02000000-0000-4000-8000-000000000002
--   carol  member, org A   03000000-0000-4000-8000-000000000003

reset role;

insert into echo.chat_channel (id, org_id, name, created_by) values
  ('b1000000-0000-4000-8000-000000000210', '0a000000-0000-4000-8000-00000000000a',
   'اتاق ۱۱۱', '01000000-0000-4000-8000-000000000001');

-- bob was invited once and declined — a fact that stays
insert into echo.join_invite (id, org_id, kind, target_id, invitee_id, invited_by, state, responded_at) values
  ('b1000000-0000-4000-8000-000000000211', '0a000000-0000-4000-8000-00000000000a',
   'chat_channel', 'b1000000-0000-4000-8000-000000000210',
   '02000000-0000-4000-8000-000000000002', '01000000-0000-4000-8000-000000000001',
   'declined', now());

-- ── a fresh invitation after a decline: allowed, as alice, through the policy ──
select set_config('role', 'echo_app', true);
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

insert into echo.join_invite (id, org_id, kind, target_id, invitee_id, invited_by) values
  ('b1000000-0000-4000-8000-000000000212', '0a000000-0000-4000-8000-00000000000a',
   'chat_channel', 'b1000000-0000-4000-8000-000000000210',
   '02000000-0000-4000-8000-000000000002', '01000000-0000-4000-8000-000000000001');

reset role;
select t.ok(
  (select count(*) from echo.join_invite
    where target_id = 'b1000000-0000-4000-8000-000000000210'
      and invitee_id = '02000000-0000-4000-8000-000000000002') = 2,
  'a declined invitation and a new pending one coexist');
select t.ok(
  (select state from echo.join_invite where id = 'b1000000-0000-4000-8000-000000000211') = 'declined',
  'the decline stays on record');

-- ── still ONE live invitation per person per target ────────────────────────
select t.denied(
  $$insert into echo.join_invite (org_id, kind, target_id, invitee_id, invited_by) values
    ('0a000000-0000-4000-8000-00000000000a', 'chat_channel', 'b1000000-0000-4000-8000-000000000210',
     '02000000-0000-4000-8000-000000000002', '01000000-0000-4000-8000-000000000001')$$,
  'a second PENDING invitation for the same person and room is refused');

-- ── a member may not withdraw somebody else's invitation ───────────────────
select set_config('role', 'echo_app', true);
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.writes_nothing(
  $$delete from echo.join_invite where id = 'b1000000-0000-4000-8000-000000000212'$$,
  'carol, a member, cannot withdraw alice''s invitation');
reset role;
select t.ok(
  exists (select 1 from echo.join_invite where id = 'b1000000-0000-4000-8000-000000000212'),
  'the invitation is still there after the member''s attempt');

-- ── another ADMIN may not either — 0189's design, restored by 0198 ─────────
select set_config('role', 'echo_app', true);
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
select t.ok(
  not exists (select 1 from echo.join_invite where id = 'b1000000-0000-4000-8000-000000000212'),
  'dave, an admin who did not send it, cannot even see alice''s invitation');
select t.writes_nothing(
  $$delete from echo.join_invite where id = 'b1000000-0000-4000-8000-000000000212'$$,
  'dave, an admin who did not send it, cannot withdraw it');
reset role;

-- ── the SENDER may ─────────────────────────────────────────────────────────
select set_config('role', 'echo_app', true);
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
delete from echo.join_invite where id = 'b1000000-0000-4000-8000-000000000212';
reset role;
select t.ok(
  not exists (select 1 from echo.join_invite where id = 'b1000000-0000-4000-8000-000000000212'),
  'alice, who sent it, withdrew it');

-- ── the control: the partial unique index is what carries the rule ─────────
select t.ok(
  exists (select 1 from pg_indexes where schemaname = 'echo' and tablename = 'join_invite'
             and indexname = 'join_invite_one_pending' and indexdef like '%WHERE (state = %pending%'),
  'the one-live-invitation rule is a partial unique index on pending rows');

delete from echo.join_invite where target_id = 'b1000000-0000-4000-8000-000000000210';
delete from echo.chat_channel where id = 'b1000000-0000-4000-8000-000000000210';
