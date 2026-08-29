-- 0138 — "online" stops meaning "could still sign in".
--
-- User report, 2026-08-29, with the screen in front of them: the sessions
-- table listed seventeen live sessions across seven people, and "right now
-- from this list only me is online".
--
-- They were right, and the numbers say so plainly. Measured at owner
-- altitude, minutes ago, for every session the screen was calling live:
--
--   drbagheri            created   60   refreshed    1   last_seen    1
--   Sina Sepasi          created 10674  refreshed   60   last_seen   51
--   samanehghanii        created  316   refreshed  190   last_seen  190
--   Omid Farhang         created  225   refreshed    —   last_seen  195
--   Omid Farhang         created  226   refreshed    —   last_seen  195
--   … eleven more, every one of them refreshed  —  or 250+
--
-- Two things fall out of that table. Eleven of the seventeen have NEVER
-- been refreshed — they are repeat sign-ins that never came back, four of
-- them belonging to one person. And the gap between the one person who is
-- here (1 minute) and the next (51) is so wide that no threshold in that
-- range is a judgement call.
--
-- ── what was wrong with the old definition ──────────────────────────────
-- 0125 replaced an age guess with "can this session still refresh", which
-- was a real improvement and is still the right question for the SECURITY
-- list — a device that can still refresh can still get in, and that is what
-- a person auditing their devices needs to see. It is simply not the same
-- question as "is anyone there", and a refresh token stays valid for weeks
-- after a laptop is closed. Two different questions had one answer.
--
-- ── one definition, one place ───────────────────────────────────────────
-- `online_window()` exists so the members list and the sessions list cannot
-- drift into two thresholds. Five minutes, and the data above is why it is
-- not a nervous number: the nearest neighbour to the boundary is ten times
-- away from it in either direction.
--
-- ── two subjects, and they are not the same subject ─────────────────────
-- A PERSON is online when `app_user.last_seen_at` is inside the window —
-- our own request path writes it, so it moves when someone actually uses
-- the product, and deliberately not for gateway-key traffic (a polling
-- integration must not make its owner look permanently present).
--
-- A SESSION is online when its OWN last sign of life is inside the window.
-- These can disagree — someone active on a phone leaves the laptop's row
-- offline — and that is correct rather than a bug to reconcile: the row is
-- about a device, and the column beside it is about a person.
--
-- ── and `org_session_presence()` is dropped ─────────────────────────────
-- It answered "does this member hold a session that could still refresh",
-- which is exactly the question that turned out not to mean online. Its
-- replacement is one expression on a column the members query already
-- reads, so the function has no consumer left — and a producer with no
-- consumer is the defect this repo has spent the week removing. It goes
-- rather than sits.

begin;

create or replace function echo.online_window()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '5 minutes' $$;

comment on function echo.online_window() is
  'How recently something must have been seen to count as online (0138). ONE definition, so the members list and the sessions list cannot drift into two thresholds. Five minutes: measured, not guessed — the nearest real activity to the boundary sat ten times away from it on both sides.';

revoke all on function echo.online_window() from public;
grant execute on function echo.online_window() to echo_app;

-- the sessions door gains the per-session answer.
--
-- DROP first: `create or replace` refuses to change a function's return
-- type, and this one gains a column. The drop and the create are in one
-- transaction, so there is no moment when the door is missing.
drop function if exists echo.org_auth_sessions();

create function echo.org_auth_sessions()
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
           /*
            * The SESSION's own last sign of life, not its owner's. A row
            * here is a device, and "this person is active somewhere" is a
            * different claim from "this device spoke to us recently".
            */
           coalesce(s.refreshed_at at time zone 'utc', s.created_at)
             > now() - echo.online_window()
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
  'D8-enumerated (0135, typed 0136, online 0138): every session in the caller''s org that CAN STILL REFRESH — the security question, deliberately still the filter, because a device that can get in belongs on a list of devices. `online` says separately whether it has been heard from inside echo.online_window(). `can_end` carries 0077''s rank rule per row. The select list is the wall: an 8-character handle, never the session id, and no token column.';

revoke all on function echo.org_auth_sessions() from public;
grant execute on function echo.org_auth_sessions() to echo_app;

drop function if exists echo.org_session_presence();

commit;
