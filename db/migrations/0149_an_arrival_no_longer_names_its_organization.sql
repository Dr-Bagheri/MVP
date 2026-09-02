-- 0149 — an arrival no longer has to name its organization
--
-- User directive (2026-09-02): "after someone login don't ask for
-- organization, just put it on waiting and tell it that admin must accept
-- its entry, and in platform version it must come in pending users for
-- acceptance."
--
-- What was there: 0082 closed the founding branch — a bare registration
-- raised, and the sign-in screen answered by asking the arrival to type the
-- name of an org they had usually never been told. Typing it exactly was the
-- price of getting into the queue, and getting it wrong looked identical to
-- not being welcome.
--
-- What replaces it: ONE organization may be marked as the one that receives
-- arrivals. A bare registration lands there as a pending member, exactly as a
-- name-join always did, and the org's admins (or the platform root) accept.
-- The typing is gone; the acceptance is not.
--
-- Two decisions worth their lines:
--
--  * AT MOST ONE, enforced by a partial unique index rather than a check in
--    the function. Two orgs accepting signups is a coin flip over which one
--    a stranger joins — the same reasoning 0082 used to refuse a duplicate
--    NAME, and the same fix: make the wrong state unrepresentable rather
--    than watched for. (D9 / rule 11: structure, not a predicate.)
--
--  * DEFAULT FALSE, and no backfill. Nobody's door opens because a migration
--    ran; the platform root turns exactly one on, deliberately, through the
--    audited operation below. Until then a bare registration raises with a
--    sentence naming the missing setting instead of blaming the arrival.

alter table echo.org
  add column accepts_signups boolean not null default false;

comment on column echo.org.accepts_signups is
  'Receives bare registrations (0149). At most one org platform-wide may '
  'carry it — the partial unique index below is the enforcement; the flag '
  'is set only by platform_set_org_signups, which is root-walled and audited.';

-- The whole rule, as structure. `((true))` gives every flagged row the same
-- index key, so a second one collides.
create unique index org_one_signup_target
  on echo.org ((true))
  where accepts_signups;

-- ─── registration resolves it, instead of demanding a name ────────────────
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
    -- the NAME is still a join key when one is supplied: exact
    -- (case-insensitive) match against the ACTIVE orgs. Zero matches and a
    -- typo look identical on purpose.
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
    -- 0149: no name given, so the platform's own arrivals org receives them.
    -- Still NOT a founding branch: this joins an org that already exists and
    -- was deliberately marked, and the arrival is still pending.
    select o.id into v_org
      from echo.org o
     where o.accepts_signups and o.status = 'active';
    if v_org is null then
      -- a MISSING SETTING, said as one. The old sentence here blamed the
      -- arrival for not naming an organization; this one names the thing an
      -- operator has to do, because that is who can fix it.
      raise exception 'no organization is accepting new members — the platform must mark one'
        using errcode = 'foreign_key_violation';
    end if;
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
  'JOIN-ONLY since 0082, and since 0149 a bare registration joins the org '
  'flagged accepts_signups — always as a PENDING member. Founding is gone; '
  'orgs are created by platform_create_org (root-only). Invitations (0060) '
  'remain the instant, active-on-arrival path.';

-- ─── the flag's only setter ───────────────────────────────────────────────
alter type echo.platform_audit_action add value if not exists 'org_signups_set';

create function echo.platform_set_org_signups(
  p_actor  uuid,
  p_org    uuid,
  p_on     boolean,
  p_reason text
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  if p_on then
    -- turning one ON turns the other OFF, in the same statement: the index
    -- would refuse the pair anyway, and making the operator clear the old
    -- one first is a two-step dance whose failure mode is "the door is shut
    -- and nobody noticed".
    update echo.org set accepts_signups = false where accepts_signups and id <> p_org;
    perform 1 from echo.org o where o.id = p_org and o.status = 'active';
    if not found then
      raise exception 'no such active organization' using errcode = 'foreign_key_violation';
    end if;
  end if;

  update echo.org set accepts_signups = coalesce(p_on, false) where id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'foreign_key_violation';
  end if;

  perform echo.record_platform_audit(p_actor, 'org_signups_set', null, p_org, v_reason);
end;
$$;

revoke all on function echo.platform_set_org_signups(uuid, uuid, boolean, text) from public;
grant execute on function echo.platform_set_org_signups(uuid, uuid, boolean, text) to echo_app;

comment on function echo.platform_set_org_signups(uuid, uuid, boolean, text) is
  'Marks the ONE org that receives bare registrations (0149): root-walled, '
  'audited, and it clears the previous holder in the same statement so the '
  'door is never shut by a half-finished move.';

-- ─── self-checks ──────────────────────────────────────────────────────────
do $$
declare
  v_a uuid;
  v_b uuid;
begin
  -- (1) at most one org may accept signups, and the DATABASE is what says so
  insert into echo.org (name) values ('0149 check a') returning id into v_a;
  insert into echo.org (name) values ('0149 check b') returning id into v_b;
  update echo.org set accepts_signups = true where id = v_a;
  begin
    update echo.org set accepts_signups = true where id = v_b;
    raise exception '0149 FAILED: two organizations accepted signups at once';
  exception when unique_violation then
    null;  -- the index refused it, which is the whole design
  end;

  -- (2) a bare registration with the flag NOWHERE names the missing setting
  update echo.org set accepts_signups = false where id in (v_a, v_b);
  begin
    perform echo.register_account(
      '00000000-0000-0000-0000-000000000149'::uuid, 'nobody@example.test'::citext);
    raise exception '0149 FAILED: a bare registration succeeded with no arrivals org';
  exception when foreign_key_violation then
    null;
  end;

  delete from echo.org where id in (v_a, v_b);
end $$;

do $$
begin
  -- (3) the setter is root-walled: it must NOT be callable by a non-root
  --     actor, and the refusal is the wall's, not a comment's
  if has_function_privilege('echo_agent',
       'echo.platform_set_org_signups(uuid, uuid, boolean, text)', 'execute') then
    raise exception '0149 FAILED: the agent role may set the signup target';
  end if;
  if not has_function_privilege('echo_app',
       'echo.platform_set_org_signups(uuid, uuid, boolean, text)', 'execute') then
    raise exception '0149 FAILED: the app role cannot reach the setter it needs';
  end if;
end $$;
