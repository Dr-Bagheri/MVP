-- NeurAI Platform — 0071: close the migration ledger's PostgREST surface.
--
-- Supabase's linter flagged it (2026-08-20, CRITICAL): public.echo_migration
-- — the migration ledger db.mjs maintains — lives in the `public` schema,
-- which Supabase exposes through its Data API, and it had no RLS. The table
-- holds versions + checksums (no tenant data, no secrets), but on a Supabase
-- database the default privileges hand `anon`/`authenticated` access to new
-- public tables, so anyone holding the public anon key could READ the ledger
-- (schema-evolution intel) and potentially WRITE it — and a tampered ledger
-- sabotages every future migration ("changed after it was applied").
--
-- Fix: revoke the API roles and enable RLS with no policies. ENABLE, not
-- FORCE, deliberately: the ledger's only legitimate client is the OWNER-run
-- migration tool itself, and FORCE with zero policies would lock the runner
-- out of its own ledger. RLS here exists to close the PostgREST surface,
-- not to constrain the owner. (db/test/50's every-table tripwire counts only
-- the echo schema, so this table sits outside its corpus — hence the linter,
-- not the suite, caught it.)
--
-- The revokes are role-conditional because `anon`/`authenticated` exist on
-- Supabase but not on the local test container — a bare revoke would fail
-- there with 42704.

revoke all on table public.echo_migration from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.echo_migration from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.echo_migration from authenticated;
  end if;
end $$;

alter table public.echo_migration enable row level security;
