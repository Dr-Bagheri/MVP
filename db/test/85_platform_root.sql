-- M32 — Platform root is a separate, metadata-only control plane.
--
-- This test is intentionally two-sided: it proves the root can operate when
-- needed, then proves the same actor still cannot cross into another
-- organisation's customer content. A green access test alone cannot prove
-- that a new broad role did not become a content bypass.

-- The fixture starts with zero platform roots. Alice is an active owner in
-- org A and represents the server-configured bootstrap account.
reset role;
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.ok(
  echo.bootstrap_platform_root(
    '01000000-0000-4000-8000-000000000001', 'alice@example.com'
  ),
  'the configured active account claims the first platform root exactly once'
);
select t.ok(
  echo.actor_is_platform_root(),
  'the root predicate is a fresh database fact under the caller identity'
);
select t.ok(
  not echo.bootstrap_platform_root(
    '01000000-0000-4000-8000-000000000001', 'alice@example.com'
  ),
  'the root bootstrap is consumed and cannot create a second root record'
);
select t.denied(
  $$select echo.bootstrap_platform_root(
      '02000000-0000-4000-8000-000000000002', 'alice@example.com'
    )$$,
  'a caller cannot smuggle another user id into root bootstrap'
);

-- Cross-org METADATA is the designed capability.
select t.ok(
  exists (select 1 from echo.org where id = '0b000000-0000-4000-8000-00000000000b'),
  'platform root can list an organization outside its own membership'
);
select t.ok(
  exists (select 1 from echo.app_user where id = '05000000-0000-4000-8000-000000000005'),
  'platform root can list an external user metadata row'
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
select t.denied(
  $$select * from echo.connector_secret$$,
  'platform root has no connector-secret grant'
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
select t.ok(
  (select status = 'disabled' from echo.app_user where id = '05000000-0000-4000-8000-000000000005'),
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
  'root can appoint an active second platform root'
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
select t.denied(
  $$select echo.platform_revoke_root(
      '01000000-0000-4000-8000-000000000001',
      '01000000-0000-4000-8000-000000000001',
      'attempt self removal'
    )$$,
  'the final root cannot remove itself'
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
