-- NeurAI Platform — 0066: privacy-preserving platform-root control plane.
--
-- M32 intentionally adds a PLATFORM role beside the organisation hierarchy;
-- it does not turn platform staff into members of every customer organisation.
-- The narrow RLS additions below reveal only organisation/user metadata. No
-- call, transcript, summary, assistant-session, connector, or secret policy
-- names actor_is_platform_root(), so the customer-content wall stays closed.

create type echo.platform_role as enum ('platform_root');
create type echo.platform_audit_action as enum (
  'root_bootstrapped',
  'root_granted',
  'root_revoked',
  'org_status_changed',
  'user_status_changed'
);

-- This is deliberately not a column on app_user and never a JWT claim:
-- membership is an organisation fact, while platform-root authority spans
-- organisations and must be read fresh from the database on every request.
create table echo.platform_operator (
  user_id    uuid primary key references echo.app_user(id) on delete restrict,
  role       echo.platform_role not null default 'platform_root',
  granted_by uuid references echo.app_user(id) on delete restrict,
  granted_at timestamptz not null default now()
);

-- Metadata-only operational trail. `reason` is deliberately bounded so this
-- cannot become a covert transcript/content store; callers identify the
-- operational reason, never paste customer material.
create table echo.platform_audit (
  id             bigint generated always as identity primary key,
  actor_id       uuid not null references echo.app_user(id) on delete restrict,
  action         echo.platform_audit_action not null,
  target_user_id uuid references echo.app_user(id) on delete restrict,
  target_org_id  uuid references echo.org(id) on delete restrict,
  reason         text not null,
  created_at     timestamptz not null default now(),
  constraint platform_audit_target_present
    check (target_user_id is not null or target_org_id is not null),
  constraint platform_audit_reason_bounded
    check (length(btrim(reason)) between 3 and 500)
);

create index platform_audit_created_idx on echo.platform_audit (created_at desc, id desc);
create index platform_audit_target_user_idx on echo.platform_audit (target_user_id, created_at desc)
  where target_user_id is not null;
create index platform_audit_target_org_idx on echo.platform_audit (target_org_id, created_at desc)
  where target_org_id is not null;

alter table echo.platform_operator enable row level security;
alter table echo.platform_audit enable row level security;

-- A root remains able to reactivate its own suspended organisation. Requiring
-- org.status = active here would recreate the one-way suspension path 0052
-- was written to prevent. A disabled root, however, is no root at all.
create function echo.actor_is_platform_root() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select u.status = 'active'
       from echo.platform_operator p
       join echo.app_user u on u.id = p.user_id
      where p.user_id = echo.actor_id()
        and p.role = 'platform_root'),
    false
  );
$$;

comment on function echo.actor_is_platform_root() is
  'M32 platform control-plane authority. Ignores organisation status so a root can reactivate a suspended organisation; never used for customer-content policies.';

create function echo.require_platform_root(p_actor uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- A security-definer function which accepted an arbitrary actor id would
  -- be an authority-smuggling primitive. The caller supplied to each named
  -- operation must be exactly the actor set by core's connection factory.
  if p_actor is null or p_actor is distinct from echo.actor_id()
     or not echo.actor_is_platform_root() then
    raise exception 'platform-root authority required'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create function echo.platform_reason(p_reason text) returns text
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'a platform action reason must be 3 to 500 characters'
      using errcode = 'check_violation';
  end if;
  return v_reason;
end;
$$;

create function echo.record_platform_audit(
  p_actor uuid,
  p_action echo.platform_audit_action,
  p_target_user uuid,
  p_target_org uuid,
  p_reason text
) returns void
  language sql
  security definer
  set search_path = ''
as $$
  insert into echo.platform_audit
    (actor_id, action, target_user_id, target_org_id, reason)
  values
    (p_actor, p_action, p_target_user, p_target_org, p_reason);
$$;

-- First-root bootstrap. The core process obtains p_expected_email from its
-- server-only deployment configuration; it is never a browser field.
create function echo.bootstrap_platform_root(
  p_actor uuid,
  p_expected_email citext
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_email citext;
  v_status echo.user_status;
begin
  if p_actor is null or p_actor is distinct from echo.actor_id() then
    raise exception 'bootstrap actor does not match session'
      using errcode = 'insufficient_privilege';
  end if;

  select u.email, u.status into v_email, v_status
    from echo.app_user u
   where u.id = p_actor;
  if p_expected_email is null or not found or v_status <> 'active' or v_email <> p_expected_email then
    raise exception 'bootstrap account is not permitted'
      using errcode = 'insufficient_privilege';
  end if;

  -- The configured account is allowed to learn only that its own bootstrap
  -- was already consumed. Other users never reach this branch.
  if exists (select 1 from echo.platform_operator) then
    return false;
  end if;

  insert into echo.platform_operator (user_id, role, granted_by)
  values (p_actor, 'platform_root', null);
  perform echo.record_platform_audit(
    p_actor, 'root_bootstrapped', p_actor, null, 'initial platform root bootstrap'
  );
  return true;
end;
$$;

create function echo.platform_grant_root(
  p_actor uuid,
  p_target uuid,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  if not exists (
    select 1 from echo.app_user u where u.id = p_target and u.status = 'active'
  ) then
    raise exception 'platform root target must be an active user'
      using errcode = 'foreign_key_violation';
  end if;

  insert into echo.platform_operator (user_id, role, granted_by)
  values (p_target, 'platform_root', p_actor)
  on conflict (user_id) do nothing;
  if not found then
    return false;
  end if;

  perform echo.record_platform_audit(p_actor, 'root_granted', p_target, null, v_reason);
  return true;
end;
$$;

create function echo.platform_revoke_root(
  p_actor uuid,
  p_target uuid,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_roots integer;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  if p_target = p_actor then
    raise exception 'a platform root cannot remove itself'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_roots from echo.platform_operator;
  if v_roots <= 1 then
    raise exception 'at least one platform root must remain'
      using errcode = 'check_violation';
  end if;

  delete from echo.platform_operator where user_id = p_target;
  if not found then
    return false;
  end if;

  perform echo.record_platform_audit(p_actor, 'root_revoked', p_target, null, v_reason);
  return true;
end;
$$;

create function echo.platform_set_org_status(
  p_actor uuid,
  p_org uuid,
  p_status echo.org_status,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_status echo.org_status;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select o.status into v_status from echo.org o where o.id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  if v_status = p_status then
    return false;
  end if;

  update echo.org set status = p_status where id = p_org;
  perform echo.record_platform_audit(p_actor, 'org_status_changed', null, p_org, v_reason);
  return true;
end;
$$;

create function echo.platform_set_user_status(
  p_actor uuid,
  p_target uuid,
  p_status echo.user_status,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_status echo.user_status;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  -- Roots cannot disable one another. Root removal is its own audited action,
  -- and a normal status patch must never be a back door around that rule.
  if exists (select 1 from echo.platform_operator where user_id = p_target) then
    raise exception 'a platform root status is not changed through this action'
      using errcode = 'insufficient_privilege';
  end if;

  select u.status into v_status from echo.app_user u where u.id = p_target;
  if not found then
    raise exception 'no such user' using errcode = 'no_data_found';
  end if;
  if v_status = p_status then
    return false;
  end if;

  update echo.app_user set status = p_status where id = p_target;
  perform echo.record_platform_audit(p_actor, 'user_status_changed', p_target, null, v_reason);
  return true;
end;
$$;

-- Platform-root reads are deliberately limited to organisation and user
-- metadata. No comparable policy is added for privacy-bearing product tables.
create policy org_platform_root_read on echo.org for select to echo_app
  using (echo.actor_is_platform_root());
create policy app_user_platform_root_read on echo.app_user for select to echo_app
  using (echo.actor_is_platform_root());
create policy platform_operator_root_read on echo.platform_operator for select to echo_app
  using (echo.actor_is_platform_root());
create policy platform_audit_root_read on echo.platform_audit for select to echo_app
  using (echo.actor_is_platform_root());

grant select on echo.platform_operator, echo.platform_audit to echo_app;
revoke all on function echo.actor_is_platform_root() from public;
grant execute on function echo.actor_is_platform_root() to echo_app;
grant execute on function echo.bootstrap_platform_root(uuid, citext) to echo_app;
grant execute on function echo.platform_grant_root(uuid, uuid, text) to echo_app;
grant execute on function echo.platform_revoke_root(uuid, uuid, text) to echo_app;
grant execute on function echo.platform_set_org_status(uuid, uuid, echo.org_status, text) to echo_app;
grant execute on function echo.platform_set_user_status(uuid, uuid, echo.user_status, text) to echo_app;

revoke all on echo.platform_operator, echo.platform_audit from echo_agent, echo_purge, echo_vendor;
revoke all on function echo.require_platform_root(uuid) from public;
revoke all on function echo.platform_reason(text) from public;
revoke all on function echo.record_platform_audit(uuid, echo.platform_audit_action, uuid, uuid, text) from public;
revoke all on function echo.bootstrap_platform_root(uuid, citext) from public;
revoke all on function echo.platform_grant_root(uuid, uuid, text) from public;
revoke all on function echo.platform_revoke_root(uuid, uuid, text) from public;
revoke all on function echo.platform_set_org_status(uuid, uuid, echo.org_status, text) from public;
revoke all on function echo.platform_set_user_status(uuid, uuid, echo.user_status, text) from public;

comment on table echo.platform_operator is
  'M32 platform-wide operators. Separate from organization membership; no direct application write grant.';
comment on table echo.platform_audit is
  'M32 append-only platform-control metadata audit. Never contains customer content or credentials.';
