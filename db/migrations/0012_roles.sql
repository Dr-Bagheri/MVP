-- Echo — 0012: the database roles (M3, bottom layer of the stack).
--
-- Three roles, each defined by what it CANNOT do:
--   echo_app    — core/ api + worker. Full product access, subject to RLS.
--                 Holds no DELETE anywhere: deletion in this product is soft.
--   echo_agent  — the agent runtime's tool calls. Reads what its caller can
--                 read; writes exactly three things, column by column; holds
--                 NO DELETE on any table in any schema. This is the grant
--                 that makes "the agent deletes nothing, ever" (M11) a
--                 property of the database rather than a promise about prompts.
--   echo_purge  — the 30-day hard purge, and nothing else. The only role in
--                 the system with DELETE, and its policies let it delete only
--                 rows whose purge window has already expired.
--
-- Created NOLOGIN and passwordless on purpose. Passwords are secrets and
-- never appear in a migration (invariant 7); the operator grants LOGIN and a
-- password out of band — see db/scripts/grant-login.mjs, which reads env.
--
-- NOBYPASSRLS is stated explicitly on all three. It is the default, but this
-- is the one place where a silent default change would quietly remove the
-- wall, so we say it out loud and 0013's tests assert it.

do $$
declare
  r text;
begin
  foreach r in array array['echo_app', 'echo_agent', 'echo_purge'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'create role %I nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
        r
      );
    else
      execute format(
        'alter role %I nosuperuser nocreatedb nocreaterole nobypassrls',
        r
      );
    end if;
  end loop;
end;
$$;

-- (No COMMENT ON ROLE here: it requires superuser, which the migration role
-- on managed Supabase is not. The roles are documented above instead.)
