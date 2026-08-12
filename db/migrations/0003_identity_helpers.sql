-- Echo — 0003: what the acting identity is allowed to be.
--
-- Every policy in 0012 is written in terms of these four functions, so the
-- membership rules exist in exactly one place. They are SECURITY DEFINER
-- because they read echo.app_user, which is itself behind RLS — a policy that
-- had to read app_user directly would recurse.
--
-- They are safe to expose: each answers a question about the *caller's own*
-- membership and leaks nothing about anyone else.

create function echo.actor_org_id() returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select u.org_id
  from echo.app_user u
  where u.id = echo.actor_id();
$$;

create function echo.actor_is_admin() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select u.role = 'admin' and u.status = 'active'
     from echo.app_user u
     join echo.org o on o.id = u.org_id
     where u.id = echo.actor_id() and o.status = 'active'),
    false
  );
$$;

-- The M15 gate, in one place: a pending or disabled person, or anyone in a
-- suspended org, is not active — and every policy requires active.
create function echo.actor_is_active() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select u.status = 'active'
     from echo.app_user u
     join echo.org o on o.id = u.org_id
     where u.id = echo.actor_id() and o.status = 'active'),
    false
  );
$$;

-- Convenience for policies: active AND in this org. NULL identity → false.
create function echo.actor_in_org(target_org uuid) returns boolean
  language sql
  stable
  parallel safe
  set search_path = ''
as $$
  select echo.actor_is_active() and target_org = echo.actor_org_id();
$$;

comment on function echo.actor_is_active() is
  'M15 gate: false for pending/disabled users and for anyone in a suspended org. Every policy requires it.';
