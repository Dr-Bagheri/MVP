-- db/0223 — a person arrives into their own workspace (M54).
--
-- The migration's self-checks ran once, on the day it was applied. This file
-- is the standing version: a later migration that rebuilds register_account
-- from a stale body (the 0155 shape), drops the invitation trigger, or widens
-- the kind check would pass every other file in this suite and fail here.
--
-- The matrix, both ways where a wall has two sides:
--   · nothing marked → a PERSONAL workspace, owned, active, un-onboarded,
--     with its agent seats, named after the person;
--   · the founder can see their own workspace under RLS (the ordinary path —
--     without it every refusal below is satisfied by a door that admits
--     nobody);
--   · inviting makes a team, a second invitation changes nothing, and a
--     team never becomes personal again;
--   · an org MARKED as intake still pends arrivals there (managed mode is the
--     switch, and it is intact);
--   · a NAME still joins pending (0082's wall);
--   · a person may write their own onboarding and stamp its end;
--   · the kind is a closed set.

reset role;
insert into auth.users (id, email) values
  ('19000000-0000-4000-8000-000000000119', 'solo-119@example.com'),
  ('19100000-0000-4000-8000-000000000119', 'guided-119@example.com');
-- the fixture marks nothing; say so rather than assume it
select t.ok(
  not exists (select 1 from echo.org where accepts_signups),
  '119: the fixture marks no intake org — the probe runs in B2C mode');

-- ─── the shape is there at all ───────────────────────────────────────────
select t.ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'echo' and table_name = 'org' and column_name = 'kind'),
  '0223: org.kind exists');
select t.ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'echo' and table_name = 'app_user'
             and column_name = 'onboarding_completed_at'),
  '0223: app_user.onboarding_completed_at exists');

-- ─── a bare arrival founds a personal workspace ──────────────────────────
set local role echo_app;
select t.ok(
  (select role::text || '/' || status::text from echo.register_account(
     '19000000-0000-4000-8000-000000000119', 'solo-119@example.com', 'تنها')) = 'owner/active',
  '0223: a bare arrival is the ACTIVE OWNER of what it founded');

reset role;
select t.ok(
  (select o.kind from echo.org o join echo.app_user u on u.org_id = o.id
    where u.id = '19000000-0000-4000-8000-000000000119') = 'personal',
  '0223: the workspace is PERSONAL');
select t.ok(
  (select o.name from echo.org o join echo.app_user u on u.org_id = o.id
    where u.id = '19000000-0000-4000-8000-000000000119') = 'تنها',
  '0223: and named after the person — nobody is asked to name a company they do not have');
select t.ok(
  (select onboarding_completed_at is null and onboarding = '{}'::jsonb
     from echo.app_user where id = '19000000-0000-4000-8000-000000000119'),
  '0223: a new arrival is NOT onboarded yet — the shell routes them to the flow');
select t.ok(
  (select accepted_at is not null and accepted_by is null
     from echo.app_user where id = '19000000-0000-4000-8000-000000000119'),
  '0223: the acceptance stamp is the platform''s — the confirmed email accepted them');
select t.ok(
  (select count(*) from echo.app_user u
    where u.org_id = (select org_id from echo.app_user where id = '19000000-0000-4000-8000-000000000119')
      and u.kind = 'agent') > 0,
  '0223: the agents took their seats in the new workspace (0171''s trigger fired)');

-- ─── the ordinary path: the founder is IN, under RLS ─────────────────────
set local role echo_app;
select set_config('echo.actor_id', '19000000-0000-4000-8000-000000000119', true);
select t.ok(
  (select count(*) from echo.org) = 1,
  '0223: the founder sees exactly their own workspace');
select t.ok(
  (select role from echo.app_user where id = echo.actor_id()) = 'owner',
  '0223: and reads their own row as its owner');

-- ─── they may write their own onboarding ─────────────────────────────────
update echo.app_user
   set onboarding = onboarding || '{"goals":["meetings"],"source":"friend"}'::jsonb
 where id = echo.actor_id();
select t.ok(
  (select onboarding->'goals' = '["meetings"]'::jsonb from echo.app_user where id = echo.actor_id()),
  '0223: a person writes their own answers');
update echo.app_user
   set onboarding = onboarding || '{"work":"founder"}'::jsonb,
       onboarding_completed_at = coalesce(onboarding_completed_at, now())
 where id = echo.actor_id();
select t.ok(
  (select onboarding ? 'goals' and onboarding ? 'work' and onboarding_completed_at is not null
     from echo.app_user where id = echo.actor_id()),
  '0223: a later step MERGES and the stamp lands — nothing said earlier is erased');

-- ─── inviting makes a team, once, and never the other way ─────────────────
insert into echo.invitation (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
values ((select org_id from echo.app_user where id = echo.actor_id()),
        'colleague-119@example.com', 'member', echo.actor_id(),
        repeat('1', 64), 'echo_inv_', now() + interval '1 day');
select t.ok(
  (select kind from echo.org) = 'team',
  '0223: the first invitation makes the workspace a TEAM');
insert into echo.invitation (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
values ((select org_id from echo.app_user where id = echo.actor_id()),
        'colleague2-119@example.com', 'member', echo.actor_id(),
        repeat('2', 64), 'echo_inv_', now() + interval '1 day');
select t.ok(
  (select kind from echo.org) = 'team',
  '0223: a second invitation changes nothing');
select t.raises(
  $$update echo.org set kind = 'personal'$$,
  '23514',
  '0223: a team does not become a personal workspace again');

-- ─── managed intake is the switch, and it is intact ──────────────────────
reset role;
insert into echo.org (id, name, accepts_signups)
values ('19a00000-0000-4000-8000-000000000119', 'سازمان پذیرنده', true);
set local role echo_app;
select set_config('echo.actor_id', '', true);
select t.ok(
  (select org_id::text || '/' || role::text || '/' || status::text from echo.register_account(
     '19100000-0000-4000-8000-000000000119', 'guided-119@example.com', 'راهنمایی‌شده'))
    = '19a00000-0000-4000-8000-000000000119/member/pending',
  '0223: with an org MARKED, a bare arrival pends THERE — managed intake is the switch');
reset role;
select t.ok(
  (select kind from echo.org where id = '19a00000-0000-4000-8000-000000000119') = 'team',
  '0223: an org born in the console (or seeded) is a team by default');
delete from echo.app_user where id = '19100000-0000-4000-8000-000000000119';
update echo.org set accepts_signups = false where id = '19a00000-0000-4000-8000-000000000119';

-- ─── a NAME still joins pending (0082's wall) ────────────────────────────
set local role echo_app;
select t.ok(
  (select role::text || '/' || status::text from echo.register_account(
     '19100000-0000-4000-8000-000000000119', 'guided-119@example.com', 'راهنمایی‌شده', 'شرکت الف'))
    = 'member/pending',
  '0223: typing an organisation''s name still joins it PENDING — a name is never a membership');

-- ─── the kind is a closed set ────────────────────────────────────────────
reset role;
select t.raises(
  $$insert into echo.org (name, kind) values ('باشگاه', 'club')$$,
  '23514',
  '0223: a third kind of organisation is refused');
