-- 0082: organizations are born in the platform console, nowhere else.
-- Runs AFTER 85: alice (01…01) became the platform root there.

reset role;
set local role echo_app;

-- ── the root creates an org, audited ──────────────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select echo.platform_create_org(
     '01000000-0000-4000-8000-000000000001', 'شرکت نو', 'fa',
     'onboarding the new customer')) is not null,
  'the platform root creates an organization');
select t.ok(
  exists (select 1 from echo.org where name = 'شرکت نو' and status = 'active'),
  'and it is born ACTIVE, ready to be joined by name');

-- ── the name is a JOIN KEY: duplicates are refused at birth ───────────────
select t.denied(
  $$select echo.platform_create_org(
      '01000000-0000-4000-8000-000000000001', 'شرکت نو', 'fa', 'again')$$,
  'a duplicate active name is refused — signup matches on names, and a twin would make the first unjoinable');
select t.denied(
  $$select echo.platform_create_org(
      '01000000-0000-4000-8000-000000000001', '  شرکت الف ', 'fa', 'case check')$$,
  'trim and case do not slip a twin past the check');

-- ── the wall: a non-root (even an org owner) births nothing ───────────────
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.denied(
  $$select echo.platform_create_org(
      '05000000-0000-4000-8000-000000000005', 'سازمان قاچاقی', 'fa', 'trying')$$,
  'an org owner who is not platform root cannot create organizations');

-- ── the new org is joinable by NAME as a pending member (the 0082 loop) ───
reset role;
insert into auth.users (id, email)
values ('86000000-0000-4000-8000-000000000086', 'newhire@example.com');
set local role echo_app;
select t.ok(
  (select status from echo.register_account(
     '86000000-0000-4000-8000-000000000086', 'newhire@example.com', 'تازه‌وارد',
     'شرکت نو')) = 'pending',
  'the console-born org is joinable by its name — pending member, the full loop closed');

-- deliberately NOT swept: an app_user delete at owner altitude would race
-- the status-history/tombstone machinery for nothing — only 90_queues runs
-- after this file and it counts no users. (B3's count trap, weighed.)
