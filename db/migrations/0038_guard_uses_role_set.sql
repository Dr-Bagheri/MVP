-- Echo — 0038: the last restatement of "counts as an admin".
--
-- 0037 gave the rule one home and 17_roles asserts no function restates it.
-- That assertion went red on tg_app_user_guard, which compares to the literal
-- 'admin' — and the interesting part is that the guard is asking a genuinely
-- different question: not "does this role carry admin authority" but "is this
-- target in the admin tier", with 'owner' handled by its own earlier clause.
--
-- Two ways to make the check green, and only one of them is honest.
--
-- Exempting the guard by name would have worked and would have been a lie of
-- omission: an exemption list is a place for the next literal to hide, and a
-- checker that needs one is a checker people learn to argue with. Since the
-- earlier clauses already refuse any transition involving 'owner', by the time
-- control reaches this line role_is_admin(x) and x = 'admin' are the same
-- test — so the literal can simply go, and the check needs no exception at all.
--
-- A rule that is hard to state without exceptions is usually two rules. This
-- one turned out to be one rule stated twice.

create or replace function echo.tg_app_user_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id then
    raise exception 'a user cannot change identity or org'
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

      -- Neither side can be 'owner' by the time we get here, so this reads as
      -- "the admin tier" and uses the one definition of it.
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
  end if;

  return new;
end;
$$;
