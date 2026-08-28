-- 0125 — the sessions list stops presenting the dead as the living.
--
-- User report (2026-08-28): "we dont have this many active session, put the
-- only one that are active now." 0112's door selected the caller's rows
-- from auth.sessions with no liveness predicate — and Supabase keeps a
-- session row long after its refresh token dies, so every sign-in this
-- account ever made rendered under "devices currently signed in".
--
-- "Active" gets a real definition instead of an age guess: a session is
-- alive when it CAN STILL REFRESH — it holds at least one unrevoked
-- refresh token and its not_after (when set) has not passed. That is the
-- provider's own machinery for ending a session, read rather than
-- approximated; a seven-day age cutoff would be a belief about token TTLs
-- wearing a fact's costume.

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
         s.user_agent, s.ip::text
    from auth.sessions s
   where s.user_id = echo.actor_id()
     and (s.not_after is null or s.not_after > now())
     and exists (select 1 from auth.refresh_tokens rt
                  where rt.session_id = s.id and rt.revoked = false)
   order by coalesce(s.refreshed_at, s.created_at) desc
   limit 20
$$;

comment on function echo.my_auth_sessions() is
  'D8-enumerated: the caller''s LIVE auth sessions — rows that can still refresh (unrevoked token, not_after unexpired). The select list is the wall: no token column can leave this function. 0125 added the liveness predicate; before it, every sign-in ever made rendered as a current device.';

commit;
