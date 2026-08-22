-- NeurAI Platform — 0082: the OAuth sign-in allow-list (user directive,
-- 2026-08-22: "add an option … for google and github login that if they
-- are in the list of the table they can login … not everyone must be able
-- to do it. it checks and tells you if you can or can not go in first
-- regarding your email in the root platform in the acceptable table").
--
-- One table of EMAILS, managed by the PLATFORM ROOT (the M32 control
-- plane, 0066's pattern exactly: FORCE RLS, definer functions,
-- require_platform_root first, metadata-only audit lines). The gate is
-- checked at the OAuth callback: a Google/GitHub arrival whose verified
-- email is not listed is told so and never enters. Email+password sign-in
-- is untouched — the directive named the external providers.
--
-- SEEDED with the platform root's own address: an empty list would close
-- OAuth entirely, and the person who owns the console must not be able to
-- lock themselves out of it in the act of turning the feature on.

create table echo.oauth_allowlist (
  email    public.citext primary key,
  note     text not null default '',
  added_by uuid references echo.app_user(id) on delete set null,
  added_at timestamptz not null default now()
);

comment on table echo.oauth_allowlist is
  'Which emails may ENTER via Google/GitHub OAuth (0082). Managed by platform root only; the gate runs at the OAuth callback. Email+password is unaffected.';

alter table echo.oauth_allowlist enable row level security;
alter table echo.oauth_allowlist force row level security;
-- no policies for app roles at all: reads and writes go through the
-- definer functions below, exactly like the other control-plane tables

insert into echo.oauth_allowlist (email, note)
values ('neurai.git.acc@gmail.com', 'seeded — the platform root (0082); prevents self-lockout');

alter type echo.platform_audit_action add value if not exists 'oauth_allowed';
alter type echo.platform_audit_action add value if not exists 'oauth_disallowed';

-- ─── THE GATE: is this verified email allowed through OAuth? ───────────────
-- Pre-membership by nature (the caller authenticated with the provider but
-- may not be anyone yet), so echo_app calls it actor-less. It answers ONE
-- bit about an email THE CALLER ALREADY HOLDS a verified token for — no
-- enumeration surface beyond what the caller proved they own.
create function echo.oauth_email_allowed(p_email text) returns boolean
  language sql
  stable
  security definer
  set search_path = 'public'
as $$
  select exists (
    select 1 from echo.oauth_allowlist a where a.email = p_email::citext
  );
$$;

revoke all on function echo.oauth_email_allowed(text) from public;
grant execute on function echo.oauth_email_allowed(text) to echo_app;

-- ─── ROOT: list / allow / disallow ─────────────────────────────────────────
create function echo.platform_oauth_allowlist(p_actor uuid)
  returns table (email public.citext, note text, added_by uuid, added_at timestamptz)
  language plpgsql
  security definer
  set search_path = 'public'
as $$
begin
  perform echo.require_platform_root(p_actor);
  return query
    select a.email, a.note, a.added_by, a.added_at
      from echo.oauth_allowlist a
     order by a.added_at desc;
end;
$$;

create function echo.platform_oauth_allow(
  p_actor  uuid,
  p_email  text,
  p_note   text,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = 'public'
as $$
declare
  v_reason text;
  v_email  public.citext;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);
  v_email := btrim(coalesce(p_email, ''))::public.citext;
  if length(v_email::text) = 0 or position('@' in v_email::text) = 0 then
    raise exception 'a valid email is required' using errcode = 'check_violation';
  end if;
  insert into echo.oauth_allowlist (email, note, added_by)
  values (v_email, coalesce(btrim(p_note), ''), p_actor)
  on conflict (email) do update
    set note = excluded.note;
  -- the EMAIL deliberately does not ride the audit line (metadata-only
  -- discipline); the reason is where the operator says who and why
  perform echo.record_platform_audit(p_actor, 'oauth_allowed', null, null, v_reason);
  return true;
end;
$$;

create function echo.platform_oauth_disallow(
  p_actor  uuid,
  p_email  text,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = 'public'
as $$
declare
  v_reason text;
  v_found  boolean;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);
  delete from echo.oauth_allowlist where email = btrim(coalesce(p_email, ''))::public.citext
  returning true into v_found;
  if v_found is null then
    raise exception 'that email is not on the list' using errcode = 'no_data_found';
  end if;
  perform echo.record_platform_audit(p_actor, 'oauth_disallowed', null, null, v_reason);
  return true;
end;
$$;

revoke all on function echo.platform_oauth_allowlist(uuid) from public;
revoke all on function echo.platform_oauth_allow(uuid, text, text, text) from public;
revoke all on function echo.platform_oauth_disallow(uuid, text, text) from public;
grant execute on function echo.platform_oauth_allowlist(uuid) to echo_app;
grant execute on function echo.platform_oauth_allow(uuid, text, text, text) to echo_app;
grant execute on function echo.platform_oauth_disallow(uuid, text, text) to echo_app;
