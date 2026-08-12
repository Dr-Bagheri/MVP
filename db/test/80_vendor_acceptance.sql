-- M15 amendment: who accepts whom.
--
--   joining an existing org → that org's admin, through the product
--   a brand-new org         → the vendor, through an operator path that the
--                             product cannot reach
--
-- The second is the interesting one to test, because the failure mode is not
-- "it doesn't work" but "core/ can quietly accept its own customers".

reset role;
insert into auth.users (id, email)
values ('0f000000-0000-4000-8000-00000000000f', 'founder@example.com');

set local role echo_app;
select echo.register_account(
  '0f000000-0000-4000-8000-00000000000f', 'founder@example.com', 'بنیان‌گذار');

-- Read it as the founder: with no identity attached, echo_app can see nothing
-- at all — including the row it just created. That is invariant 2 doing its
-- job, so the check has to authenticate like the real UI would.
select set_config('echo.actor_id', '0f000000-0000-4000-8000-00000000000f', true);
select t.ok(
  (select status from echo.app_user where id = '0f000000-0000-4000-8000-00000000000f')
    = 'pending',
  'a self-registered founder starts pending, with nobody in their org to accept them');

-- --- the product cannot accept its own customers --------------------------
select t.denied(
  $$select echo.vendor_accept_org(
      (select org_id from echo.app_user where id = '0f000000-0000-4000-8000-00000000000f'))$$,
  'core/ has no EXECUTE on the vendor acceptance path');
select t.denied($$select echo.vendor_pending_orgs()$$,
  'nor can it even list the orgs awaiting acceptance');

-- The founder cannot self-accept through the ordinary product path either.
-- Filtered rather than refused, since 0018: a pending account cannot write to
-- its own row at all, so the acceptance rules are never even reached.
select set_config('echo.actor_id', '0f000000-0000-4000-8000-00000000000f', true);
select t.writes_nothing(
  $$update echo.app_user set status = 'active'
     where id = '0f000000-0000-4000-8000-00000000000f'$$,
  'and the founder cannot accept themselves — being an org''s only admin is not authority');

-- --- the vendor can ---------------------------------------------------------
-- The operator connects with no product identity attached, as it would in
-- reality; the acceptance must record itself correctly regardless.
reset role;
select set_config('echo.actor_id', '', true);
set local role echo_vendor;

select t.ok(
  exists (select 1 from echo.vendor_pending_orgs()
          where founder = '0f000000-0000-4000-8000-00000000000f'),
  'the vendor sees the new org waiting');
select t.ok(
  not exists (select 1 from echo.vendor_pending_orgs()
              where org_id = '0a000000-0000-4000-8000-00000000000a'),
  'and does not see established orgs — those accept their own joiners');

select echo.vendor_accept_org(
  (select org_id from echo.vendor_pending_orgs()
    where founder = '0f000000-0000-4000-8000-00000000000f'));

reset role;
select t.ok(
  (select status from echo.app_user where id = '0f000000-0000-4000-8000-00000000000f')
    = 'active',
  'the founder is active');
select t.ok(
  (select accepted_at is not null and accepted_by is null
     from echo.app_user where id = '0f000000-0000-4000-8000-00000000000f'),
  'accepted_at set with accepted_by NULL is the record that the VENDOR accepted, not an org admin');

-- --- and only for a brand-new org ------------------------------------------
set local role echo_vendor;
select t.denied(
  $$select echo.vendor_accept_org('0a000000-0000-4000-8000-00000000000a')$$,
  'the vendor path refuses an established org — dan is accepted by his own admin, not by us');

-- --- the ordinary path still works for a joiner ----------------------------
reset role;
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
update echo.app_user set status = 'active'
 where id = '04000000-0000-4000-8000-000000000004';
select t.ok(
  (select accepted_by from echo.app_user where id = '04000000-0000-4000-8000-000000000004')
    = '01000000-0000-4000-8000-000000000001',
  'a joiner is accepted by their org''s admin, and the row names them');

reset role;
