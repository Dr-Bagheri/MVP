-- 0091: root sight is console-only. The discriminating pair: the SAME
-- root actor sees only their own org through the PRODUCT read, and the
-- whole platform through the CONSOLE door.

-- seed: alice (org A owner) becomes a platform root, at owner altitude —
-- exactly how the real registry is administered
reset role;
insert into echo.platform_operator (user_id, role, granted_by) values
  ('01000000-0000-4000-8000-000000000001', 'platform_root', null)
  on conflict (user_id) do nothing;
set local role echo_app;

-- ── the LEAK, closed: a root's ordinary member read stays org-scoped ──────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  not exists (select 1 from echo.app_user u
               where u.org_id = '0b000000-0000-4000-8000-00000000000b'),
  'a platform root reading app_user like any org screen does NOT see org B — the 0066 policy is gone');
select t.ok(
  not exists (select 1 from echo.org o
               where o.id = '0b000000-0000-4000-8000-00000000000b'),
  'nor org B''s row through the product org read');
-- positive control: their own org is still fully visible (the base policy)
select t.ok(
  exists (select 1 from echo.app_user u
           where u.org_id = '0a000000-0000-4000-8000-00000000000a'),
  'their own organization''s members remain visible — the base policy is untouched');

-- ── the console door: the SAME actor sees everything through it ───────────
select t.ok(
  exists (select 1 from echo.platform_list_users() u
           where u.org_id = '0b000000-0000-4000-8000-00000000000b'),
  'platform_list_users() serves org B to the root — sight lives in the door');
select t.ok(
  (select count(*) from echo.platform_list_orgs()) >= 2,
  'platform_list_orgs() serves every organization');
select t.ok(
  (select organization_total from echo.platform_overview_counts()) >= 2,
  'the overview counts run at platform altitude');

-- ── and the door refuses everyone else ────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select * from echo.platform_list_users()$$,
  'a plain member is refused at the console door');
select t.denied(
  $$select * from echo.platform_list_orgs()$$,
  'org list likewise');
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
select t.denied(
  $$select * from echo.platform_overview_counts()$$,
  'an org ADMIN is refused too — org rank buys nothing at platform altitude');

-- sweep the seeded registry row
reset role;
delete from echo.platform_operator
 where user_id = '01000000-0000-4000-8000-000000000001';
set local role echo_app;
