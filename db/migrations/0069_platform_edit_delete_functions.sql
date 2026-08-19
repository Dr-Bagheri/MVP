-- NeurAI Platform — 0069: platform-root edit + soft-delete/restore functions.
--
-- Companion to 0068. Every function follows the 0066 pattern exactly:
-- security definer, require_platform_root() first, a bounded audit reason,
-- and a metadata-only record_platform_audit line. citext (email) is never
-- writable here — it is auth-owned and immutable by the app_user guard — so
-- identity edits cover the names, handle, locale and org role, never the
-- login address.
--
-- search_path is 'public' ONLY where a body needs citext/its operators; the
-- rest keep '' and qualify every echo.* reference. All echo.* objects are
-- schema-qualified regardless, so no application object is reachable through
-- the wider path.

-- ─── EDIT: organisation metadata (name, interface locale) ──────────────────
create function echo.platform_update_org(
  p_actor  uuid,
  p_org    uuid,
  p_name   text,
  p_locale text,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_name   text;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  v_name := btrim(coalesce(p_name, ''));
  if length(v_name) = 0 then
    raise exception 'organization name cannot be empty' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from echo.org o where o.id = p_org) then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;

  update echo.org
     set name = v_name,
         locale = coalesce(nullif(btrim(p_locale), ''), locale)
   where id = p_org;

  perform echo.record_platform_audit(p_actor, 'org_updated', null, p_org, v_reason);
  return true;
end;
$$;

-- ─── EDIT: user identity metadata (names, handle, locale, org role) ─────────
create function echo.platform_update_user(
  p_actor           uuid,
  p_target          uuid,
  p_display_name    text,
  p_display_name_en text,
  p_username        text,
  p_locale          text,
  p_role            echo.member_role,
  p_reason          text
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

  if not exists (select 1 from echo.app_user u where u.id = p_target) then
    raise exception 'no such user' using errcode = 'no_data_found';
  end if;

  -- The email is intentionally absent: it is the login identity, owned by the
  -- auth provider and held immutable by the app_user guard. Everything below
  -- is display/handle/role metadata. The table's own constraints (username
  -- format + per-org uniqueness, non-blank Latin name, one owner per org)
  -- still apply and surface as errors if violated.
  update echo.app_user
     set display_name    = coalesce(btrim(p_display_name), display_name),
         display_name_en = nullif(btrim(coalesce(p_display_name_en, '')), ''),
         username        = nullif(btrim(coalesce(p_username, '')), ''),
         locale          = coalesce(nullif(btrim(p_locale), ''), locale),
         role            = coalesce(p_role, role)
   where id = p_target;

  perform echo.record_platform_audit(p_actor, 'user_updated', p_target, null, v_reason);
  return true;
end;
$$;

-- ─── SOFT DELETE + RESTORE: organisation (7-day window) ─────────────────────
create function echo.platform_soft_delete_org(
  p_actor  uuid,
  p_org    uuid,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_deleted timestamptz;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select o.deleted_at into v_deleted from echo.org o where o.id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  if v_deleted is not null then
    return false;
  end if;

  -- suspend for access control (existing mechanism) + stamp the purge window.
  update echo.org
     set status = 'suspended',
         deleted_at = now(),
         deleted_by = p_actor,
         purge_after = now() + interval '7 days'
   where id = p_org;

  perform echo.record_platform_audit(p_actor, 'org_deleted', null, p_org, v_reason);
  return true;
end;
$$;

create function echo.platform_restore_org(
  p_actor  uuid,
  p_org    uuid,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_deleted timestamptz;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select o.deleted_at into v_deleted from echo.org o where o.id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  if v_deleted is null then
    return false;
  end if;

  update echo.org
     set status = 'active',
         deleted_at = null,
         deleted_by = null,
         purge_after = null
   where id = p_org;

  perform echo.record_platform_audit(p_actor, 'org_restored', null, p_org, v_reason);
  return true;
end;
$$;

-- ─── SOFT DELETE + RESTORE: user (7-day window) ─────────────────────────────
create function echo.platform_soft_delete_user(
  p_actor  uuid,
  p_target uuid,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_deleted timestamptz;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  -- A platform root is never deleted through this door; revoke the role first.
  if exists (select 1 from echo.platform_operator where user_id = p_target) then
    raise exception 'a platform root is not deleted through this action'
      using errcode = 'insufficient_privilege';
  end if;

  select u.deleted_at into v_deleted from echo.app_user u where u.id = p_target;
  if not found then
    raise exception 'no such user' using errcode = 'no_data_found';
  end if;
  if v_deleted is not null then
    return false;
  end if;

  update echo.app_user
     set status = 'disabled',
         deleted_at = now(),
         deleted_by = p_actor,
         purge_after = now() + interval '7 days'
   where id = p_target;

  perform echo.record_platform_audit(p_actor, 'user_deleted', p_target, null, v_reason);
  return true;
end;
$$;

create function echo.platform_restore_user(
  p_actor  uuid,
  p_target uuid,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_deleted timestamptz;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select u.deleted_at into v_deleted from echo.app_user u where u.id = p_target;
  if not found then
    raise exception 'no such user' using errcode = 'no_data_found';
  end if;
  if v_deleted is null then
    return false;
  end if;

  update echo.app_user
     set status = 'active',
         deleted_at = null,
         deleted_by = null,
         purge_after = null
   where id = p_target;

  perform echo.record_platform_audit(p_actor, 'user_restored', p_target, null, v_reason);
  return true;
end;
$$;

-- Only the application role may execute; the wall (require_platform_root) is
-- inside each function. Never public, never the agent/purge/vendor roles.
grant execute on function echo.platform_update_org(uuid, uuid, text, text, text) to echo_app;
grant execute on function echo.platform_update_user(uuid, uuid, text, text, text, text, echo.member_role, text) to echo_app;
grant execute on function echo.platform_soft_delete_org(uuid, uuid, text) to echo_app;
grant execute on function echo.platform_restore_org(uuid, uuid, text) to echo_app;
grant execute on function echo.platform_soft_delete_user(uuid, uuid, text) to echo_app;
grant execute on function echo.platform_restore_user(uuid, uuid, text) to echo_app;

revoke all on function echo.platform_update_org(uuid, uuid, text, text, text) from public;
revoke all on function echo.platform_update_user(uuid, uuid, text, text, text, text, echo.member_role, text) from public;
revoke all on function echo.platform_soft_delete_org(uuid, uuid, text) from public;
revoke all on function echo.platform_restore_org(uuid, uuid, text) from public;
revoke all on function echo.platform_soft_delete_user(uuid, uuid, text) from public;
revoke all on function echo.platform_restore_user(uuid, uuid, text) from public;
