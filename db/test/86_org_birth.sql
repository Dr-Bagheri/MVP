-- 0082: organizations are born in the platform console, nowhere else.
--
-- Self-contained: every test file rolls back, so nothing carries over from
-- 85 (its old "runs after 85" premise was never true under this runner).
-- Alice is seated as the fixture platform root here, at owner altitude; the
-- registry row is fixture data and rolls back with the file.

reset role;
insert into echo.platform_operator (user_id)
values ('01000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;
set local role echo_app;

-- ── the root creates an org, audited ──────────────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select echo.platform_create_org(
     '01000000-0000-4000-8000-000000000001', 'شرکت نوی فیکسچر', 'fa',
     'onboarding the new customer')) is not null,
  'the platform root creates an organization');
-- read back through the console door: the new org is not the root's own, so
-- the ambient product read cannot see it (0091 — console-only sight)
select t.ok(
  exists (select 1 from echo.platform_list_orgs() o
           where o.name = 'شرکت نوی فیکسچر' and o.status = 'active'),
  'and it is born ACTIVE, ready to be joined by name');

-- ── the name is a JOIN KEY: duplicates are refused at birth ───────────────
select t.denied(
  $$select echo.platform_create_org(
      '01000000-0000-4000-8000-000000000001', 'شرکت نوی فیکسچر', 'fa', 'again')$$,
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
     'شرکت نوی فیکسچر')) = 'pending',
  'the console-born org is joinable by its name — pending member, the full loop closed');

-- no sweep needed: the file's transaction rolls back — the org, the root
-- seat and the new hire all vanish with it.
