-- 0150 — the door is never closed
--
-- User report (2026-09-02), looking at their own sign-in screen: "why the
-- login is closed — I said that like before, a pending section after they
-- gave their password set, they have to wait until the owner accept them
-- from platform control."
--
-- They are right, and 0149 is what closed it. That migration made a bare
-- registration join the ONE org flagged `accepts_signups`, and flagged
-- nothing — so the honest refusal it added ("no organization is accepting
-- new members") became the answer for every arrival until an operator
-- pressed a button nobody had been told about. Removing a question from the
-- form and adding a chore to the console is not what was asked for.
--
-- The flag stays; what changes is what happens when it is unset. It is a
-- CHOICE now, not a precondition: mark an org and arrivals go there; mark
-- none and they go to the oldest active organization, which is the one that
-- has been receiving people all along. Either way they land PENDING and the
-- owner accepts them from the platform console, which was the whole design.
--
-- Why the OLDEST rather than, say, the largest: it is the one fact about
-- this that cannot change under someone. A count moves as people join and
-- leave, so "the biggest org receives signups" would silently hand the door
-- to a different organization on an ordinary Tuesday. `created_at` never
-- moves.

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
      raise exception 'more than one organization has this name'
        using errcode = 'cardinality_violation';
    end if;
  else
    -- 0150: the marked org if there is one, otherwise the oldest active
    -- organization. Two reads rather than one coalesce so the intent is
    -- legible: a deliberate choice first, a stable default second.
    select o.id into v_org
      from echo.org o
     where o.accepts_signups and o.status = 'active';
    if v_org is null then
      select o.id into v_org
        from echo.org o
       where o.status = 'active'
       order by o.created_at, o.id
       limit 1;
    end if;
    if v_org is null then
      -- the only remaining nothing: a platform with no active organization
      -- at all. Nobody can be joined to a place that does not exist, and
      -- saying so beats a foreign-key error from one line down.
      raise exception 'this platform has no active organization to join'
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
  'JOIN-ONLY since 0082; since 0150 a bare registration joins the org marked '
  'accepts_signups, or the oldest active org when none is marked — always as '
  'a PENDING member, never refused for want of a setting. Founding is gone; '
  'orgs are created by platform_create_org (root-only). Invitations (0060) '
  'remain the instant, active-on-arrival path.';

-- ─── self-checks ──────────────────────────────────────────────────────────
do $$
declare
  v_marked uuid;
  v_user   uuid := '00000000-0000-0000-0000-000000000150'::uuid;
  v_org_of uuid;
  v_oldest uuid;
begin
  -- the oldest active org is what an unmarked platform uses
  select o.id into v_oldest
    from echo.org o where o.status = 'active' order by o.created_at, o.id limit 1;
  if v_oldest is null then
    raise exception '0150 CHECK SKIPPED: no active org — this fixture cannot run';
  end if;

  -- an auth identity is required by 0002's FK, so borrow a real one
  insert into auth.users (id, email)
  values (v_user, 'signup-check-0150@example.test')
  on conflict (id) do nothing;

  perform echo.register_account(v_user, 'signup-check-0150@example.test'::citext, 'کاربر آزمایشی');
  select u.org_id into v_org_of from echo.app_user u where u.id = v_user;
  if v_org_of is distinct from v_oldest then
    raise exception '0150 FAILED: an unmarked platform did not use the oldest active org';
  end if;
  if (select u.status from echo.app_user u where u.id = v_user) <> 'pending' then
    raise exception '0150 FAILED: the arrival was not PENDING';
  end if;

  -- and a MARKED org wins over the oldest — the choice still decides
  delete from echo.app_user where id = v_user;
  insert into echo.org (name, accepts_signups) values ('0150 marked', true) returning id into v_marked;
  perform echo.register_account(v_user, 'signup-check-0150@example.test'::citext, 'کاربر آزمایشی');
  select u.org_id into v_org_of from echo.app_user u where u.id = v_user;
  if v_org_of is distinct from v_marked then
    raise exception '0150 FAILED: the marked organization did not receive the arrival';
  end if;

  delete from echo.app_user where id = v_user;
  delete from echo.org where id = v_marked;
  delete from auth.users where id = v_user;
end $$;
