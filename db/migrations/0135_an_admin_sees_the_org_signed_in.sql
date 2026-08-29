-- 0135 — an admin can see who is signed in right now, and end a session
--        that is not their own.
--
-- User directive, 2026-08-29: a column in Management·Users showing whether
-- someone's session is active now, for admins and owners only; and the
-- Settings sessions card showing every OTHER member's sessions too, with
-- the ability to stop them.
--
-- ── the liveness predicate is not re-invented here ──────────────────────
-- "Active now" already has a definition in this schema and it was hard
-- won: 0125 replaced an age guess with the provider's own machinery — a
-- session is alive when it CAN STILL REFRESH (holds an unrevoked refresh
-- token, and `not_after` has not passed). Every function below uses that
-- same predicate. A second definition of "active" is the drift shape this
-- repo keeps paying for, and it would show two different numbers on two
-- screens describing one fact.
--
-- ── two different rules, deliberately ───────────────────────────────────
-- READING is org-wide for an admin: they get the whole picture, including
-- the owner's sessions, because a security surface that hides rows is a
-- surface nobody can reason from.
--
-- ENDING is rank-bound: `self, or someone you outrank` (0077's
-- `actor_outranks` — strictly greater rank, same org, both active). So an
-- admin cannot sign the owner out, and cannot sign a fellow admin out.
-- That is the same sentence the API-key minting door already speaks, and
-- reusing it means there is one hierarchy rule rather than two that can
-- disagree.
--
-- The split is defensible in one line: you may see the whole org, and you
-- may act only within your rank.
--
-- ── the affordance comes FROM the wall ──────────────────────────────────
-- `org_auth_sessions` returns `can_end` per row rather than leaving the
-- client to re-derive the rank rule in TypeScript. A second copy of an
-- authorization rule in the client is a copy that drifts, and the visible
-- consequence would be a Stop button that produces a refusal — the wall
-- and the affordance disagreeing in front of a user. The server answers
-- both questions in one read.
--
-- ── what CANNOT leave ───────────────────────────────────────────────────
-- The select lists are the wall, exactly as in 0112/0125/0127: handle is
-- the first 8 characters of the id, never the id itself, and no token
-- column appears in any of these functions. An admin learns that a device
-- exists, not how to be it.

begin;

-- ── who is signed in right now, one row per member ──────────────────────
-- Shaped for a JOIN against the members list rather than as a per-member
-- lookup: the Users screen would otherwise ask this question once per row.
create or replace function echo.org_session_presence()
returns table (user_id uuid, live_sessions integer, last_refresh timestamptz)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  /*
   * Loud, not empty. Returning no rows to a non-admin would render as
   * "nobody in this org is signed in" — a claim about the ORGANISATION
   * built out of a fact about the caller's PERMISSIONS, which is the
   * confusion this codebase already refuses on the connectors screen. The
   * API only joins this on the admin branch; if anything ever calls it
   * otherwise, it says so instead of lying quietly.
   */
  if not echo.actor_is_admin() then
    raise exception 'session presence is an admin''s view of their own org'
      using errcode = '42501';
  end if;

  return query
    select u.id,
           count(s.id)::integer,
           max(coalesce(s.refreshed_at, s.created_at))
      from echo.app_user u
      join auth.sessions s on s.user_id = u.id
     where u.org_id = echo.actor_org_id()
       and (s.not_after is null or s.not_after > now())
       and exists (select 1 from auth.refresh_tokens rt
                    where rt.session_id = s.id and rt.revoked = false)
     group by u.id;
end;
$$;

comment on function echo.org_session_presence() is
  'D8-enumerated (0135): one row per member of the caller''s org holding at least one LIVE auth session (0125''s predicate). Admin/owner only, and it RAISES for anyone else rather than returning an empty set that would read as "nobody is signed in". Counts and times only — no handle, no token, nothing that identifies a device.';

revoke all on function echo.org_session_presence() from public;
grant execute on function echo.org_session_presence() to echo_app;

-- ── the org's sessions, one row per session ─────────────────────────────
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
           s.refreshed_at,
           s.user_agent,
           host(s.ip),
           -- the wall answering the affordance's question, so the client
           -- never re-derives the rank rule
           (u.id = echo.actor_id() or echo.actor_outranks(u.id))
      from echo.app_user u
      join auth.sessions s on s.user_id = u.id
     where u.org_id = echo.actor_org_id()
       and u.tombstoned_at is null
       and (s.not_after is null or s.not_after > now())
       and exists (select 1 from auth.refresh_tokens rt
                    where rt.session_id = s.id and rt.revoked = false)
     order by coalesce(s.refreshed_at, s.created_at) desc
     limit 200;
end;
$$;

comment on function echo.org_auth_sessions() is
  'D8-enumerated (0135): every LIVE auth session in the caller''s org, admin/owner only. Reading is org-wide on purpose — a security surface that hides rows cannot be reasoned from — while `can_end` carries 0077''s rank rule per row so the client never re-derives it. The select list is the wall: an 8-character handle, never the session id, and no token column.';

revoke all on function echo.org_auth_sessions() from public;
grant execute on function echo.org_auth_sessions() to echo_app;

-- ── ending someone else's session ───────────────────────────────────────
create or replace function echo.end_member_session(p_user uuid, p_handle text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_handle is null or length(p_handle) <> 8 or p_user is null then
    return false;
  end if;

  /*
   * Self, or someone you outrank. `actor_outranks` already carries same-org,
   * actor-active and org-active, so this one predicate is the whole rule —
   * and it is the same one the key-minting door speaks, rather than a second
   * hierarchy that could come to disagree with it.
   *
   * It RAISES rather than returning false, because "you may not" and "there
   * was no such session" are different answers and a caller acting on the
   * second would retry forever against the first.
   */
  if not (p_user = echo.actor_id() or echo.actor_outranks(p_user)) then
    raise exception 'a session may be ended by its owner, or by someone who outranks them'
      using errcode = '42501';
  end if;

  delete from auth.sessions s
   where s.user_id = p_user
     and left(s.id::text, 8) = p_handle;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

comment on function echo.end_member_session(uuid, text) is
  'D8-enumerated (0135): ends ONE auth session belonging to the caller, or to a member the caller outranks (0077). Raises 42501 on rank rather than returning false — "you may not" and "no such session" are different answers. Cascade takes the refresh tokens, so the device''s next refresh fails and it is signed out. Reversible by construction: the person signs in again.';

revoke all on function echo.end_member_session(uuid, text) from public;
grant execute on function echo.end_member_session(uuid, text) to echo_app;

commit;
