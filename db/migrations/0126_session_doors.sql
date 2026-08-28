-- 0126 — sessions can be ENDED, and idle ones end themselves.
--
-- User directive (2026-08-28): "kebab menu comes up with right click so i
-- can end the session … when its deactive the session must automatically
-- get close … close them and add this to platform as well."
--
-- 0125 filtered the list to sessions that can still refresh — and the
-- screenshot that came back showed the truth underneath: those old rows
-- STILL held unrevoked refresh tokens, because Supabase never revokes on
-- inactivity and nobody ever signs out of a serverless probe. Filtering
-- was the lens; these two doors are the act.
--
-- ── end_my_session(handle) ──────────────────────────────────────────────
-- The caller ends ONE of their own sessions, named by the 8-char handle the
-- list already shows (the full id never leaves the wall). Deleting the
-- auth.sessions row cascades the refresh tokens, so the device's next
-- refresh simply fails and it is signed out. Scoped to the caller's own
-- user id inside the function — no argument can reach another person's
-- session, whatever it guesses.
--
-- ── close_stale_auth_sessions(days) ─────────────────────────────────────
-- The PLATFORM policy: a session neither refreshed nor created within N
-- days is dead in every sense a person cares about, and it closes. Run by
-- the worker on a timer (and callable once, now, to bury the backlog).
-- Deliberately platform-wide — this is housekeeping of the auth store,
-- not an org-scoped read, and it touches nothing but auth.sessions.

begin;

create or replace function echo.end_my_session(p_handle text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_handle is null or length(p_handle) <> 8 then
    return false;
  end if;
  delete from auth.sessions s
   where s.user_id = echo.actor_id()
     and left(s.id::text, 8) = p_handle;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

comment on function echo.end_my_session(text) is
  'D8-enumerated: the caller ends ONE of their own auth sessions by its display handle. The user_id predicate is inside the wall — no argument reaches another person''s session. Cascade takes the refresh tokens, so the device''s next refresh fails and it is signed out.';

revoke all on function echo.end_my_session(text) from public;
grant execute on function echo.end_my_session(text) to echo_app;

create or replace function echo.close_stale_auth_sessions(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  -- clamp: a caller cannot turn housekeeping into sign-everyone-out
  if p_days is null or p_days < 3 then
    p_days := 3;
  end if;
  delete from auth.sessions s
   where coalesce(s.refreshed_at, s.created_at) < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function echo.close_stale_auth_sessions(integer) is
  'M-platform session policy (2026-08-28): sessions idle beyond N days close automatically. Worker-driven; the floor of 3 days is the wall against a caller weaponising housekeeping into a mass sign-out.';

revoke all on function echo.close_stale_auth_sessions(integer) from public;
grant execute on function echo.close_stale_auth_sessions(integer) to echo_app;

commit;
