-- NeurAI Platform — 0091: platform-root SIGHT is console-only (user ruling,
-- 2026-08-24: "in root control it can see all, and in its Users it must
-- just see its own organization — what happened to the security?").
--
-- What happened: 0066 gave the console its lists by adding SELECT policies
-- on the PRODUCT tables (app_user_platform_root_read, org_platform_root_
-- read). RLS policies OR together, so every ordinary org surface that
-- lists members — Management·Users first among them — silently widened to
-- the whole platform for a root: cross-org names and emails on an org
-- screen. The 0066 comment promised "metadata only"; the failure is the
-- ALTITUDE (a policy on a shared table reaches every surface that reads
-- the table), not the metadata line.
--
-- The fix restates the house rule: root authority lives in NAMED CONSOLE
-- DOORS (require_platform_root + definer), never in product policies. The
-- two policies are dropped; the console's three reads (overview counts,
-- org list, user list) become definer functions. platform_operator and
-- platform_audit keep their root-read policies — those are console-domain
-- tables no product surface touches.

drop policy app_user_platform_root_read on echo.app_user;
drop policy org_platform_root_read on echo.org;

-- ---------------------------------------------------------------------------
-- The console's reads, as doors. Each verifies the session's own actor is
-- a platform root before returning anything; filtering/search/paging stay
-- in the api ON TOP of these rows.
-- ---------------------------------------------------------------------------

create function echo.platform_overview_counts()
  returns table (
    organization_total bigint, organization_active bigint,
    organization_suspended bigint, user_total bigint, user_active bigint,
    user_pending bigint, user_disabled bigint, platform_roots bigint
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform echo.require_platform_root(echo.actor_id());
  return query select
    (select count(*) from echo.org),
    (select count(*) from echo.org o where o.status = 'active'),
    (select count(*) from echo.org o where o.status = 'suspended'),
    (select count(*) from echo.app_user),
    (select count(*) from echo.app_user u where u.status = 'active'),
    (select count(*) from echo.app_user u where u.status = 'pending'),
    (select count(*) from echo.app_user u where u.status = 'disabled'),
    (select count(*) from echo.platform_operator);
end;
$$;

create function echo.platform_list_orgs()
  returns table (
    id uuid, name text, status text, locale text,
    created_at timestamptz, deleted_at timestamptz, purge_after timestamptz,
    member_count bigint
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform echo.require_platform_root(echo.actor_id());
  return query
    select o.id, o.name::text, o.status::text, o.locale::text,
           o.created_at, o.deleted_at, o.purge_after,
           count(u.id) as member_count
      from echo.org o
      left join echo.app_user u on u.org_id = o.id
     group by o.id;
end;
$$;

create function echo.platform_list_users()
  returns table (
    id uuid, org_id uuid, org_name text, email text,
    display_name text, display_name_en text, username text, locale text,
    role text, status text, created_at timestamptz, last_seen_at timestamptz,
    deleted_at timestamptz, purge_after timestamptz, is_platform_root boolean
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform echo.require_platform_root(echo.actor_id());
  return query
    select u.id, u.org_id, o.name::text as org_name, u.email::text,
           u.display_name::text, u.display_name_en::text, u.username::text,
           u.locale::text, u.role::text, u.status::text,
           u.created_at, u.last_seen_at, u.deleted_at, u.purge_after,
           exists (select 1 from echo.platform_operator p where p.user_id = u.id)
             as is_platform_root
      from echo.app_user u
      join echo.org o on o.id = u.org_id;
end;
$$;

revoke all on function echo.platform_overview_counts() from public;
revoke all on function echo.platform_list_orgs() from public;
revoke all on function echo.platform_list_users() from public;
grant execute on function echo.platform_overview_counts() to echo_app;
grant execute on function echo.platform_list_orgs() to echo_app;
grant execute on function echo.platform_list_users() to echo_app;

comment on function echo.platform_list_users() is
  'Console-only sight (0091): the whole platform''s user metadata, behind require_platform_root. Exists BECAUSE the 0066 policies are gone — product surfaces must never widen for a root.';
