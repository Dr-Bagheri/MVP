-- NeurAI Platform — 0082: signup JOINS, it never FOUNDS (user ruling,
-- 2026-08-23: "everyone may login with github or google … then they must
-- go to an organization page and give the name of the organization; if
-- they write a right name that already is in the database they may enter
-- but the role is member, not owner. Only in platform control I can make
-- someone owner.")
--
-- What this ends: register_account's founding branch. Until now a bare
-- registration (or any org NAME nobody else held) created a brand-new org
-- with the arrival as its ACTIVE OWNER — which is exactly "the first
-- login for everyone is owner". From here:
--
--   * the org NAME is a JOIN key: it must name an org that already
--     exists; the arrival becomes a MEMBER, pending that org's admin
--     acceptance (the existing approvals flow — knowing a name is not a
--     wall, so a name-join must not be an active membership);
--   * invitations (0060) stay the instant path — active on arrival with
--     the granted role, exactly as ruled in D25;
--   * ORGS are born in the platform console only: platform_create_org,
--     root-walled and audited, replaces the founding branch;
--   * OWNERS are made in the platform console only (platform_update_user
--     already carries the role; the app_user guard's owner-minting
--     refusals bind app roles, not the root's definer).

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
  v_org   uuid;
  v_count integer;
  v_row   echo.app_user;
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
    v_org := p_join_org;
  elsif nullif(btrim(p_org_name), '') is not null then
    -- the NAME is the join key: exact (case-insensitive) match against the
    -- ACTIVE orgs. Zero matches and a typo look identical on purpose.
    select min(o.id::text)::uuid, count(*) into v_org, v_count
      from echo.org o
     where o.status = 'active'
       and lower(btrim(o.name)) = lower(btrim(p_org_name));
    if v_count = 0 then
      raise exception 'no such organization' using errcode = 'foreign_key_violation';
    end if;
    if v_count > 1 then
      -- two orgs sharing a name cannot be told apart by it — the honest
      -- answer is "this door needs an invitation", never a coin flip
      raise exception 'more than one organization has this name'
        using errcode = 'cardinality_violation';
    end if;
  else
    -- NO founding branch any more — this raise is the wall the user asked
    -- for, at the altitude walls live (an api check alone could be routed
    -- around by the next caller)
    raise exception 'an organization name is required — new organizations are created by the platform'
      using errcode = 'foreign_key_violation';
  end if;

  -- always a MEMBER, always PENDING: acceptance is the org's decision
  -- (invitations bypass this whole function via redeem_invitation_for_email)
  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (p_user_id, v_org, p_email, coalesce(btrim(p_display_name), ''), 'member', 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

comment on function echo.register_account(uuid, citext, text, text, uuid) is
  'The only way an app_user row is created without an existing identity. '
  'JOIN-ONLY since 0082: the org name must match an existing active org and '
  'the arrival is a pending MEMBER — founding is gone; orgs are created by '
  'platform_create_org (root-only) and owners are made in the platform '
  'console. Invitations (0060) remain the instant, active-on-arrival path.';

-- ─── the org birth path, now that signup no longer founds ──────────────────

alter type echo.platform_audit_action add value if not exists 'org_created';

create function echo.platform_create_org(
  p_actor  uuid,
  p_name   text,
  p_locale text,
  p_reason text
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_name   text;
  v_org    uuid;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  v_name := btrim(coalesce(p_name, ''));
  if length(v_name) = 0 then
    raise exception 'organization name cannot be empty' using errcode = 'check_violation';
  end if;
  -- names are JOIN KEYS now (register_account matches on them): a
  -- duplicate would make the existing org unjoinable-by-name forever
  if exists (
    select 1 from echo.org o
     where o.status = 'active' and lower(btrim(o.name)) = lower(v_name)
  ) then
    raise exception 'an active organization already has this name'
      using errcode = 'unique_violation';
  end if;

  insert into echo.org (name, locale)
  values (v_name, coalesce(nullif(btrim(p_locale), ''), 'fa'))
  returning id into v_org;

  perform echo.record_platform_audit(p_actor, 'org_created', null, v_org, v_reason);
  return v_org;
end;
$$;

revoke all on function echo.platform_create_org(uuid, text, text, text) from public;
grant execute on function echo.platform_create_org(uuid, text, text, text) to echo_app;

comment on function echo.platform_create_org(uuid, text, text, text) is
  'Organizations are born HERE and nowhere else (0082): root-walled, audited, duplicate-name-refusing — the name is the signup join key.';
