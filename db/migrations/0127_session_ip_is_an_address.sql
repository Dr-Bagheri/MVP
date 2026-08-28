-- 0127 — the sessions door serves an ADDRESS, not a network.
--
-- Found by 96_personal_settings going red after 0125: the door's
-- `s.ip::text` renders `203.0.113.7/32` on this project — the stored
-- values carry their mask — and the same suffix was sitting in the
-- product UI (visible in the user's own screenshot of the sessions
-- table). Nobody reads a device row and wants a netmask; `host()` is the
-- address alone, for inet and cidr alike.

begin;

create or replace function echo.my_auth_sessions()
returns table (handle text, created_at timestamptz, refreshed_at timestamptz,
               user_agent text, ip text)
language sql
security definer
set search_path = ''
stable
as $$
  select left(s.id::text, 8), s.created_at, s.refreshed_at,
         s.user_agent, host(s.ip)
    from auth.sessions s
   where s.user_id = echo.actor_id()
     and (s.not_after is null or s.not_after > now())
     and exists (select 1 from auth.refresh_tokens rt
                  where rt.session_id = s.id and rt.revoked = false)
   order by coalesce(s.refreshed_at, s.created_at) desc
   limit 20
$$;

comment on function echo.my_auth_sessions() is
  'D8-enumerated: the caller''s LIVE auth sessions (0125''s liveness predicate) with ip as a bare address (0127). The select list is the wall: no token column can leave this function.';

commit;
