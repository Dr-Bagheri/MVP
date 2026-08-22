-- M15 as amended by 0056: who accepts whom.
--
--   founding a NEW org      → nobody. The confirmed email IS the acceptance:
--                             the founder is ACTIVE from the first row, owner
--                             of an empty org with nothing to leak into.
--   joining an EXISTING org → that org's admin, through the product
--                             (or an invitation, 0043 — active on redeem).
--
-- The vendor path (vendor_pending_orgs / vendor_accept_org) REMAINS: it is
-- vendor-only, product-unreachable, and correct for any founder registered
-- before 0056. It is tested here against a hand-seeded legacy-shaped row,
-- because register_account can no longer produce one — which is itself the
-- fact 0056 exists to assert.

-- --- founding by SIGNUP is gone (0082): orgs are born in the console -------
reset role;
insert into auth.users (id, email)
values ('0f000000-0000-4000-8000-00000000000f', 'founder@example.com');

set local role echo_app;
select t.denied(
  $$select echo.register_account(
      '0f000000-0000-4000-8000-00000000000f', 'founder@example.com', 'بنیان‌گذار')$$,
  'registering without an org name is REFUSED — nobody founds an org (and becomes '
  'its owner) by signing up any more (0082)');

-- Hand-seed 0f as an ACTIVE OWNER of a fresh org, at owner altitude — the
-- exact shape platform_create_org + a console owner-promotion produce, which
-- signup can no longer mint. The later one-way-door block needs a real owner.
reset role;
insert into echo.org (id, name)
values ('ff000000-0000-4000-8000-00000000000f', 'سازمان بنیان‌گذار');
insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at)
values ('0f000000-0000-4000-8000-00000000000f', 'ff000000-0000-4000-8000-00000000000f',
        'founder@example.com', 'بنیان‌گذار', 'owner', 'active', now());
set local role echo_app;

-- --- joining an existing org still pends (the other half of the matrix) ----
reset role;
insert into auth.users (id, email)
values ('0e000000-0000-4000-8000-00000000000e', 'joiner2@example.com');

set local role echo_app;
select t.ok(
  (select status from echo.register_account(
     '0e000000-0000-4000-8000-00000000000e', 'joiner2@example.com', 'پیوسته',
     null, '0a000000-0000-4000-8000-00000000000a')) = 'pending',
  'joining an EXISTING org lands pending — an org id is an identifier, '
  'not an invitation (0056 deliberately does not reach this path)');

-- --- the vendor path, exercised against a LEGACY pending founder -----------
-- Seeded at owner altitude in the exact shape register_account produced
-- before 0056. An auth.users row written here is fixture, not evidence of a
-- signup — this represents an org that registered before the amendment.
reset role;
insert into auth.users (id, email)
values ('0d000000-0000-4000-8000-00000000000d', 'legacy@example.com');
insert into echo.org (id, name)
values ('dd000000-0000-4000-8000-00000000000d', 'سازمان قدیمی');
insert into echo.app_user (id, org_id, email, display_name, role, status)
values ('0d000000-0000-4000-8000-00000000000d', 'dd000000-0000-4000-8000-00000000000d',
        'legacy@example.com', 'بنیان‌گذار قدیمی', 'owner', 'pending');

-- The product cannot accept its own customers.
set local role echo_app;
select t.denied(
  $$select echo.vendor_accept_org('dd000000-0000-4000-8000-00000000000d')$$,
  'core/ has no EXECUTE on the vendor acceptance path');
select t.denied($$select echo.vendor_pending_orgs()$$,
  'nor can it even list the orgs awaiting acceptance');

-- The pending founder cannot self-accept through the ordinary product path.
-- Filtered rather than refused, since 0018: a pending account cannot write to
-- its own row at all, so the acceptance rules are never even reached.
select set_config('echo.actor_id', '0d000000-0000-4000-8000-00000000000d', true);
select t.writes_nothing(
  $$update echo.app_user set status = 'active'
     where id = '0d000000-0000-4000-8000-00000000000d'$$,
  'and the founder cannot accept themselves — being an org''s only admin is not authority');

-- The vendor can — and sees exactly the legacy org, nothing born after 0056.
reset role;
select set_config('echo.actor_id', '', true);
set local role echo_vendor;

select t.ok(
  exists (select 1 from echo.vendor_pending_orgs()
          where founder = '0d000000-0000-4000-8000-00000000000d'),
  'the vendor sees the legacy org waiting');
select t.ok(
  not exists (select 1 from echo.vendor_pending_orgs()
              where founder = '0f000000-0000-4000-8000-00000000000f'),
  'an org with an ACTIVE owner is not in the queue — nothing to accept');
select t.ok(
  not exists (select 1 from echo.vendor_pending_orgs()
              where org_id = '0a000000-0000-4000-8000-00000000000a'),
  'and does not see established orgs — those accept their own joiners');

select echo.vendor_accept_org('dd000000-0000-4000-8000-00000000000d');

reset role;
select t.ok(
  (select status from echo.app_user where id = '0d000000-0000-4000-8000-00000000000d')
    = 'active',
  'the legacy founder is active');
select t.ok(
  (select accepted_at is not null and accepted_by is null
     from echo.app_user where id = '0d000000-0000-4000-8000-00000000000d'),
  'accepted_at set with accepted_by NULL is the record that the VENDOR accepted, not an org admin');

-- --- and only for an org that has someone to accept ------------------------
set local role echo_vendor;
select t.denied(
  $$select echo.vendor_accept_org('0a000000-0000-4000-8000-00000000000a')$$,
  'the vendor path refuses an established org — dan is accepted by his own admin, not by us');

-- ===========================================================================
-- An org's status is the vendor's, in both directions.
--
-- Measured before this landed: an owner could suspend their own org with one
-- UPDATE and then could not undo it, because every predicate authorising the
-- reverse requires the org to be active. One-way door, org on the wrong side.
-- ===========================================================================
reset role;
set local role echo_app;
select set_config('echo.actor_id', '0f000000-0000-4000-8000-00000000000f', true);

select t.denied(
  format($$update echo.org set status = 'suspended' where id = %L$$,
         (select org_id from echo.app_user where id = '0f000000-0000-4000-8000-00000000000f')),
  'an owner cannot suspend their own organization — that door only opened one way');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.denied(
  $$update echo.org set status = 'suspended'
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  'nor can an admin of an established org');

select t.denied(
  $$select echo.vendor_set_org_status('0a000000-0000-4000-8000-00000000000a','suspended')$$,
  'and the application cannot reach the vendor operation at all');

-- The vendor can, and can undo it — which is the whole point.
reset role;
set local role echo_vendor;
select t.ok(
  echo.vendor_set_org_status('0b000000-0000-4000-8000-00000000000b', 'suspended'),
  'the vendor suspends an organization');
select t.ok(
  not echo.vendor_set_org_status('0b000000-0000-4000-8000-00000000000b', 'suspended'),
  'suspending an already-suspended org is false, not an error');
select t.ok(
  echo.vendor_set_org_status('0b000000-0000-4000-8000-00000000000b', 'active'),
  'and reactivates it — suspension is not a one-way street');
select t.denied(
  $$select echo.vendor_set_org_status('0c000000-0000-4000-8000-00000000000c','suspended')$$,
  'an unknown organization is refused');

reset role;
select t.ok(
  (select status_changed_at is not null from echo.org
    where id = '0b000000-0000-4000-8000-00000000000b'),
  'and the change is stamped, so "since when" has an answer');

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
