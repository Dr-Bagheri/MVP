-- Echo — 0032: give deletion its own path, because deleting a row you may no
-- longer see cannot be an UPDATE.
--
-- The bug (found by the api session, reproduced here): an owner could not
-- soft-delete their own call. Every term of call_update's WITH CHECK was true,
-- the row accepted `archived_at` in the same transaction, and an admin
-- succeeded on the same statement — but the owner got 42501.
--
-- The discriminator is in call_read, not call_update:
--     (deleted_at is null or echo.actor_is_admin())
-- Setting deleted_at moves the row outside the actor's own SELECT policy, and
-- Postgres refuses an UPDATE whose result the actor could not see. An admin's
-- read clause has no deleted_at condition, so an admin never hit it. Confirmed
-- by experiment: widening call_read to include `deleted_by = actor_id()` makes
-- the owner's delete succeed.
--
-- ===========================================================================
-- Why not widen call_read, which is the smaller diff.
--
-- Because it would overturn a ruling rather than fix a bug. Q2 was decided as
-- built: only an admin restores, and a deleted call is gone for its owner —
-- "deletion should feel like deletion". `or deleted_by = echo.actor_id()`
-- makes every call an owner has ever deleted permanently visible to them in
-- every listing, and then the ruled behaviour survives only in whatever WHERE
-- clause core/ remembers to write. A product rule that lives in the app's
-- filters instead of the wall is the shape this schema exists to avoid.
--
-- So: the read stays exactly as ruled, and deletion becomes a named operation.
-- ===========================================================================

create function echo.soft_delete_call(p_call uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_actor uuid := echo.actor_id();
  v_owner uuid;
  v_deleted timestamptz;
begin
  -- The visibility rule, restated here because a definer function sees
  -- everything and must therefore decide for itself. Same terms as call_read
  -- plus M11's "members delete only their own; admins delete any".
  select c.owner_id, c.deleted_at into v_owner, v_deleted
  from echo.call c
  where c.id = p_call
    and c.org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (c.owner_id = v_actor or c.scope = 'org' or echo.actor_is_admin());

  if not found or (v_owner is distinct from v_actor and not echo.actor_is_admin()) then
    -- One message for "no such call" and for "not yours", so the refusal
    -- cannot be used to discover which calls exist.
    raise exception 'no such call, or not yours to delete'
      using errcode = 'insufficient_privilege';
  end if;

  -- Already deleted is not a failure. The distinction matters: a caller
  -- retrying gets false, a caller who was never allowed gets an exception.
  if v_deleted is not null then
    return false;
  end if;

  -- deleted_by and purge_after are stamped by tg_call_guard, from the actor
  -- rather than from anything supplied here.
  update echo.call set deleted_at = now() where id = p_call;
  return true;
end;
$$;

comment on function echo.soft_delete_call(uuid) is
  'M11 deletion: members delete their own calls, admins delete any. A named operation because setting deleted_at moves the row out of a member''s own read policy.';

-- Restore is the admin's, per Q2 as ruled. It needs no definer trick — an
-- admin can see the row before and after — but it lives here so that the pair
-- reads as one surface rather than one function and one column poke.
create function echo.restore_call(p_call uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_deleted timestamptz;
begin
  if not echo.actor_is_admin() then
    raise exception 'only an admin may restore a deleted call'
      using errcode = 'insufficient_privilege';
  end if;

  select c.deleted_at into v_deleted
  from echo.call c
  where c.id = p_call and c.org_id = echo.actor_org_id();

  if not found then
    raise exception 'no such call' using errcode = 'insufficient_privilege';
  end if;
  if v_deleted is null then
    return false;
  end if;

  update echo.call set deleted_at = null where id = p_call;
  return true;
end;
$$;

revoke all on function echo.soft_delete_call(uuid) from public;
revoke all on function echo.restore_call(uuid)     from public;
-- echo_app only. The agent deletes nothing, ever (M11), and that stays true of
-- a function as much as of a grant.
grant execute on function echo.soft_delete_call(uuid) to echo_app;
grant execute on function echo.restore_call(uuid)     to echo_app;

-- ---------------------------------------------------------------------------
-- One path, not two.
--
-- The UPDATE route still worked for admins, which is exactly how this bug
-- survived: a path that succeeds for the privileged caller and fails for the
-- ordinary one looks correct from wherever it was tested. Close it, so the
-- delete cannot be written a second way and drift.
-- ---------------------------------------------------------------------------

create or replace function echo.tg_call_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if new.org_id is distinct from old.org_id or new.owner_id is distinct from old.owner_id then
    raise exception 'a call cannot change org or owner'
      using errcode = 'check_violation';
  end if;

  -- Deletion and restoration are named operations (0032). Reached directly,
  -- they half-work: an admin succeeds and an owner is refused by their own
  -- read policy, which reads as a permissions bug rather than a wrong door.
  if from_app and new.deleted_at is distinct from old.deleted_at then
    raise exception
      'use echo.soft_delete_call() / echo.restore_call() rather than setting deleted_at'
      using errcode = 'insufficient_privilege';
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

  if from_app and old.owner_id is distinct from actor then
    if new.title          is distinct from old.title
    or new.scope          is distinct from old.scope
    or new.language       is distinct from old.language
    or new.source         is distinct from old.source
    or new.started_at     is distinct from old.started_at
    or new.status         is distinct from old.status
    or new.duration_ms    is distinct from old.duration_ms
    or new.failure_reason is distinct from old.failure_reason
    or new.current_summary_id is distinct from old.current_summary_id
    or new.summary_skipped_reason is distinct from old.summary_skipped_reason then
      raise exception 'only the owner may modify a call; others may archive, delete or restore it'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if old.status = 'failed' and new.status is distinct from old.status then
    new.failure_reason := null;
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
