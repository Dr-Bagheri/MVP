-- M30 / D29: persisted personas, manual workflow configuration, and OAuth
-- credentials all have distinct visibility boundaries. These run below RLS,
-- not against an already-filtered fake result.

reset role;
set local role echo_app;
-- Preconditions: this is a real policy test, never a superuser-shaped one.
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  'M30 policy test runs under a non-bypass product role');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

-- The seeded system agents/workflows are product configuration visible to an
-- active member, while their trusted instruction bodies remain server-only.
-- 0163 retired the eight job-shaped agents for two named ones. The subject
-- moved; the RULE under test did not — a shipped agent is product
-- configuration an active member can read.
select t.ok(
  exists (select 1 from echo.assistant_agent where handle = 'roya' and level = 'system'),
  'an active member can select a seeded system agent (0163: roya)');
select t.ok(
  exists (select 1 from echo.workflow_template where slug = 'prepare-meetings'),
  'an active member can select the seeded meeting workflow');

-- Create a connection as its owner. The bytea deliberately resembles a
-- ciphertext, rather than deriving an assertion fixture from the encryption
-- implementation (the database only owns isolation, not AES correctness).
insert into echo.connector_connection
  (id, org_id, owner_id, provider, status, account_label)
values
  ('72000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'google', 'connected', 'bob@example.com');
insert into echo.connector_secret
  (connection_id, org_id, owner_id, encrypted_payload)
values
  ('72000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', decode('00112233445566778899aabbccddeeff', 'hex'));
select t.ok(
  exists (select 1 from echo.connector_secret where connection_id = '72000000-0000-4000-8000-000000000001'),
  'the owner can read their encrypted connection credential');

-- An organisation admin is expressly NOT an exception to D29. This is the
-- important ordinary product boundary: admin can administer the org but not
-- read a colleague's provider access token or account connection.
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner/admin
select t.ok(
  not exists (select 1 from echo.connector_connection where id = '72000000-0000-4000-8000-000000000001'),
  'an organisation owner cannot see a member connection');
select t.ok(
  not exists (select 1 from echo.connector_secret where connection_id = '72000000-0000-4000-8000-000000000001'),
  'an organisation owner cannot read a member encrypted credential');

-- A non-owner also cannot change a private connection; RLS normally refuses
-- by touching zero rows, which t.writes_nothing treats as a real denial.
select t.writes_nothing(
  $$update echo.connector_connection set status = 'revoked'
      where id = '72000000-0000-4000-8000-000000000001'$$,
  'an organisation owner cannot revoke a member connection');

-- The agent database role receives neither configuration instructions nor
-- provider metadata/credentials. This makes an accidental new tool fail at
-- the database wall even if a future prompt change is unsafe.
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select instructions from echo.assistant_agent where handle = 'roya'$$,
  'echo_agent has no grant to saved agent instructions');
select t.denied(
  $$select encrypted_payload from echo.connector_secret
      where connection_id = '72000000-0000-4000-8000-000000000001'$$,
  'echo_agent has no grant to encrypted connector credentials');

reset role;
