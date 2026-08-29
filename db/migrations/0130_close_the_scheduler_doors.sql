-- 0130 — the scheduler doors learn who is knocking, and the delete door
--        stops being open to everyone.
--
-- From the 2026-08-29 audit (docs/AUDIT-2026-08-29.md, S3 and S4), both
-- verified against the live catalogue before this file was written.
--
-- ── S3: the agent could execute a DELETE ────────────────────────────────
-- `delete_summary_version` (0095) is the ONLY security-definer function in
-- 129 migrations that never revoked PUBLIC's default EXECUTE. Its proacl
-- read `{=X/postgres, …}` — that leading `=` is PUBLIC, and PUBLIC includes
-- echo_agent, which holds USAGE on this schema. Of 72 definer doors the
-- agent may execute 14, and this was the only DELETE-bearing one.
--
-- The door's own guard is `owns_call(p_call) or (can_read_call and
-- actor_is_admin)`, and `owns_call` keys off echo.actor_id() — the same GUC
-- the agent connection carries, because the agent RUNS AS the call's owner
-- (M3/M7). So the guard was satisfied by construction. Nothing calls it from
-- an agent path today; M3's absolute — "the agent's role has no DELETE
-- anywhere" — is a wall, and a wall is judged by what it would stop.
--
-- ── S4: six doors that never asked who was calling ──────────────────────
-- Six definer functions run as `postgres` (which bypasses RLS), are granted
-- to echo_app, and scope by nothing but the caller-supplied id. The sharpest
-- was `set_mail_cursor`: any echo_app caller could write a cursor onto ANY
-- connection on the platform and permanently silence another org member's
-- mail drafting, because `due_mail_polls` filters on that cursor's freshness.
--
-- WHY THEY LOOK LIKE THIS, and why the obvious fix would have broken them:
-- every legitimate caller is the WORKER, which calls through
-- `db.withoutIdentity` — no actor is set, so `echo.actor_id()` is NULL.
-- Adding a bare `and owner_id = echo.actor_id()` would have refused the only
-- caller these functions have. The guard therefore has to say something
-- narrower and true:
--
--     if an actor IS set, it must own the row.
--
-- A scheduler call (no identity) passes exactly as before. A request-borne
-- call always carries an identity — the api sets it on every transaction —
-- so a member can now only ever reach their own connection, schedule or
-- rule. That is the whole distance between "which TypeScript file ran" and
-- a wall, which is the distance M3 is about.
--
-- `close_stale_auth_sessions` has no owner column to key on — it is
-- platform-wide housekeeping — so it takes the same shape one rung up: a
-- caller with an identity must be platform root.
--
-- The pattern is not invented here. `workflow_graph_for_run` (0107:27)
-- already carries `and r.owner_id = echo.actor_id()`; these six skipped it.

begin;

-- ── S3 ──────────────────────────────────────────────────────────────────
revoke all on function echo.delete_summary_version(uuid, integer) from public;
-- the grant that was always meant to be the only one
grant execute on function echo.delete_summary_version(uuid, integer) to echo_app;

comment on function echo.delete_summary_version(uuid, integer) is
  'M11/D3 (D8-enumerated): removes one summary version for a call the caller owns, or an admin may read. 0130 revoked PUBLIC''s default EXECUTE — without it echo_agent could reach this door, and the agent runs as the call''s owner, so the door''s own guard would have opened.';

-- ── S4: the five row-scoped doors ───────────────────────────────────────

create or replace function echo.set_mail_cursor(
  p_id uuid, p_cursor text, p_seen integer, p_at timestamptz
) returns void
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection c
     set mail_cursor = p_cursor,
         -- null only where the provider gave no date; the id still moves, so
         -- a mailbox whose headers we cannot read is no worse off than before
         mail_cursor_at = p_at,
         messages_seen = c.messages_seen + greatest(0, coalesce(p_seen, 0))
   where c.id = p_id
     -- 0130: the scheduler (no identity) passes; a caller who HAS an
     -- identity may only move their own mailbox's cursor
     and (echo.actor_id() is null or c.owner_id = echo.actor_id())
$$;

create or replace function echo.claim_mail_poll(p_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection c
     set polled_at = now()
   where c.id = p_id
     and c.status = 'connected'
     and (c.polled_at is null or c.polled_at < now() - interval '2 minutes')
     and (echo.actor_id() is null or c.owner_id = echo.actor_id())   -- 0130
  returning true
$$;

create or replace function echo.claim_meeting_poll(p_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection c
     set calendar_polled_at = now()
   where c.id = p_id
     and c.status = 'connected'
     and (c.calendar_polled_at is null
          or c.calendar_polled_at < now() - interval '5 minutes')
     and (echo.actor_id() is null or c.owner_id = echo.actor_id())   -- 0130
  returning true
$$;

create or replace function echo.claim_workflow_fire(p_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.workflow_schedule s
     set last_fired_at = now(),
         next_due = greatest(
           s.next_due + case s.cadence
             when 'daily' then interval '1 day'
             when 'weekly' then interval '7 days'
             else interval '1 month' end,
           now())
   where s.id = p_id and s.enabled and s.next_due <= now()
     and (echo.actor_id() is null or s.owner_id = echo.actor_id())   -- 0130
  returning true
$$;

create or replace function echo.mark_agent_rule_fired(p_rule uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update echo.agent_rule r
     set last_fired_at = now()
   where r.id = p_rule
     and (echo.actor_id() is null or r.owner_id = echo.actor_id())   -- 0130
$$;

-- ── S4: the platform-wide one ───────────────────────────────────────────

create or replace function echo.close_stale_auth_sessions(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  /*
   * 0130: platform-wide housekeeping has no owner to key on, so the rule is
   * one rung up — the scheduler (no identity) may run it; a caller who HAS
   * an identity must be platform root. Before this, any echo_app caller
   * could sign out every user on the platform idle >= 3 days.
   */
  if echo.actor_id() is not null and not echo.actor_is_platform_root() then
    raise exception 'close_stale_auth_sessions is platform housekeeping'
      using errcode = '42501';
  end if;
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
  'M-platform session policy: sessions idle beyond N days close automatically. Worker-driven (no identity); an identity-bearing caller must be platform root (0130). The floor of 3 days is the wall against weaponising housekeeping into a mass sign-out.';

commit;
