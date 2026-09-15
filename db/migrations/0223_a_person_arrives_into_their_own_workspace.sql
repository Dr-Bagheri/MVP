-- 0223 — a person arrives into their own workspace, and a team is what a
--        workspace becomes (M54; user directive 2026-09-15: "we mostly built
--        it for B2B but we need it for B2C as well … start with B2C and then
--        if they want they can make it a B2B platform")
--
-- What this reverses, said plainly: 0082 deleted `register_account`'s
-- founding branch because "the first login for everyone is owner" was a hole
-- in a platform with ONE organisation and a queue of strangers trying to get
-- into it. That was right for that platform. For a person who found the site
-- and wants to try it, the same rule reads «awaiting approval» and they leave.
--
-- What comes back is 0056's shape and 0056's own sentence — the confirmed
-- email IS the acceptance — in ONE branch: no invitation, no organisation
-- named, and NOTHING MARKED `accepts_signups`. That person founds a workspace
-- of their own (`kind = 'personal'`) and is its ACTIVE OWNER. A workspace of
-- one contains nothing anybody else could leak into, which is the whole of
-- why 0056 was safe and why it is safe again.
--
-- What does NOT change, because it is the wall:
--   · a NAME never becomes a membership — typing another organisation's name
--     still joins it PENDING (0082);
--   · an invitation is still the instant door (0060);
--   · `accepts_signups` still means MANAGED INTAKE: mark one org and every
--     bare arrival pends there for the console to place (0149/0156). That flag
--     is now the switch between today's B2B behaviour and the B2C default,
--     and it needs no new setting — the console already has it.
--
-- 0150's fallback ("no mark → the oldest active org") is GONE. It existed so
-- the door was never shut for want of a setting; a workspace of one's own is
-- the better never-shut, and the oldest org receiving every stranger on the
-- deployment was only ever tolerable while a root was placing each one.
--
-- Rebuilt on 0150's body — its true predecessor — with the one branch
-- changed and nothing else touched (the 0155 lesson: `create or replace`
-- accepts a stale body as cheerfully as a current one).

-- ─── what a workspace IS ───────────────────────────────────────────────────
alter table echo.org
  add column kind text not null default 'team'
    check (kind in ('personal', 'team'));

comment on column echo.org.kind is
  '0223: personal (founded by its one member at arrival) or team. A word for '
  'the shell and for copy — no wall reads it. Flips personal → team by the act '
  'of inviting (tg_invitation_makes_a_team) and never flips back. Every org '
  'that existed before 0223 is a team: all were born in the console or as demos.';

-- ─── what a person has done so far ────────────────────────────────────────
-- The first-time flow's answers, and the stamp that ends it. JSONB rather than
-- columns: the questions are copy, they will change, and none of them gates
-- anything — a column per question would be a migration per rewording.
alter table echo.app_user
  add column onboarding jsonb not null default '{}'::jsonb,
  add column onboarding_completed_at timestamptz;

comment on column echo.app_user.onboarding is
  '0223: what the person told the first-time flow (goals, work, source, …). '
  'Merged by PATCH /v1/me/onboarding; never read by a wall or a policy.';
comment on column echo.app_user.onboarding_completed_at is
  '0223: NULL = the first-time flow has not been finished (the shell routes '
  'there). Stamped once. Backfilled for every member active before this '
  'migration: a first-run flow shown to somebody who has used the product for '
  'a month reads as a bug.';

grant update (onboarding, onboarding_completed_at) on echo.app_user to echo_app;

-- everybody who is already in is already onboarded — including the agents'
-- seats (0171), which are app_user rows and would otherwise be "pending a
-- flow" nobody can run for them
update echo.app_user
   set onboarding_completed_at = coalesce(accepted_at, created_at)
 where status = 'active'
   and onboarding_completed_at is null;

-- ─── registration: the founding branch, in its one narrow shape ───────────
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
  v_org    uuid;
  v_count  integer;
  v_row    echo.app_user;
  v_name   text;
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
    -- MANAGED INTAKE, when an operator chose it (0149): the marked org
    -- receives the arrival as a pending member and the console places them.
    select o.id into v_org
      from echo.org o
     where o.accepts_signups and o.status = 'active';

    if v_org is null then
      -- 0223: nothing marked → A WORKSPACE OF THEIR OWN. The org is named
      -- after the person (0149's lesson: asking a stranger to name a company
      -- they do not have is a question they cannot answer), and the person is
      -- its active owner — the confirmed email is the acceptance (0056).
      v_name := coalesce(nullif(btrim(p_display_name), ''),
                         split_part(p_email::text, '@', 1),
                         p_email::text);
      insert into echo.org (name, kind)
      values (v_name, 'personal')
      returning id into v_org;

      insert into echo.app_user
        (id, org_id, email, display_name, role, status, accepted_at, accepted_by)
      values
        (p_user_id, v_org, p_email, coalesce(btrim(p_display_name), ''),
         'owner', 'active', now(), null)
      returning * into v_row;
      return v_row;
    end if;
  end if;

  -- every other path: a MEMBER, PENDING — acceptance is the org's decision
  -- (invitations bypass this whole function via redeem_invitation_for_email)
  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (p_user_id, v_org, p_email, coalesce(btrim(p_display_name), ''), 'member', 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

comment on function echo.register_account(uuid, citext, text, text, uuid) is
  'The only way an app_user row is created without an existing identity. '
  'Since 0223: a bare registration with NO org marked accepts_signups FOUNDS a '
  'personal workspace (kind=personal) with the arrival as its active OWNER — '
  'the confirmed email is the acceptance. With an org marked, the arrival joins '
  'it PENDING (managed intake, the console places them). A NAME still joins the '
  'named org PENDING (0082). Invitations (0060) remain the instant path.';

-- ─── inviting is what makes a team ────────────────────────────────────────
-- SECURITY DEFINER: the inviter's own RLS on `org` is not the point here (an
-- admin can update their org row anyway); the point is that the flip is the
-- ACT's, in the same statement, so no state exists where a personal
-- workspace holds an invitation. Idempotent by its WHERE.
create function echo.tg_invitation_makes_a_team() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update echo.org set kind = 'team' where id = new.org_id and kind = 'personal';
  return new;
end;
$$;

create trigger invitation_makes_a_team
  before insert on echo.invitation
  for each row execute function echo.tg_invitation_makes_a_team();

-- a new function is PUBLIC's to execute by default (0204's lesson, learned by
-- the agent-wall test): a trigger function cannot be called directly, but the
-- wall is asserted as STRUCTURE and a definer door with a PUBLIC grant is
-- what it looks for
revoke all on function echo.tg_invitation_makes_a_team() from public;

comment on function echo.tg_invitation_makes_a_team() is
  '0223: a personal workspace becomes a team the moment it invites somebody. '
  'Never the other way.';

-- "never the other way" is a trigger, not a sentence: a team that loses its
-- last colleague is still the thing its owner built, and a row flipped back
-- to personal by an admin's PATCH would make the shell hide the roster that
-- team still has. Raised as a check_violation so the api maps it as a 400.
create function echo.tg_org_kind_one_way() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.kind = 'team' and new.kind = 'personal' then
    raise exception 'a team does not become a personal workspace again'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger org_kind_one_way
  before update of kind on echo.org
  for each row execute function echo.tg_org_kind_one_way();
revoke all on function echo.tg_org_kind_one_way() from public;

-- ─── self-checks ──────────────────────────────────────────────────────────
-- The whole block rolls back through the restrict_violation at its foot, so
-- nothing it makes persists — including the temporary un-marking of an
-- intake org this deployment may carry (the probe must run in BOTH modes
-- whatever the live setting is).
do $$
declare
  v_marked   uuid;
  v_person   uuid := '00000000-0000-0000-0000-000000000223'::uuid;
  v_row      echo.app_user;
  v_kind     text;
  v_failed   text;
  v_intake   uuid;
begin
  -- an auth identity is required by 0002's FK and 0171's trigger
  insert into auth.users (id, email)
  values (v_person, 'signup-check-0223@example.test')
  on conflict (id) do nothing;

  -- (0) the backfill left no active member un-onboarded — checked BEFORE the
  --     probe founds anything, since every org it makes gets agent seats
  --     (0171) that are active and, rightly, not onboarded
  if exists (select 1 from echo.app_user u
              where u.status = 'active' and u.onboarding_completed_at is null) then
    raise exception '0223 FAILED: an active member was left with no onboarding stamp';
  end if;

  -- (0b) whatever the deployment marked, unmark it for the probe (rolled back)
  update echo.org set accepts_signups = false where accepts_signups;

  -- (1) THE ORDINARY PATH: nothing marked → a personal workspace, owned,
  --     active, not yet onboarded
  v_row := echo.register_account(v_person, 'signup-check-0223@example.test'::citext, 'کاربر آزمایشی');
  if v_row.role <> 'owner' or v_row.status <> 'active' then
    raise exception '0223 FAILED: a bare arrival is not an active owner (got %/%)', v_row.role, v_row.status;
  end if;
  if v_row.accepted_at is null or v_row.accepted_by is not null then
    raise exception '0223 FAILED: the acceptance stamp is not the platform''s';
  end if;
  if v_row.onboarding_completed_at is not null then
    raise exception '0223 FAILED: a new arrival was born onboarded';
  end if;
  select o.kind into v_kind from echo.org o where o.id = v_row.org_id;
  if v_kind is distinct from 'personal' then
    raise exception '0223 FAILED: the founded workspace is not personal (got %)', v_kind;
  end if;
  if (select o.name from echo.org o where o.id = v_row.org_id) <> 'کاربر آزمایشی' then
    raise exception '0223 FAILED: the workspace is not named after the person';
  end if;
  -- the agents took their seats (0171's trigger fires on this insert too)
  if (select count(*) from echo.app_user u where u.org_id = v_row.org_id and u.kind = 'agent') = 0 then
    raise exception '0223 FAILED: a personal workspace has no agent seats';
  end if;

  -- (2) INVITING MAKES A TEAM — and only from personal
  insert into echo.invitation (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
  values (v_row.org_id, 'colleague-0223@example.test', 'member', v_person,
          repeat('a', 64), 'echo_inv_', now() + interval '1 day');
  select o.kind into v_kind from echo.org o where o.id = v_row.org_id;
  if v_kind is distinct from 'team' then
    raise exception '0223 FAILED: an invitation did not make the workspace a team';
  end if;

  -- (3) THE OTHER MODE: an org marked as intake still receives arrivals
  --     PENDING — managed intake is intact, and it is the switch
  delete from echo.invitation where invited_by = v_person;
  delete from echo.app_user where id = v_person;
  insert into echo.org (name, accepts_signups) values ('0223 intake', true) returning id into v_intake;
  v_row := echo.register_account(v_person, 'signup-check-0223@example.test'::citext, 'کاربر آزمایشی');
  if v_row.org_id is distinct from v_intake or v_row.status <> 'pending' or v_row.role <> 'member' then
    raise exception '0223 FAILED: managed intake stopped pending arrivals in the marked org';
  end if;

  -- (4) A NAME STILL JOINS PENDING (0082's wall, untouched)
  delete from echo.app_user where id = v_person;
  v_row := echo.register_account(v_person, 'signup-check-0223@example.test'::citext, 'کاربر آزمایشی', '0223 intake');
  if v_row.status <> 'pending' or v_row.role <> 'member' then
    raise exception '0223 FAILED: a name-join stopped being a pending membership';
  end if;

  -- (4b) and a team never becomes personal again
  begin
    update echo.org set kind = 'personal' where id = v_row.org_id;
    v_failed := 'a team was flipped back to personal';
  exception when check_violation then
    v_failed := null;
  end;
  if v_failed is not null then raise exception '0223 FAILED: %', v_failed; end if;

  -- (5) the kind is a closed set
  begin
    insert into echo.org (name, kind) values ('0223 club', 'club');
    v_failed := 'a third kind of organisation was accepted';
  exception when check_violation then
    v_failed := null;
  end;
  if v_failed is not null then raise exception '0223 FAILED: %', v_failed; end if;

  raise notice '0223 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
