-- 0140 — a session is online when its owner is, not when its token last
--        rotated.
--
-- User, looking at their own device in the org sessions table: "why im
-- offline still, am i online".
--
-- ── the measurement ─────────────────────────────────────────────────────
-- Their one live session, at the moment they asked:
--
--   session refreshed   36 minutes ago
--   person seen          4 minutes ago
--
-- 0138 read the SESSION's own clock, so the row said Offline about a device
-- the person was actively looking at.
--
-- ── why that clock was the wrong one ────────────────────────────────────
-- `auth.sessions.refreshed_at` moves when the ACCESS TOKEN rotates, and
-- GoTrue rotates roughly hourly. It is a measure of token age, not of
-- presence: a session in continuous use sits untouched for up to an hour
-- between refreshes, so "heard from in the last five minutes" is a question
-- it simply cannot answer. Reading it as presence made a stale answer look
-- like a precise one.
--
-- `app_user.last_seen_at` is written by our own request path — it moves when
-- a person actually uses the product, and deliberately not for gateway-key
-- traffic, so a polling integration cannot make its owner look present. It
-- is the only presence signal this system has.
--
-- ── what 0138 got right, and what it got wrong ──────────────────────────
-- Right: online means recent ACTIVITY, not "could still refresh". That part
-- stands and the window is unchanged.
--
-- Wrong: the claim that a session and a person are different subjects and
-- may honestly disagree. They are different subjects — but we cannot
-- measure the device one. Nothing tells us which of someone's three
-- browsers made the last request. So the choice was never "per-device or
-- per-person"; it was "per-person, or a number that means token age wearing
-- presence's name". A person with three devices now shows three online
-- rows, which is the honest reading of what we know: this person is here.
-- It is stated in the comment rather than left for a reader to infer from a
-- surprising screen.

begin;

create or replace function echo.org_auth_sessions()
returns table (user_id uuid, handle text, created_at timestamptz,
               refreshed_at timestamptz, user_agent text, ip text,
               can_end boolean, online boolean)
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
           (u.id = echo.actor_id() or echo.actor_outranks(u.id)),
           -- the PERSON's activity: see the header for why the session's own
           -- refresh cannot answer this
           u.last_seen_at > now() - echo.online_window()
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
  'D8-enumerated (0135, typed 0136, online 0138, corrected 0140): every session in the caller''s org that CAN STILL REFRESH — the security question, and still the filter, because a device that can get in belongs on a list of devices. `online` is the OWNER''s activity inside echo.online_window(), not the session''s refresh: GoTrue rotates a token roughly hourly, so refreshed_at measures token age and cannot answer presence. `can_end` carries 0077''s rank rule per row. The select list is the wall: an 8-character handle, never the session id, and no token column.';

revoke all on function echo.org_auth_sessions() from public;
grant execute on function echo.org_auth_sessions() to echo_app;

commit;
