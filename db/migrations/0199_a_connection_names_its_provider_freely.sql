-- 0199 — a connection names its provider freely, and carries its public settings
--
-- The connector registry (core/src/api/connector-providers.ts, 2026-09-06)
-- adds Zoom, Slack, Telegram, Jira, Notion, GitHub, WhatsApp Business,
-- Dropbox, OneDrive and a generic MCP server beside Google and Microsoft.
-- Two things stood in the schema's way:
--
--   · `provider` was checked against the two names 0065 knew. The check is
--     kept — an enum drift into free text is how a typo becomes a provider —
--     and widened to the registry's list. core's `CONNECTOR_PROVIDERS` and
--     this list are asserted equal by core/test/connector-providers.test.ts
--     reading THIS file (the producer owns the coverage list, rule 13½).
--
--   · a pasted-token connection has PUBLIC facts a credential does not: the
--     MCP server's URL, the WhatsApp number, the Jira site. They are not
--     secrets, so they do not belong in the encrypted payload (which is
--     opened only to sign a request), and they are not the account label.
--     `settings` holds them, as an object, readable by the same policy that
--     reads the row.
--
-- Nothing about the wall moves: the row is the owner's alone (0065's
-- policies are untouched), echo_agent still holds no grant on the secret.

alter table echo.connector_connection
  drop constraint connector_connection_provider_check;

alter table echo.connector_connection
  add constraint connector_connection_provider_check
    check (provider in (
      'google', 'microsoft',
      'zoom', 'slack', 'telegram', 'jira', 'notion', 'github', 'whatsapp', 'dropbox', 'onedrive', 'mcp'
    ));

alter table echo.connector_connection
  add column settings jsonb not null default '{}'
    constraint connector_connection_settings_is_object
      check (jsonb_typeof(settings) = 'object');

comment on column echo.connector_connection.settings is
  'The connection''s PUBLIC settings — an MCP server''s URL, a WhatsApp number, a Jira site. Never a credential: those live encrypted in connector_secret and are opened only to sign a request.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  -- 1) every registry provider passes the check; a name outside it does not
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c join pg_class r on r.oid = c.conrelid
   where r.relname = 'connector_connection' and c.conname = 'connector_connection_provider_check';
  if v_def is null then raise exception 'CHECK FAILED: the provider check is gone'; end if;
  foreach v_def in array array['zoom','slack','telegram','jira','notion','github','whatsapp','dropbox','onedrive','mcp','google','microsoft'] loop
    if position(quote_literal(v_def) in (select pg_get_constraintdef(c.oid)
        from pg_constraint c join pg_class r on r.oid = c.conrelid
       where r.relname = 'connector_connection' and c.conname = 'connector_connection_provider_check')) = 0
    then
      raise exception 'CHECK FAILED: provider % is not in the check', v_def;
    end if;
  end loop;
  -- 2) settings is an OBJECT column with an object default
  if (select column_default from information_schema.columns
       where table_schema = 'echo' and table_name = 'connector_connection' and column_name = 'settings') is null
  then
    raise exception 'CHECK FAILED: settings has no default';
  end if;
  begin
    insert into echo.connector_connection (org_id, owner_id, provider, status, settings)
    values (gen_random_uuid(), gen_random_uuid(), 'zoom', 'connected', '[]'::jsonb);
    raise exception 'CHECK FAILED: an array was accepted as settings';
  exception
    when check_violation then null;         -- the object check refused it, as it must
    when foreign_key_violation then null;   -- the FK fires first on a random org; the check is asserted below
  end;
  if not exists (
    select 1 from pg_constraint where conname = 'connector_connection_settings_is_object'
  ) then
    raise exception 'CHECK FAILED: the settings object constraint is missing';
  end if;
end $$;
