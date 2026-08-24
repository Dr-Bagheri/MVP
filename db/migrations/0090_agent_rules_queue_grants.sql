-- Echo — 0090: grants for the echo_agent_rules queue — THE WATCHTOWER'S
-- FIRST CATCH (2026-08-24, within minutes of it going live).
--
-- 0074 created the M35 signals queue and granted nothing on its tables.
-- "grant ... on all tables in schema pgmq" (0017, re-issued 0019) covers
-- only tables that EXIST when it runs — the very trap 0019's own comment
-- names — so q_echo_agent_rules was born grantless. The result, live on
-- production: the worker's poll pass failed with 42501 EVERY TWO SECONDS,
-- the M35 signals lane was silently dead, and the journal absorbed it all
-- where nobody looks. The queue existed, the handler existed, and the
-- grant between them didn't — rule 13½'s shape, one layer down.
--
-- Two fixes, deliberately both:
--  1. re-issue the blanket grants (idempotent; catches this queue and any
--     other pgmq table born since 0019);
--  2. DEFAULT PRIVILEGES, so the NEXT queue is born granted and this
--     migration is the last of its kind — the structural fix, not the
--     third re-issue.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'pgmq absent on this server — nothing to grant here';
    return;
  end if;
  execute 'grant usage on schema pgmq to echo_app';
  execute 'grant select, insert, update, delete on all tables in schema pgmq to echo_app';
  execute 'grant execute on all functions in schema pgmq to echo_app';
  -- future queue tables created by the migration role arrive granted
  execute 'alter default privileges in schema pgmq grant select, insert, update, delete on tables to echo_app';
end;
$$;
