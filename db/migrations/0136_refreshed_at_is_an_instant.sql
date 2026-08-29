-- 0136 — `refreshed_at` becomes an instant the same way everywhere, and
--        0135's org sessions door starts working.
--
-- ── the failure ─────────────────────────────────────────────────────────
-- 0135's `org_auth_sessions()` raised on every call:
--
--     42804  structure of query does not match function result type
--
-- `auth.sessions.refreshed_at` is `timestamp WITHOUT time zone`, and the
-- function declares `timestamptz`. Postgres coerces that silently in a
-- LANGUAGE SQL body and refuses it in plpgsql's `RETURN QUERY`, which is
-- why `my_auth_sessions()` — same column, same declared type, written in
-- SQL — has worked since 0112 while the new one could not run once.
--
-- Worth stating plainly because it is the kind of thing that reads as a
-- language quirk and is really a type error the SQL version was hiding.
--
-- ── the part that outlives the bug ──────────────────────────────────────
-- Fixing it needs a decision, not a cast: a naive timestamp becomes an
-- instant only by choosing a zone. Two spellings were available.
--
--   `s.refreshed_at::timestamptz`         — reads it in the SESSION's zone
--   `s.refreshed_at at time zone 'utc'`   — reads it as UTC, always
--
-- They agree on this database and only because `SHOW timezone` is UTC —
-- measured, not assumed. The first spelling is therefore correct by
-- coincidence: set a connection to Asia/Tehran and every session time on
-- the security screen shifts by three and a half hours, with nothing
-- anywhere to say why. GoTrue writes these columns in UTC, so the second
-- spelling states the fact instead of depending on a setting.
--
-- `my_auth_sessions()` is moved to the same spelling in this file rather
-- than left alone. It produces the identical value today, so this changes
-- no behaviour — but leaving it would be two spellings of one fact, in two
-- functions that answer the same question on two screens, which is the
-- drift this repo keeps paying for. One spelling, one meaning.

begin;

create or replace function echo.org_auth_sessions()
returns table (user_id uuid, handle text, created_at timestamptz,
               refreshed_at timestamptz, user_agent text, ip text,
               can_end boolean)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not echo.actor_is_admin() then
    raise exception 'the org''s sessions are an admin''s view'
      using errcode = '42501';
  end if;

  return query
    select u.id,
           left(s.id::text, 8),
           s.created_at,
           (s.refreshed_at at time zone 'utc'),
           s.user_agent,
           host(s.ip),
           (u.id = echo.actor_id() or echo.actor_outranks(u.id))
      from echo.app_user u
      join auth.sessions s on s.user_id = u.id
     where u.org_id = echo.actor_org_id()
       and u.tombstoned_at is null
       and (s.not_after is null or s.not_after > now())
       and exists (select 1 from auth.refresh_tokens rt
                    where rt.session_id = s.id and rt.revoked = false)
     order by coalesce(s.refreshed_at at time zone 'utc', s.created_at) desc
     limit 200;
end;
$$;

comment on function echo.org_auth_sessions() is
  'D8-enumerated (0135, typed in 0136): every LIVE auth session in the caller''s org, admin/owner only. Reading is org-wide on purpose — a security surface that hides rows cannot be reasoned from — while `can_end` carries 0077''s rank rule per row so the client never re-derives it. The select list is the wall: an 8-character handle, never the session id, and no token column.';

revoke all on function echo.org_auth_sessions() from public;
grant execute on function echo.org_auth_sessions() to echo_app;

-- the same spelling in the presence door: it reached timestamptz through
-- `coalesce(naive, tz)`, which is the session-zone cast wearing a coalesce
create or replace function echo.org_session_presence()
returns table (user_id uuid, live_sessions integer, last_refresh timestamptz)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not echo.actor_is_admin() then
    raise exception 'session presence is an admin''s view of their own org'
      using errcode = '42501';
  end if;

  return query
    select u.id,
           count(s.id)::integer,
           max(coalesce(s.refreshed_at at time zone 'utc', s.created_at))
      from echo.app_user u
      join auth.sessions s on s.user_id = u.id
     where u.org_id = echo.actor_org_id()
       and u.tombstoned_at is null
       and (s.not_after is null or s.not_after > now())
       and exists (select 1 from auth.refresh_tokens rt
                    where rt.session_id = s.id and rt.revoked = false)
     group by u.id;
end;
$$;

revoke all on function echo.org_session_presence() from public;
grant execute on function echo.org_session_presence() to echo_app;

-- and the caller's own list, so one fact has one spelling
create or replace function echo.my_auth_sessions()
returns table (handle text, created_at timestamptz, refreshed_at timestamptz,
               user_agent text, ip text)
language sql
security definer
set search_path = ''
stable
as $$
  select left(s.id::text, 8), s.created_at,
         (s.refreshed_at at time zone 'utc'),
         s.user_agent, host(s.ip)
    from auth.sessions s
   where s.user_id = echo.actor_id()
     and (s.not_after is null or s.not_after > now())
     and exists (select 1 from auth.refresh_tokens rt
                  where rt.session_id = s.id and rt.revoked = false)
   order by coalesce(s.refreshed_at at time zone 'utc', s.created_at) desc
   limit 20
$$;

comment on function echo.my_auth_sessions() is
  'D8-enumerated: the caller''s LIVE auth sessions (0125''s liveness predicate) with ip as a bare address (0127) and refreshed_at read as UTC rather than in the session''s zone (0136). The select list is the wall: no token column can leave this function.';

commit;
