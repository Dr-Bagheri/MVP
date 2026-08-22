-- Echo — 0077: record actions follow the ROLE HIERARCHY (user ruling,
-- 2026-08-22: "the owner must have all the options for the records over
-- admins and members, admins only over themselves and members, members just
-- themselves").
--
-- Until now the split was owner-of-the-call vs admin: an admin (any admin,
-- including the org owner) could archive/delete/restore ANY record but
-- modify none they did not own — so the org owner could not rename a
-- member's record, which is the exact case the user hit. The new rule is
-- one sentence: **you may act on someone else's record only if your role
-- strictly outranks theirs** (owner > admin > member), and then you may do
-- everything the owner of the record could. Peers are walled from each
-- other: admin-on-admin is refused exactly like member-on-member.
--
-- This SUPERSEDES M11's "admins delete any": an admin no longer deletes an
-- owner's or a fellow admin's record. Self-restore stays admin-and-above
-- (the 2026-08-13 user ruling): a member still cannot restore their own
-- deleted record.
--
-- The wall is in SQL — the guard trigger and the two definer doors — never
-- in the api (rule: a decision enforced at a layer the write can be routed
-- around is a preference, not a rule).

-- ---------------------------------------------------------------------------
-- The rank, decided in exactly one place.
-- ---------------------------------------------------------------------------

create function echo.role_rank(r echo.member_role) returns int
  language sql
  immutable
  set search_path = ''
as $$ select case r when 'owner' then 3 when 'admin' then 2 else 1 end $$;

comment on function echo.role_rank(echo.member_role) is
  'owner 3 > admin 2 > member 1. The only place the ordering lives — compare ranks, never restate them.';

-- Does the ACTOR strictly outrank the target person? Same org required —
-- rank is meaningless across a tenancy wall. Definer, because the actor may
-- not be able to read the target''s row and the answer must not depend on
-- that. The target''s status is deliberately NOT checked: a disabled or
-- tombstoned member''s records still need managing.
create function echo.actor_outranks(p_user uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select echo.role_rank(a.role) > echo.role_rank(t.role)
        and a.status = 'active'
        and o.status = 'active'
        and t.org_id = a.org_id
     from echo.app_user a
     join echo.org o on o.id = a.org_id
     join echo.app_user t on t.id = p_user
     where a.id = echo.actor_id()),
    false
  );
$$;

revoke all on function echo.actor_outranks(uuid) from public;
grant execute on function echo.actor_outranks(uuid) to echo_app, echo_agent;

comment on function echo.actor_outranks(uuid) is
  'Strictly-greater role rank, same org, active actor. The hierarchy rule for acting on someone else''s record (0077).';

-- ---------------------------------------------------------------------------
-- The guard: ANY change to someone else's call requires outranking them —
-- content and archive alike. (Previously: content refused for every
-- non-owner, archive allowed for every admin. Both halves were wrong under
-- the ruling, in opposite directions.) Body otherwise identical to 0033's.
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

  if from_app and new.deleted_at is distinct from old.deleted_at then
    raise exception
      'deletion is not an update: use echo.soft_delete_call() or echo.restore_call()'
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

  -- 0077: one rule for every column — your own record, or one whose owner
  -- your role strictly outranks. The refusal names the rule, not the room.
  if from_app and old.owner_id is distinct from actor
     and not echo.actor_outranks(old.owner_id) then
    raise exception
      'a record can be changed by its owner, or by a role above the owner''s'
      using errcode = 'insufficient_privilege';
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

-- ---------------------------------------------------------------------------
-- The delete door: self, or outrank. (Was: self, or any admin.)
-- ---------------------------------------------------------------------------

create or replace function echo.soft_delete_call(p_call uuid) returns boolean
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
  -- everything and must therefore decide for itself. Same terms as
  -- call_read; the AUTHORITY term below is 0077's hierarchy.
  select c.owner_id, c.deleted_at into v_owner, v_deleted
  from echo.call c
  where c.id = p_call
    and c.org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (c.owner_id = v_actor or c.scope = 'org' or echo.actor_is_admin());

  if not found
     or (v_owner is distinct from v_actor and not echo.actor_outranks(v_owner)) then
    -- One message for "no such call" and for "not yours", so the refusal
    -- cannot be used to discover which calls exist.
    raise exception 'no such call, or not yours to delete'
      using errcode = 'insufficient_privilege';
  end if;

  if v_deleted is not null then
    return false;
  end if;

  update echo.call set deleted_at = now() where id = p_call;
  return true;
end;
$$;

comment on function echo.soft_delete_call(uuid) is
  'Deletion under the 0077 hierarchy: your own record, or one whose owner your role strictly outranks. A named operation because setting deleted_at moves the row out of a member''s own read policy.';

-- ---------------------------------------------------------------------------
-- The restore door: admin-and-above only (the 2026-08-13 ruling stands — a
-- member never restores), and beyond your own record, outranking decides.
-- ---------------------------------------------------------------------------

create or replace function echo.restore_call(p_call uuid) returns boolean
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
  if not echo.actor_is_admin() then
    raise exception 'only an admin may restore a deleted call'
      using errcode = 'insufficient_privilege';
  end if;

  select c.owner_id, c.deleted_at into v_owner, v_deleted
  from echo.call c
  where c.id = p_call and c.org_id = echo.actor_org_id();

  if not found then
    raise exception 'no such call' using errcode = 'insufficient_privilege';
  end if;

  -- 0077: an admin restores their own; anyone else's needs outranking.
  if v_owner is distinct from v_actor and not echo.actor_outranks(v_owner) then
    raise exception
      'a record can be restored by a role above its owner''s'
      using errcode = 'insufficient_privilege';
  end if;

  if v_deleted is null then
    return false;
  end if;

  update echo.call set deleted_at = null where id = p_call;
  return true;
end;
$$;

comment on function echo.restore_call(uuid) is
  'Restore under the 0077 hierarchy: admin-and-above, own record or an outranked owner''s. Members never restore (2026-08-13 user ruling).';
