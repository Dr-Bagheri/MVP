-- 0205 — revoke PUBLIC's execute on echo.meeting_take_status (db/0204).
--
-- 0204 granted EXECUTE to echo_app and echo_agent and stopped there, which
-- reads as a complete grant list and is not one: Postgres grants EXECUTE on a
-- new function to PUBLIC by default, so the two grants added nothing and the
-- door was open to every role on the database.
--
-- db/test/30_agent_wall.sql caught it on the first run after 0204 landed —
-- "no security-definer door in echo is PUBLIC's to call" — which is the whole
-- reason that assertion is phrased as STRUCTURE rather than as a consequence:
-- nothing about the function's behaviour was wrong, and no test of what it
-- returns could have found it. A door that simply forgets its revoke has a
-- null ACL, and a null ACL means "the defaults", and the default is PUBLIC.
--
-- It is a separate migration because 0204 is applied and checksummed. The
-- mistake stays visible, which is the point: the next person writing a
-- definer door reads both files and writes the revoke the first time.

begin;

revoke execute on function echo.meeting_take_status(uuid) from public;

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_acl aclitem[];
begin
  select p.proacl into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'meeting_take_status';

  -- A NULL acl is the trap this file exists for: it does not mean "no
  -- grants", it means "the defaults", and the default is EXECUTE to PUBLIC.
  if v_acl is null then
    raise exception '0205: the ACL is null — the revoke did not take, and null means PUBLIC may call it';
  end if;
  if has_function_privilege('public', 'echo.meeting_take_status(uuid)', 'EXECUTE') then
    raise exception '0205: PUBLIC can still execute the door';
  end if;

  -- and the two roles that MUST keep it, or the revoke has closed the
  -- product instead of the hole
  if not has_function_privilege('echo_app', 'echo.meeting_take_status(uuid)', 'EXECUTE') then
    raise exception '0205: echo_app lost its execute — the meetings list would 42501';
  end if;
  if not has_function_privilege('echo_agent', 'echo.meeting_take_status(uuid)', 'EXECUTE') then
    raise exception '0205: echo_agent lost its execute — every agent meeting read would 42501';
  end if;
end
$check$;

commit;
