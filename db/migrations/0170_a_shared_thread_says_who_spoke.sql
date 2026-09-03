-- 0170 — a shared thread says who spoke
--
-- 0169 gave `agent_message` an `author`, so a colleague Echo called into a
-- conversation keeps its own name on its own words. The ORDINARY thread read
-- is a query in api/sessions.ts and learned the column by being edited; the
-- SHARED one is `echo.shared_session_thread`, a definer door whose
-- `returns table (...)` is a CONTRACT — selecting a column the signature does
-- not declare is a 42703, and only somebody who has shared a conversation would
-- ever reach it.
--
-- Left alone, a shared conversation would render Roya's paragraph with Echo's
-- name on it: the exact misattribution the author column exists to prevent,
-- surviving on the one surface where the reader is a colleague who was not
-- there and has no other way to tell.
--
-- 0152's lesson, applied without having to rediscover it: widening the SELECT
-- inside a definer without widening its signature is a failure no test in this
-- repo can see, because reaching it needs a shared session and a platform-root
-- eye. DROP then CREATE — `create or replace` cannot change a return type —
-- and the drop takes the grant with it, so the grant is re-issued below.

begin;

drop function if exists echo.shared_session_thread(uuid);

create function echo.shared_session_thread(target_session uuid)
  returns table (id uuid, seq integer, role echo.agent_message_role,
                 content text, tool_calls jsonb, agent_run_id uuid,
                 truncated boolean, author text, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.id, m.seq, m.role, m.content, m.tool_calls, m.agent_run_id,
         coalesce(m.truncated,
                  echo.run_is_truncated(r.status, r.started_at)) as truncated,
         m.author,
         m.created_at
    from echo.agent_message m
    left join echo.agent_run r on r.id = m.agent_run_id
    join echo.agent_session_share sh on sh.session_id = m.session_id
   where m.session_id = target_session
     and sh.revoked_at is null
     and echo.actor_is_active()
     and sh.org_id = echo.actor_org_id()
   order by m.seq;
$$;

revoke all on function echo.shared_session_thread(uuid) from public;
grant execute on function echo.shared_session_thread(uuid) to echo_app;

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare v_cols text[]; v_grants int;
begin
  -- exactly one function, not two overloads (0132's finding: `create or
  -- replace` installs a second one beside the real one rather than refusing)
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo' and p.proname = 'shared_session_thread') <> 1 then
    raise exception 'CHECK FAILED: shared_session_thread is not exactly one function';
  end if;

  -- the signature declares author, in the position the caller reads
  select proallargtypes::oid[]::regtype[]::text[] into v_cols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'shared_session_thread';
  if not exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(p.proargnames) as an(name)
    where n.nspname = 'echo' and p.proname = 'shared_session_thread'
      and an.name = 'author'
  ) then
    raise exception 'CHECK FAILED: the signature does not declare author';
  end if;

  -- the grant came back with the recreate — a drop takes it, and a door
  -- nobody may open is the same as a door that is not there
  select count(*) into v_grants
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'echo' and p.proname = 'shared_session_thread'
     and a.privilege_type = 'EXECUTE' and r.rolname = 'echo_app';
  if v_grants <> 1 then
    raise exception 'CHECK FAILED: echo_app cannot execute shared_session_thread (% grants)', v_grants;
  end if;
end $chk$;

commit;
