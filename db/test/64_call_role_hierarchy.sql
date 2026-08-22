-- 0077: record actions follow the role hierarchy — the WHOLE matrix, walked
-- (rule 7's authorization-matrix corollary: asserting the privileged path
-- and the refused path leaves the ordinary path unproven).
--
-- The rule under test, in one sentence: you may act on someone else's
-- record only if your role strictly outranks its owner's (owner > admin >
-- member), and then you may do everything they could; peers are walled from
-- each other in both directions, and rank never reaches up.

reset role;

-- ── self-seeded second admin, so the peer wall has a real pair (rule 9) ───
insert into auth.users (id, email) values
  ('08000000-0000-4000-8000-000000000008', 'peer-admin@example.com')
on conflict (id) do nothing;
insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at)
values ('08000000-0000-4000-8000-000000000008', '0a000000-0000-4000-8000-00000000000a',
        'peer-admin@example.com', 'ادمین همتا', 'admin', 'active', now())
on conflict (id) do nothing;

set local role echo_app;

-- ── self-seeded calls: one per tier, org-scoped so everyone can SEE them ──
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
insert into echo.call (id, org_id, owner_id, title, scope, status) values
  ('64000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   '01000000-0000-4000-8000-000000000001', 'رکورد مالک', 'org', 'ready');
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
insert into echo.call (id, org_id, owner_id, title, scope, status) values
  ('64000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
   '06000000-0000-4000-8000-000000000006', 'رکورد ادمین', 'org', 'ready');
select set_config('echo.actor_id', '08000000-0000-4000-8000-000000000008', true);
insert into echo.call (id, org_id, owner_id, title, scope, status) values
  ('64000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a',
   '08000000-0000-4000-8000-000000000008', 'رکورد ادمین دوم', 'org', 'ready');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
insert into echo.call (id, org_id, owner_id, title, scope, status) values
  ('64000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'رکورد عضو', 'org', 'ready');

-- ── the rank helper itself, both directions and the cross-org null ────────
select t.ok(echo.actor_outranks('06000000-0000-4000-8000-000000000006') = false,
  'a member outranks no admin');
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
select t.ok(echo.actor_outranks('02000000-0000-4000-8000-000000000002'),
  'an admin outranks a member');
select t.ok(echo.actor_outranks('08000000-0000-4000-8000-000000000008') = false,
  'an admin does not outrank a fellow admin — peers are walled');
select t.ok(echo.actor_outranks('01000000-0000-4000-8000-000000000001') = false,
  'and never the owner — rank does not reach up');
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.ok(echo.actor_outranks('02000000-0000-4000-8000-000000000002') = false,
  'rank is meaningless across the org wall — another org''s owner outranks nobody here');

-- ── MEMBER: own record only ───────────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.call set title = 'رکورد عضو — ویرایش'
 where id = '64000000-0000-4000-8000-000000000004';
select t.ok(
  (select title from echo.call where id = '64000000-0000-4000-8000-000000000004')
    = 'رکورد عضو — ویرایش',
  'a member edits their own record — the ordinary path is the product');
select t.denied(
  $$update echo.call set title = 'دستکاری'
     where id = '64000000-0000-4000-8000-000000000002'$$,
  'a member cannot edit an admin''s record');
select t.denied(
  $$select echo.soft_delete_call('64000000-0000-4000-8000-000000000001')$$,
  'nor delete the owner''s');

-- ── ADMIN: self and members; never peers, never the owner ─────────────────
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
update echo.call set title = 'رکورد عضو — ویرایش ادمین'
 where id = '64000000-0000-4000-8000-000000000004';
select t.ok(
  (select title from echo.call where id = '64000000-0000-4000-8000-000000000004')
    = 'رکورد عضو — ویرایش ادمین',
  'an admin edits a member''s record (the case the user hit, fixed)');
update echo.call set archived_at = now()
 where id = '64000000-0000-4000-8000-000000000004';
select t.ok(
  (select archived_at is not null from echo.call
    where id = '64000000-0000-4000-8000-000000000004'),
  'and archives it');
update echo.call set archived_at = null
 where id = '64000000-0000-4000-8000-000000000004';
select t.denied(
  $$update echo.call set title = 'دستکاری'
     where id = '64000000-0000-4000-8000-000000000003'$$,
  'an admin cannot edit a fellow admin''s record');
select t.denied(
  $$update echo.call set archived_at = now()
     where id = '64000000-0000-4000-8000-000000000001'$$,
  'an admin cannot archive the owner''s record — archive follows the same rule as edit now');
select t.denied(
  $$select echo.soft_delete_call('64000000-0000-4000-8000-000000000003')$$,
  'nor delete a peer''s');
select t.ok(echo.soft_delete_call('64000000-0000-4000-8000-000000000004'),
  'an admin deletes a member''s record');
select t.ok(echo.restore_call('64000000-0000-4000-8000-000000000004'),
  'and restores it');
select t.ok(echo.soft_delete_call('64000000-0000-4000-8000-000000000002'),
  'an admin deletes their own record');
select t.ok(echo.restore_call('64000000-0000-4000-8000-000000000002'),
  'and may restore their own (2026-08-13 ruling: restore is admin-and-above)');

-- ── OWNER: everyone's ─────────────────────────────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
update echo.call set title = 'رکورد ادمین — ویرایش مالک'
 where id = '64000000-0000-4000-8000-000000000002';
select t.ok(
  (select title from echo.call where id = '64000000-0000-4000-8000-000000000002')
    = 'رکورد ادمین — ویرایش مالک',
  'the owner edits an admin''s record');
select t.ok(echo.soft_delete_call('64000000-0000-4000-8000-000000000003'),
  'the owner deletes an admin''s record');
select t.ok(echo.restore_call('64000000-0000-4000-8000-000000000003'),
  'and restores it');

-- ── restore stays above the member line ───────────────────────────────────
select t.ok(echo.soft_delete_call('64000000-0000-4000-8000-000000000004'),
  'owner deletes the member''s record for the restore check');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select echo.restore_call('64000000-0000-4000-8000-000000000004')$$,
  'a member still cannot restore, even their own — the 2026-08-13 ruling stands');
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(echo.restore_call('64000000-0000-4000-8000-000000000004'),
  'the owner restores it');

-- ── sweep the seeds so no later count inherits them (B3''s count trap) ─────
reset role;
delete from echo.call where id in (
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000003',
  '64000000-0000-4000-8000-000000000004');
