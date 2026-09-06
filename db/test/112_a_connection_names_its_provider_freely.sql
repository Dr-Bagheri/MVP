-- 0199: the provider check names the registry's providers, and the public
-- settings ride on the row under the owner's own policy.
--
-- The connection is created below RLS as its owner (D29's wall did not move
-- in 0199, and this file re-asserts the half that matters for the new
-- providers: a colleague — even the org's owner — cannot see it).

reset role;
set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0199 policy test runs under a non-bypass product role');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

-- a token-kind provider with its public settings
insert into echo.connector_connection
  (id, org_id, owner_id, provider, status, account_label, settings)
values
  ('99000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'mcp', 'connected', 'tools.example.test',
   '{"url": "https://tools.example.test/mcp", "server_name": "example"}'::jsonb);
select t.ok(
  (select settings->>'url' from echo.connector_connection where id = '99000000-0000-4000-8000-000000000001')
    = 'https://tools.example.test/mcp',
  'the owner reads the connection''s public settings back');

-- an OAuth provider from the new family
insert into echo.connector_connection
  (id, org_id, owner_id, provider, status, account_label)
values
  ('99000000-0000-4000-8000-000000000002',
   '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'zoom', 'connected', 'bob@example.com');
select t.ok(
  exists (select 1 from echo.connector_connection where id = '99000000-0000-4000-8000-000000000002'),
  'a zoom connection is a connection');

-- the check still refuses a name outside the registry (the control)
select t.denied(
  $$insert into echo.connector_connection (org_id, owner_id, provider, status)
    values ('0a000000-0000-4000-8000-00000000000a', '02000000-0000-4000-8000-000000000002', 'myspace', 'connected')$$,
  'a provider the registry does not know is refused by the check');

-- settings must be an object
select t.denied(
  $$insert into echo.connector_connection (org_id, owner_id, provider, status, settings)
    values ('0a000000-0000-4000-8000-00000000000a', '02000000-0000-4000-8000-000000000002', 'slack', 'connected', '"text"'::jsonb)$$,
  'settings that are not an object are refused');

-- D29 holds for the new providers: the org owner cannot see a member's grant
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner
select t.ok(
  not exists (select 1 from echo.connector_connection where id in
    ('99000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002')),
  'an organisation owner cannot see a member''s zoom or mcp connection');
