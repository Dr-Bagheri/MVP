-- Echo — 0018: steward line-review fixes.
--
-- Two required, four tightenings, one product answer. Migrations are
-- append-only, so these arrive as a new file rather than edits to 0008/0011/
-- 0013/0016 — the dev project already has those applied and checksummed.

-- ---------------------------------------------------------------------------
-- FIX 1 (required) — the purge job could deadlock against a conversation.
--
-- echo.agent_message.agent_run_id had no ON DELETE action, while the purge
-- role deletes call-linked agent_runs. The first time someone asks the
-- assistant about a call (the run gets a call_id, the message records the
-- run) and that call later expires, the purge fails on a foreign key and the
-- call outlives its window — M11 broken operationally, not theoretically.
--
-- Same shape and same answer as call.current_summary_id in 0008: the
-- referential action runs as the table owner, so echo_purge still needs no
-- privilege on agent_message.
--
-- What survives is the fact that a conversation happened, with its link to
-- purged material cut. See db/DECISIONS.md Q5: whether message TEXT that
-- quoted a purged call should itself be purged is a product question this
-- migration deliberately does not answer.
-- ---------------------------------------------------------------------------

alter table echo.agent_message
  drop constraint agent_message_agent_run_id_fkey;

alter table echo.agent_message
  add constraint agent_message_agent_run_id_fkey
  foreign key (agent_run_id) references echo.agent_run(id) on delete set null;

-- ---------------------------------------------------------------------------
-- FIX 2 (required) — the current-summary pointer is the owner's to move.
--
-- Under Q4 as ratified (reads everything, rewrites nothing — for human admins
-- exactly as for the agent), WHICH version of a summary is presented is part
-- of the record. A non-owner re-pointing it is a rewrite, even though nothing
-- is destroyed and the cross-call guard already holds.
--
-- The 0008 pointer trigger is unaffected: it is definer-owned and runs on the
-- owner's own summary insert.
-- ---------------------------------------------------------------------------

create or replace function echo.tg_call_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
  -- Same seam as the app_user guard (D13): the ownership rules govern
  -- application connections. Without this, adding current_summary_id to the
  -- blocked list below would block the 0008 pointer trigger itself — it is
  -- SECURITY DEFINER, so it arrives here as the owner with no product
  -- identity attached, looking exactly like a non-owner rewriting the record.
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if new.org_id is distinct from old.org_id or new.owner_id is distinct from old.owner_id then
    raise exception 'a call cannot change org or owner'
      using errcode = 'check_violation';
  end if;

  if new.current_summary_id is distinct from old.current_summary_id
     and new.current_summary_id is not null
     and not exists (
       select 1 from echo.summary s
       where s.id = new.current_summary_id and s.call_id = new.id
     ) then
    raise exception 'a call''s current summary must be one of its own versions'
      using errcode = 'check_violation';
  end if;

  -- An admin may delete any recording (M11) but may not rewrite one they do
  -- not own. The worker is not an exception: it runs as the call's owner (M3).
  if from_app and old.owner_id is distinct from actor then
    if new.title          is distinct from old.title
    or new.scope          is distinct from old.scope
    or new.language       is distinct from old.language
    or new.source         is distinct from old.source
    or new.started_at     is distinct from old.started_at
    or new.status         is distinct from old.status
    or new.duration_ms    is distinct from old.duration_ms
    or new.failure_reason is distinct from old.failure_reason
    -- which version is presented is part of the record, so it belongs here
    or new.current_summary_id is distinct from old.current_summary_id then
      raise exception 'only the owner may modify a call; others may archive, delete or restore it'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at  := now();
    new.deleted_by  := actor;
    new.purge_after := now() + echo.purge_window();
  elsif new.deleted_at is null and old.deleted_at is not null then
    new.deleted_by  := null;
    new.purge_after := null;
  elsif new.deleted_at is not null then
    new.deleted_at  := old.deleted_at;
    new.deleted_by  := old.deleted_by;
    new.purge_after := old.purge_after;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nit (a) — "advanced, never rewritten" made literal.
--
-- The old check only refused a SHORTER steps array, so a run could keep its
-- length and have its history replaced wholesale. Invariant 5 says runs are
-- replayable; that only means anything if what already happened is fixed.
-- ---------------------------------------------------------------------------

create or replace function echo.tg_agent_run_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.org_id   is distinct from old.org_id
  or new.actor_id is distinct from old.actor_id
  or new.call_id  is distinct from old.call_id
  or new.skill_id is distinct from old.skill_id
  or new.kind     is distinct from old.kind
  or new.model    is distinct from old.model
  or new.request  is distinct from old.request
  or new.started_at is distinct from old.started_at then
    raise exception 'an agent run cannot be rewritten, only advanced'
      using errcode = 'insufficient_privilege';
  end if;

  -- Steps append: what is already there must still be there, in order, as a
  -- prefix of what is being written.
  if new.steps is distinct from old.steps then
    if (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
          from jsonb_array_elements(new.steps) with ordinality as t(e, ord)
         where ord <= jsonb_array_length(old.steps))
       is distinct from old.steps then
      raise exception 'agent run steps are append-only'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if old.status <> 'running' then
    raise exception 'a finished agent run is closed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nit (b) — link provenance cannot be overwritten in passing.
--
-- When person_id does not change, linked_by/linked_at were passed through as
-- supplied, so a table-wide UPDATE could rewrite who linked a voice and when
-- without ever touching the link itself.
-- ---------------------------------------------------------------------------

create or replace function echo.tg_call_speaker_link_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  linking boolean := new.person_id is not null
                     and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id);
begin
  if linking then
    if not echo.owns_call(new.call_id) then
      raise exception 'only the call''s owner may link a voice to the speaker directory'
        using errcode = 'insufficient_privilege';
    end if;
    new.linked_by := echo.actor_id();
    new.linked_at := now();
  elsif new.person_id is null then
    new.linked_by := null;
    new.linked_at := null;
  else
    -- Unchanged link: its provenance is not up for editing.
    new.linked_by := old.linked_by;
    new.linked_at := old.linked_at;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nits (c) and (d) — 0013's header promises that every policy requires an
-- active identity. Two did not, so make the promise true rather than
-- footnote it: a pending or disabled account can now neither edit its own
-- profile nor read the system skill catalogue. "Nothing is visible or usable
-- before acceptance" (M15) is the stronger reading, and reading one's own
-- app_user row — which is what the UI needs to say "awaiting approval" — is
-- untouched.
-- ---------------------------------------------------------------------------

drop policy app_user_write on echo.app_user;
create policy app_user_write on echo.app_user for update to echo_app
  using (
    (id = echo.actor_id() and echo.actor_is_active())
    or (org_id = echo.actor_org_id() and echo.actor_is_admin())
  )
  with check (
    (id = echo.actor_id() and echo.actor_is_active())
    or (org_id = echo.actor_org_id() and echo.actor_is_admin())
  );

drop policy skill_read on echo.skill;
create policy skill_read on echo.skill for select to echo_app, echo_agent
  using (
    echo.actor_is_active()
    and (
      level = 'system'
      or (org_id = echo.actor_org_id()
          and (level = 'org' or user_id = echo.actor_id()))
    )
  );

-- ---------------------------------------------------------------------------
-- The steward's question — how does a user remove a skill they created?
--
-- They archive it, exactly as they archive a call: the product has no delete
-- for a user-authored artifact, and no role here holds DELETE on echo.skill.
-- Archiving frees the slug, so `/recap` can be written again after the first
-- attempt is retired, while the retired definition stays attached to the
-- agent_runs that used it (invariant 5 — those runs must stay replayable).
-- ---------------------------------------------------------------------------

alter table echo.skill add column archived_at timestamptz;

drop index echo.skill_system_slug_key;
drop index echo.skill_org_slug_key;
drop index echo.skill_user_slug_key;

create unique index skill_system_slug_key on echo.skill (slug)
  where level = 'system' and archived_at is null;
create unique index skill_org_slug_key on echo.skill (org_id, slug)
  where level = 'org' and archived_at is null;
create unique index skill_user_slug_key on echo.skill (user_id, slug)
  where level = 'user' and archived_at is null;

comment on column echo.skill.archived_at is
  'Retires a skill and frees its slug. There is no DELETE on this table: past agent_runs must stay replayable (invariant 5).';

-- ---------------------------------------------------------------------------
-- 0012's alter branch did not re-assert noinherit the way its create branch
-- does, so a role that predated this schema could carry it silently.
-- ---------------------------------------------------------------------------

-- Assert rather than re-issue: on a managed platform the migration role is
-- not a superuser and ALTER ROLE ... NOSUPERUSER is refused outright, so an
-- unconditional re-assert fails the migration even when every attribute is
-- already correct. Check first, and only act when the state is actually wrong.
--
-- (This is also why 0012's alter branch is reachable only on a reinstall over
-- pre-existing roles; on a fresh database its create branch sets all of this.)

do $$
declare r record;
begin
  for r in
    select rolname, rolsuper, rolbypassrls, rolinherit
    from pg_roles
    where rolname in ('echo_app', 'echo_agent', 'echo_purge', 'echo_vendor')
  loop
    -- These two are not hygiene, they are the wall. If one is wrong and we
    -- cannot fix it, the migration must fail rather than proceed quietly.
    if r.rolsuper or r.rolbypassrls then
      begin
        execute format('alter role %I nosuperuser nobypassrls', r.rolname);
      exception when others then
        raise exception
          'role % is superuser or bypasses RLS and this connection cannot revoke it — the wall does not hold: %',
          r.rolname, sqlerrm;
      end;
    end if;

    -- Hygiene: we grant privileges directly rather than through membership,
    -- so inheritance changes nothing about what this role can reach.
    if r.rolinherit then
      begin
        execute format('alter role %I noinherit', r.rolname);
      exception when others then
        raise notice 'could not set noinherit on % — hygiene only, wall unaffected', r.rolname;
      end;
    end if;
  end loop;
end;
$$;
