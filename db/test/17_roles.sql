-- M23's three roles, as a walked matrix.
--
-- The M11 delete bug happened because the suite asserted the privileged path
-- and the refused path and never the ordinary one. So this file walks actors
-- {owner, admin, member} against targets {self, owner, admin, member} for both
-- role and status changes, and asserts what each one may DO as carefully as
-- what it may not.
--
-- Fixture: alice = owner, dave = admin, bob/carol = members, dan = pending,
-- all in org A; erin = owner of org B.

reset role;
set local role echo_app;

-- ===========================================================================
-- An owner is an admin with more.
--
-- This is the assertion the whole redefinition rests on: every policy in the
-- schema asks actor_is_admin(), so if that stopped being true for an owner,
-- promoting the founder would strip them of the product one policy at a time.
-- ===========================================================================
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(echo.actor_is_admin(), 'the owner is an admin for every policy that asks');
select t.ok(echo.actor_is_owner(), 'and is additionally the owner');
select t.ok((select count(*) from echo.call) = 5,
  'so the owner still reads the whole org — the admin powers did not move');

select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
select t.ok(echo.actor_is_admin() and not echo.actor_is_owner(),
  'a plain admin is an admin and not an owner');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(not echo.actor_is_admin() and not echo.actor_is_owner(),
  'and a member is neither');

-- ===========================================================================
-- Nobody changes their own role or status — every actor, no exceptions.
-- ===========================================================================
select t.denied(
  $$update echo.app_user set role = 'admin'
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'a member cannot promote themselves');

select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
select t.denied(
  $$update echo.app_user set status = 'disabled'
     where id = '06000000-0000-4000-8000-000000000006'$$,
  'an admin cannot change their own status');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.denied(
  $$update echo.app_user set role = 'member'
     where id = '01000000-0000-4000-8000-000000000001'$$,
  'and neither can the owner — the rule generalised rather than gaining an exception');

-- ===========================================================================
-- The ORDINARY paths: what each role may actually do.
-- ===========================================================================

-- An admin manages members, exactly as before M23.
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
update echo.app_user set status = 'active'
 where id = '04000000-0000-4000-8000-000000000004';
select t.ok(
  (select status = 'active' and accepted_by = '06000000-0000-4000-8000-000000000006'
     from echo.app_user where id = '04000000-0000-4000-8000-000000000004'),
  'an admin accepts a pending member, and the acceptance names them');

update echo.app_user set status = 'disabled'
 where id = '03000000-0000-4000-8000-000000000003';
select t.ok(
  (select status from echo.app_user where id = '03000000-0000-4000-8000-000000000003')
    = 'disabled',
  'and may disable one');

-- The owner does everything an admin does, plus the admin tier.
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
update echo.app_user set status = 'active'
 where id = '03000000-0000-4000-8000-000000000003';
select t.ok(
  (select status from echo.app_user where id = '03000000-0000-4000-8000-000000000003')
    = 'active',
  'the owner manages members too');

update echo.app_user set role = 'admin'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select role from echo.app_user where id = '02000000-0000-4000-8000-000000000002')
    = 'admin',
  'the owner promotes a member to admin');

update echo.app_user set role = 'member'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select role from echo.app_user where id = '02000000-0000-4000-8000-000000000002')
    = 'member',
  'and demotes one back');

update echo.app_user set status = 'disabled'
 where id = '06000000-0000-4000-8000-000000000006';
select t.ok(
  (select status from echo.app_user where id = '06000000-0000-4000-8000-000000000006')
    = 'disabled',
  'the owner disables an admin');
update echo.app_user set status = 'active'
 where id = '06000000-0000-4000-8000-000000000006';

-- ===========================================================================
-- The admin tier belongs to the owner.
-- ===========================================================================
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);

select t.denied(
  $$update echo.app_user set role = 'admin'
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'an admin cannot mint a peer — an admin they could not then manage is not "managing members"');
select t.denied(
  $$update echo.app_user set role = 'member'
     where id = '01000000-0000-4000-8000-000000000001'$$,
  'nor demote the owner');
select t.denied(
  $$update echo.app_user set status = 'disabled'
     where id = '01000000-0000-4000-8000-000000000001'$$,
  'nor disable the owner');

-- Another admin is out of reach too — only the owner touches that tier.
reset role;
insert into auth.users (id, email) values
  ('07000000-0000-4000-8000-000000000007', 'second-admin@example.com');
insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at)
values ('07000000-0000-4000-8000-000000000007', '0a000000-0000-4000-8000-00000000000a',
        'second-admin@example.com', 'ادمین دوم', 'admin', 'active', now());
set local role echo_app;
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
select t.denied(
  $$update echo.app_user set status = 'disabled'
     where id = '07000000-0000-4000-8000-000000000007'$$,
  'an admin cannot disable another admin');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
update echo.app_user set status = 'disabled'
 where id = '07000000-0000-4000-8000-000000000007';
select t.ok(
  (select status from echo.app_user where id = '07000000-0000-4000-8000-000000000007')
    = 'disabled',
  'the owner can — that is what owning the tier means');

-- ===========================================================================
-- Ownership is not handed over by an UPDATE.
-- ===========================================================================
select t.denied(
  $$update echo.app_user set role = 'owner'
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'nobody is made owner by a role change — transfer is an explicit action, unbuilt in v1');

-- And the structure agrees, so a second owner is unrepresentable rather than
-- merely refused.
reset role;
select t.denied(
  $$update echo.app_user set role = 'owner'
     where id = '06000000-0000-4000-8000-000000000006'$$,
  'even above the wall, an org cannot hold two owners');

-- ===========================================================================
-- Members manage nobody.
-- ===========================================================================
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.writes_nothing(
  $$update echo.app_user set status = 'disabled'
     where id = '03000000-0000-4000-8000-000000000003'$$,
  'a member cannot disable another member — filtered before any rule is consulted');
select t.writes_nothing(
  $$update echo.app_user set role = 'member'
     where id = '06000000-0000-4000-8000-000000000006'$$,
  'nor demote an admin');

-- ...but still edits their own profile.
update echo.app_user set display_name = 'باب دوم'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select display_name from echo.app_user where id = '02000000-0000-4000-8000-000000000002')
    = 'باب دوم',
  'and still edits their own profile, which was never a role question');

-- ===========================================================================
-- Roles do not cross orgs.
-- ===========================================================================
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.writes_nothing(
  $$update echo.app_user set role = 'member'
     where id = '06000000-0000-4000-8000-000000000006'$$,
  'the owner of another org is nobody here');

-- ===========================================================================
-- The audit table admits admins, not merely members who mean well.
--
-- Its insert policy used to accept any active member, self-attributed. Every
-- caller was admin-gated, so nothing was wrong — but that was a property of
-- core/ rather than of the wall, and a table read only by admins should not
-- depend on the api remembering who it lets near the insert.
-- ===========================================================================
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.writes_nothing(
  $$insert into echo.admin_action (org_id, actor_id, action, target_type)
    values ('0a000000-0000-4000-8000-00000000000a',
            '02000000-0000-4000-8000-000000000002', 'call_deleted', 'call')$$,
  'a member cannot write an audit line, however truthful');

select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
insert into echo.admin_action (org_id, actor_id, action, target_type, target_id)
values ('0a000000-0000-4000-8000-00000000000a',
        '06000000-0000-4000-8000-000000000006', 'member_accepted', 'app_user',
        '04000000-0000-4000-8000-000000000004');
select t.ok(
  (select count(*) from echo.admin_action where action = 'member_accepted') = 1,
  'an admin can');

select t.denied(
  $$insert into echo.admin_action (org_id, actor_id, action, target_type)
    values ('0a000000-0000-4000-8000-00000000000a',
            '06000000-0000-4000-8000-000000000006', 'memberAccepted', 'app_user')$$,
  'and camelCase is refused — the vocabulary is core/''s, the shape is not');

-- ===========================================================================
-- "Counts as an admin" is decided in exactly one place.
--
-- Adding 'owner' silently invalidated four separate `role = 'admin'` tests
-- across the schema; three were anticipated and the fourth was caught by this
-- suite. The rule is written once now (0037), and this asserts no fifth copy
-- has appeared — a negative-space check, so the drift fails the suite rather
-- than the product.
-- ===========================================================================
select t.ok(
  echo.role_is_admin('owner') and echo.role_is_admin('admin')
    and not echo.role_is_admin('member'),
  'the admin role set is owner and admin, and nothing else');

select t.ok(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'echo' and p.prokind = 'f'
      and p.proname <> 'role_is_admin'
      and p.prosrc like '%role = ''admin''%') = 0,
  'and no other function restates it by comparing against a literal role');

reset role;
