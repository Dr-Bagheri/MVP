-- Echo — 0036: the owner role (M23).
--
-- Owner is the org's root: it manages the admin tier and the org-level
-- irreversibles. Admins manage members exactly as before. The self-change
-- guard generalises rather than being replaced.
--
-- ===========================================================================
-- The change that touches everything: actor_is_admin() now means
-- admin-or-owner.
--
-- Every policy in this schema asks actor_is_admin(). If 'owner' were a role
-- BESIDE 'admin' rather than above it, promoting the founder would silently
-- strip them of every admin power in the product — org settings, gateway
-- keys, reading the org's calls, restoring a deleted call — and each of those
-- would look like an unrelated permissions bug. An owner is an admin with
-- more, so the predicate every policy already trusts is the right place to
-- say so, and no policy has to be rewritten.
-- ===========================================================================

create or replace function echo.actor_is_admin() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select u.role in ('admin', 'owner') and u.status = 'active'
     from echo.app_user u
     join echo.org o on o.id = u.org_id
     where u.id = echo.actor_id() and o.status = 'active'),
    false
  );
$$;

comment on function echo.actor_is_admin() is
  'Admin-or-owner (M23). An owner is an admin with more, so every existing policy keeps working unchanged.';

create function echo.actor_is_owner() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select u.role = 'owner' and u.status = 'active'
     from echo.app_user u
     join echo.org o on o.id = u.org_id
     where u.id = echo.actor_id() and o.status = 'active'),
    false
  );
$$;

comment on function echo.actor_is_owner() is
  'The org root (M23): manages the admin tier and org-level irreversibles.';

-- ---------------------------------------------------------------------------
-- Backfill: the org's first admin becomes its owner.
--
-- Earliest created_at per org rather than "earliest ACCEPTED admin", because
-- acceptance gates access, not identity: a founder still waiting on vendor
-- acceptance is nonetheless the org's root, and an org whose founder is
-- pending would otherwise be left ownerless. Ties break on id so the result is
-- deterministic on replay.
-- ---------------------------------------------------------------------------

update echo.app_user u
   set role = 'owner'
  from (
    select distinct on (org_id) id
    from echo.app_user
    where role = 'admin'
    order by org_id, created_at, id
  ) first_admin
 where u.id = first_admin.id;

-- At most one owner per org. "Exactly one" is not a table constraint — an org
-- exists for an instant before its founder row does — so the structural half
-- is at-most-one and register_account maintains the other half.
create unique index app_user_one_owner_per_org
  on echo.app_user (org_id) where role = 'owner';

-- New orgs: the founder is the owner from the first row.
create or replace function echo.register_account(
  p_user_id      uuid,
  p_email        citext,
  p_display_name text default '',
  p_org_name     text default null,
  p_join_org     uuid default null
) returns echo.app_user
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_org  uuid;
  v_role echo.member_role;
  v_row  echo.app_user;
begin
  if p_user_id is null or p_email is null then
    raise exception 'registration requires an auth user id and an email'
      using errcode = 'null_value_not_allowed';
  end if;

  if p_join_org is not null then
    perform 1 from echo.org o where o.id = p_join_org and o.status = 'active';
    if not found then
      raise exception 'no such organization' using errcode = 'foreign_key_violation';
    end if;
    v_org  := p_join_org;
    v_role := 'member';
  else
    insert into echo.org (name)
    values (coalesce(nullif(btrim(p_org_name), ''), nullif(btrim(p_display_name), ''), p_email::text))
    returning id into v_org;
    v_role := 'owner';
  end if;

  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (p_user_id, v_org, p_email, coalesce(btrim(p_display_name), ''), v_role, 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- The vendor path looked for a pending 'admin' founder. Founders are owners
-- now, so both halves would have quietly stopped finding anyone — a brand-new
-- org would sit unacceptable forever with no error anywhere. Exactly the class
-- 0036 exists to avoid, one file away from where I introduced it.
-- ---------------------------------------------------------------------------

create or replace function echo.vendor_pending_orgs()
  returns table (org_id uuid, org_name text, founder uuid, founder_email citext,
                 registered_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select o.id, o.name, u.id, u.email, u.created_at
  from echo.org o
  join echo.app_user u on u.org_id = o.id
  where u.status = 'pending'
    and u.role = 'owner'
    and (select count(*) from echo.app_user m where m.org_id = o.id) = 1
  order by u.created_at;
$$;

create or replace function echo.vendor_accept_org(p_org uuid) returns echo.app_user
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row echo.app_user;
  v_members integer;
begin
  select count(*) into v_members from echo.app_user u where u.org_id = p_org;
  if v_members <> 1 then
    raise exception
      'org % has % members; only a brand-new org is accepted by the vendor — an existing org''s admin accepts its own joiners',
      p_org, v_members
      using errcode = 'insufficient_privilege';
  end if;

  update echo.app_user u
     set status = 'active'
   where u.org_id = p_org
     and u.status = 'pending'
     and u.role = 'owner'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no pending founding owner in org %', p_org
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- The authorization rules, generalised.
--
--   nobody changes their own role or status — unchanged, and the reason is
--     unchanged: acceptance and promotion are decisions about someone else.
--   only the OWNER touches the admin tier — changing an admin's role or
--     status, or making anyone an admin. An admin who could mint admins could
--     mint a peer they then cannot manage, which is not "managing members".
--   admins manage MEMBERS exactly as before.
--   nobody becomes owner by a role change. Transfer is an explicit action and
--     is not built in v1; until it is, the label cannot be handed over by an
--     UPDATE, which is the same posture as deletion (0032).
-- ---------------------------------------------------------------------------

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

      -- The admin tier is the owner's to manage: changing an admin, or making
      -- one. Everything else is ordinary member management.
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
