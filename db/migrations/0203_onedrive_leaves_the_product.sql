-- 0203 — OneDrive leaves the product (user directive, 2026-09-07: "remove one
-- drive . i dont want microsoft apps").
--
-- OneDrive was the one connector on the shelf that required an Azure app
-- registration, and the operator does not want one. The provider is gone from
-- the registry, from the web catalogue, from the vocabulary and from the
-- shipping script; this migration takes it out of the database's own list.
--
-- Why the check has to move WITH the code and not after it: db/0199's comment
-- says the provider check "names the same names" as core's
-- CONNECTOR_PROVIDERS, and core/test/connector-providers.test.ts ASSERTS that
-- equality by reading the migration. So a narrowing in one place without the
-- other is a red test rather than a quiet drift — which is the arrangement
-- working, and the reason to spend a migration on a value nothing writes.
--
-- Safe to narrow, read at OWNER altitude before this was written (a CHECK
-- cannot be added under a row that violates it, and "I counted none" from
-- below the wall is not "there are none"): echo.connector_connection held
-- google x2, slack x1, zoom x1 — no onedrive row has ever existed, because
-- the pair was never configured on any deployment.
--
-- MICROSOFT STAYS in the check, deliberately. Its mail/calendar adapter is
-- still in core and has never been OFFERED (2026-08-28, "we just go with the
-- google"), so no shelf tile asks anyone to register with Microsoft — but a
-- name whose adapter still exists is not the same as a name nothing can
-- produce, and this check is about the second kind.

begin;

alter table echo.connector_connection
  drop constraint connector_connection_provider_check;

alter table echo.connector_connection
  add constraint connector_connection_provider_check
    check (provider in (
      'google', 'microsoft',
      'zoom', 'slack', 'telegram', 'jira', 'notion', 'github', 'whatsapp', 'dropbox', 'mcp'
    ));

comment on constraint connector_connection_provider_check on echo.connector_connection is
  'Exactly core''s CONNECTOR_PROVIDERS (core/src/api/vocabulary.ts), asserted by core/test/connector-providers.test.ts against whichever migration last defined this check. OneDrive left on 2026-09-07.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_def  text;
  v_name text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c join pg_class r on r.oid = c.conrelid
   where r.relname = 'connector_connection'
     and c.conname = 'connector_connection_provider_check';
  if v_def is null then
    raise exception '0203: the provider check is gone';
  end if;

  -- 1) every provider the product still speaks is permitted
  foreach v_name in array array[
    'google','microsoft','zoom','slack','telegram','jira','notion','github','whatsapp','dropbox','mcp'
  ] loop
    if position(quote_literal(v_name) in v_def) = 0 then
      raise exception '0203: provider % is not in the check', v_name;
    end if;
  end loop;

  -- 2) THE DISCRIMINATING HALF. Without this, the loop above passes against
  --    the wider check this migration exists to narrow — a question that
  --    could only ever have been answered yes.
  if position(quote_literal('onedrive') in v_def) > 0 then
    raise exception '0203: onedrive is still permitted — the check was not narrowed';
  end if;

  -- 3) and the wall itself refuses one, rather than the catalogue merely
  --    reading right: a bogus row is attempted and must fail 23514.
  --    Every column is named explicitly (id included) so the only thing this
  --    row can be refused FOR is the provider: a missing default or a renamed
  --    column would raise something else, and "a red that names a different
  --    defect is not a verify-red".
  begin
    insert into echo.connector_connection (id, org_id, owner_id, provider, status)
    values ('00000000-0000-4000-8000-0000000d0203',
            '00000000-0000-4000-8000-00000000dead',
            '00000000-0000-4000-8000-00000000beef', 'onedrive', 'connected');
    raise exception '0203: an onedrive connection was ACCEPTED';
  exception
    when check_violation then null;              -- the check fired: what we want
    when foreign_key_violation then
      raise exception '0203: the check did not fire — the row reached its FKs, so onedrive is still permitted';
    when insufficient_privilege then null;       -- running below the wall; (1) and (2) still stand
  end;
end
$check$;

commit;
