-- 0157 — the guard's one door, rebuilt on the RIGHT body
--
-- 0155 added the pending-placement door and, doing it, reverted three
-- migrations. I rebuilt `tg_app_user_guard` from 0036's text because that is
-- where I had just been reading it — and 0038, 0040 and 0044 had each
-- revised it since. The suite caught it in one assertion: 17_roles asserts
-- that no function outside `role_is_admin` compares against a literal role,
-- and 0036's body does exactly that, four migrations before the rule existed.
--
-- The lesson is 0132's, arriving again in the same shape: a function that is
-- being modified is regenerated from the CATALOGUE or from its true
-- predecessor, never retyped from the migration where you last read it.
-- `create or replace` accepts a stale body as cheerfully as a current one —
-- it is not a diff, and nothing about the operation can tell you that the
-- body you handed it is four revisions old.
--
-- This is 0044's body — the actual predecessor — with 0155's one change
-- applied to it and nothing else touched.

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

  -- THE ONE DOOR (0155, restated here on 0044's body rather than on 0036's).
  -- An organisation is immutable because a member's calls, tasks and history
  -- all hang off it and none of them travel. A PENDING arrival has none of
  -- that — that is the whole meaning of the state — so there is nothing to
  -- keep, and somebody still has to decide where they belong.
  --
  -- Doubly narrow, and the second half is the load-bearing one:
  --   old.status = 'pending'  the row has nothing hanging off its org
  --   not from_app            echo_app cannot reach it by any UPDATE it
  --                           writes; only a definer door can, and
  --                           platform_assign_user_org is the only one.
  if new.org_id is distinct from old.org_id
     and not (old.status = 'pending' and not from_app) then
    raise exception 'a user cannot change org'
      using errcode = 'check_violation';
  end if;

  if from_app and new.email is distinct from old.email then
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

      if (echo.role_is_admin(old.role) or echo.role_is_admin(new.role))
         and not echo.actor_is_owner() then
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

    if new.status is distinct from old.status then
      perform echo.record_status_change(
        old.id, old.org_id, old.status, new.status,
        case when from_app then actor else null end
      );
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
