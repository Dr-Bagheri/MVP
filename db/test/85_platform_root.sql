-- M32 — Platform root is a separate, metadata-only control plane.
--
-- This test is intentionally two-sided: it proves the root can operate when
-- needed, then proves the same actor still cannot cross into another
-- organisation's customer content. A green access test alone cannot prove
-- that a new broad role did not become a content bypass.

-- Production-aware: this suite also runs against the LIVE database, whose
-- platform registry is real (live roots predate the fixture). The
-- first-claim story is only provable where no root exists yet; where roots
-- hold office, the same door must present as already CONSUMED — asserted,
-- not skipped, because "consumed" is exactly the property from that side.
-- The registry is invisible below root altitude, so the count is probed at
-- owner altitude and carried in as a GUC.
reset role;
select set_config('t.pre_roots',
  (select count(*)::text from echo.platform_operator), true);

set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

do $$
begin
  if current_setting('t.pre_roots')::int = 0 then
    -- a rootless database (the local container, --fresh): the full claim story
    perform t.ok(
      echo.bootstrap_platform_root(
        '01000000-0000-4000-8000-000000000001', 'alice@example.com'
      ),
      'the configured active account claims the first platform root exactly once');
    perform t.ok(
      echo.actor_is_platform_root(),
      'the root predicate is a fresh database fact under the caller identity');
    perform t.ok(
      not echo.bootstrap_platform_root(
        '01000000-0000-4000-8000-000000000001', 'alice@example.com'
      ),
      'the root bootstrap is consumed and cannot create a second root record');
  else
    perform t.ok(
      not echo.bootstrap_platform_root(
        '01000000-0000-4000-8000-000000000001', 'alice@example.com'
      ),
      'live roots predate the fixture, so the bootstrap door is consumed — it cannot mint another first root');
    raise notice 'ok  first-claim story not provable here — % live platform root(s) already in office (asserted as consumed instead)',
      current_setting('t.pre_roots');
  end if;
end $$;

select t.denied(
  $$select echo.bootstrap_platform_root(
      '02000000-0000-4000-8000-000000000002', 'alice@example.com'
    )$$,
  'a caller cannot smuggle another user id into root bootstrap'
);

-- The rest of the file needs alice IN OFFICE whichever branch ran. Mint the
-- fixture root directly at owner altitude — the registry row is fixture
-- data like any other and rolls back with the file. (The 86/87 files used
-- to say "runs after 85"; every file rolls back, so nothing ever carried
-- over — each file now seats its own root.)
reset role;
insert into echo.platform_operator (user_id)
values ('01000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  echo.actor_is_platform_root(),
  'the fixture root is in office for the rest of this file — the predicate answers under the caller identity');

-- Cross-org METADATA is the designed capability — through the CONSOLE DOORS
-- since 0091 (the ambient product read stays org-scoped for a root too;
-- 92_platform_sight pins that side of the pair).
select t.ok(
  exists (select 1 from echo.platform_list_orgs() o
           where o.id = '0b000000-0000-4000-8000-00000000000b'),
  'platform root lists an organization outside its own membership — the console door (0091)'
);
select t.ok(
  exists (select 1 from echo.platform_list_users() u
           where u.id = '05000000-0000-4000-8000-000000000005'),
  'platform root lists an external user metadata row — same door'
);

-- Cross-org CONTENT remains denied. The root happens to own org A, so the
-- negative control must use Erin's private org-B call rather than Alice's
-- own organisation; otherwise the test would only prove existing ownership.
select t.ok(
  not exists (select 1 from echo.call where id = 'c6000000-0000-4000-8000-000000000006'),
  'platform root does not gain visibility of another organization''s private call'
);
select t.ok(
  not exists (select 1 from echo.agent_session where id = '52000000-0000-4000-8000-000000000002'),
  'platform root does not gain assistant-conversation visibility through the new role'
);
-- Connector credentials: echo_app legitimately holds grants here (0065 —
-- core stores and reads tokens FOR THE CALLER), so "no grant" stopped being
-- the wall's shape the day connections landed. The wall is D29's owner-only
-- policy, and the root-specific claim is that root-ness does not widen it.
-- Seed another person's secret first, so the read has something it must
-- fail to surface (rule 12: the fixture is the input where the states
-- differ) — 72_agents… proves the owner-only wall itself.
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
insert into echo.connector_connection
  (id, org_id, owner_id, provider, status, account_label)
values
  ('85000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-00000000000b',
   '05000000-0000-4000-8000-000000000005', 'google', 'connected', 'erin@example.com');
insert into echo.connector_secret
  (connection_id, org_id, owner_id, encrypted_payload)
values
  ('85000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-00000000000b',
   '05000000-0000-4000-8000-000000000005', decode('00112233445566778899aabbccddeeff', 'hex'));
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  not exists (select 1 from echo.connector_secret),
  'platform root surfaces nobody''s connector secrets — the owner-only wall (D29) ignores root-ness'
);

-- A root cannot turn the metadata policy into a direct write permission.
select t.writes_nothing(
  $$update echo.app_user set status = 'disabled'
      where id = '05000000-0000-4000-8000-000000000005'$$,
  'root has no direct cross-org user-status UPDATE path'
);
select t.denied(
  $$insert into echo.platform_operator (user_id) values
      ('06000000-0000-4000-8000-000000000006')$$,
  'root has no direct platform-role INSERT path'
);

-- Named, audited database actions are the only control-plane mutation doors.
select t.ok(
  echo.platform_set_user_status(
    '01000000-0000-4000-8000-000000000001',
    '05000000-0000-4000-8000-000000000005',
    'disabled', 'security review'
  ),
  'root can disable a non-root user through the named operation'
);
-- read back through the console door — erin's row is outside the root's own
-- org, so the product read cannot see her at all (0091, deliberately)
select t.ok(
  (select u.status from echo.platform_list_users() u
    where u.id = '05000000-0000-4000-8000-000000000005') = 'disabled',
  'the named user-status operation changed the target'
);
select t.ok(
  echo.platform_set_org_status(
    '01000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000b',
    'suspended', 'billing hold'
  ),
  'root can suspend another organization through the named operation'
);
select t.ok(
  echo.platform_set_org_status(
    '01000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-00000000000b',
    'active', 'billing cleared'
  ),
  'root can reactivate the organization through the same named door'
);

-- The root's OWN org makes the one-way-door case explicit. Suspending it
-- makes normal product access inactive, but not the platform-root predicate;
-- the operator can still restore it rather than requiring raw SQL.
select t.ok(
  echo.platform_set_org_status(
    '01000000-0000-4000-8000-000000000001',
    '0a000000-0000-4000-8000-00000000000a',
    'suspended', 'resilience drill'
  ),
  'root can suspend its own organization deliberately'
);
select t.ok(
  echo.actor_is_platform_root(),
  'a suspended root organization does not make the recovery role disappear'
);
select t.ok(
  echo.platform_set_org_status(
    '01000000-0000-4000-8000-000000000001',
    '0a000000-0000-4000-8000-00000000000a',
    'active', 'resilience drill complete'
  ),
  'root can restore its own organization after suspension'
);

select t.ok(
  echo.platform_grant_root(
    '01000000-0000-4000-8000-000000000001',
    '06000000-0000-4000-8000-000000000006',
    'on-call coverage'
  ),
  'root can appoint another active platform root'
);
select t.denied(
  $$select echo.platform_set_user_status(
      '01000000-0000-4000-8000-000000000001',
      '06000000-0000-4000-8000-000000000006',
      'disabled', 'not a status patch target'
    )$$,
  'a root cannot disable another root through the user-status path'
);
select t.ok(
  echo.platform_revoke_root(
    '01000000-0000-4000-8000-000000000001',
    '06000000-0000-4000-8000-000000000006',
    'on-call rotation ended'
  ),
  'root can remove a different root through the separate audited action'
);
-- 0066 refuses self-removal BEFORE it even counts the remaining roots, so
-- this holds on the live database too, where the fixture root is never the
-- last one standing.
select t.denied(
  $$select echo.platform_revoke_root(
      '01000000-0000-4000-8000-000000000001',
      '01000000-0000-4000-8000-000000000001',
      'attempt self removal'
    )$$,
  'a platform root can never remove itself — revocation is always another root''s act'
);

select t.ok(
  exists (
    select 1 from echo.platform_audit
     where action = 'org_status_changed'
       and target_org_id = '0b000000-0000-4000-8000-00000000000b'
  ),
  'org lifecycle actions append a platform audit record'
);
select t.denied(
  $$insert into echo.platform_audit (actor_id, action, target_user_id, reason)
      values ('01000000-0000-4000-8000-000000000001',
              'root_granted', '06000000-0000-4000-8000-000000000006', 'forged record')$$,
  'root cannot forge or append platform audit records directly'
);

-- A normal member has neither metadata visibility nor a mutation door.
reset role;
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  not echo.actor_is_platform_root(),
  'a normal member is not made root by their organization membership'
);
select t.ok(
  not exists (select 1 from echo.org where id = '0b000000-0000-4000-8000-00000000000b'),
  'a normal member cannot list another organization metadata row'
);
select t.denied(
  $$select echo.platform_set_org_status(
      '02000000-0000-4000-8000-000000000002',
      '0b000000-0000-4000-8000-00000000000b', 'suspended', 'forged authority'
    )$$,
  'a normal member cannot invoke a named platform operation'
);

reset role;
