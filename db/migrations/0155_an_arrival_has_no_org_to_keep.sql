-- 0155 — an arrival has no organisation to keep
--
-- 0154 could not run. `tg_app_user_guard` makes `org_id` immutable on every
-- path — "Integrity, not authority: true on every path, operator included" —
-- so the vendor could see a pending arrival and could not place them.
--
-- The rule is right and it stays. What it protects is a member's working
-- life: their calls, their tasks, their status history, every row that hangs
-- off org_id and does not travel. Moving an ACTIVE member between
-- organisations is not an edit, it is a migration nobody has designed.
--
-- A PENDING arrival has none of that. That is the whole meaning of the state:
-- they are not inside any organisation yet, which is exactly why somebody has
-- to decide which one. So the exception is not "the vendor may move people";
-- it is "there is nothing to keep yet", and it is written as the condition
-- that makes it true rather than as a permission.
--
-- D8's rule for named doors: enumerate them, with reasons. This adds ONE, and
-- it is doubly narrow —
--
--   old.status = 'pending'   the row has nothing hanging off its org, and
--   not from_app             so echo_app cannot reach it by any UPDATE it
--                            writes; only a SECURITY DEFINER door can, and
--                            0154 is the only one that does.
--
-- The second half is the load-bearing one. Without it the exception would be
-- a widening of what the application role may do, and an org-scoped table
-- would have a path to a cross-org write. With it, the wrong state is
-- unrepresentable for the caller who could otherwise reach it, which is the
-- structure-not-predicate preference this schema keeps returning to.

create or replace function echo.tg_app_user_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if new.id is distinct from old.id then
    raise exception 'a user cannot change identity'
      using errcode = 'check_violation';
  end if;

  -- The organisation is immutable, with exactly one door: a PENDING arrival
  -- being placed by a definer operation. See this migration's header for why
  -- that is a statement about the row rather than about the caller.
  if new.org_id is distinct from old.org_id
     and not (old.status = 'pending' and not from_app) then
    raise exception 'a user cannot change org'
      using errcode = 'check_violation';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email is owned by the auth provider, not by this table'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role is distinct from old.role or new.status is distinct from old.status then
    if from_app then
      if actor = old.id then
        raise exception 'nobody changes their own role or status'
          using errcode = 'insufficient_privilege';
      end if;

      if new.role = 'owner' then
        raise exception 'ownership is transferred by an explicit action, not by a role change'
          using errcode = 'insufficient_privilege';
      end if;
      if old.role = 'owner' then
        raise exception 'the owner''s own role and status are not changed by anyone'
          using errcode = 'insufficient_privilege';
      end if;

      if (old.role = 'admin' or new.role = 'admin') and not echo.actor_is_owner() then
        raise exception 'only the owner may change an admin, or make one'
          using errcode = 'insufficient_privilege';
      end if;

      if not echo.actor_is_admin() then
        raise exception 'only an admin may change a role or a membership status'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    if old.status = 'pending' and new.status = 'active' then
      new.accepted_at := now();
      new.accepted_by := case when from_app then actor else null end;
    end if;
  end if;

  return new;
end;
$$;

-- ── self-checks ────────────────────────────────────────────────────────────
do $$
declare
  v_org_a  uuid;
  v_org_b  uuid;
  v_person uuid := gen_random_uuid();
  v_failed text;
begin
  insert into echo.org (name, locale) values ('probe-0155-a', 'fa') returning id into v_org_a;
  insert into echo.org (name, locale) values ('probe-0155-b', 'fa') returning id into v_org_b;
  insert into auth.users (id, email) values (v_person, 'probe-0155@example.test')
    on conflict (id) do nothing;
  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (v_person, v_org_a, 'probe-0155@example.test', 'arrival', 'member', 'pending');

  -- 1) THE DOOR: a pending arrival's org may be set (this runs as the
  --    migration owner, i.e. not from_app — the definer seam)
  update echo.app_user set org_id = v_org_b where id = v_person;
  if (select u.org_id from echo.app_user u where u.id = v_person) is distinct from v_org_b then
    raise exception 'CHECK FAILED: a pending arrival could not be placed';
  end if;

  -- 2) THE RULE, still standing: once ACTIVE, the org is immutable again.
  --    This is the assertion that keeps the exception from becoming a
  --    general permission, and it is the one that would silently stop being
  --    true if somebody later "simplified" the condition.
  update echo.app_user set status = 'active' where id = v_person;
  begin
    update echo.app_user set org_id = v_org_a where id = v_person;
    v_failed := 'an ACTIVE member changed organisation';
  exception when check_violation then
    v_failed := null;
  end;
  if v_failed is not null then raise exception 'CHECK FAILED: %', v_failed; end if;

  -- 3) the identity half was not loosened along the way
  begin
    update echo.app_user set id = gen_random_uuid() where id = v_person;
    v_failed := 'a user changed identity';
  exception when check_violation then
    v_failed := null;
  end;
  if v_failed is not null then raise exception 'CHECK FAILED: %', v_failed; end if;

  raise notice '0155 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
