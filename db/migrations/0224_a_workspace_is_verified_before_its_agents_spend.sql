-- db/0224 — a workspace is verified before its agents spend (M54, 2026-09-16).
--
-- User ruling (2026-09-16): "after they enter they must need a verification
-- so they can use the full system — the agents on the system use tokens, so
-- if all can use it, it becomes problematic; for now I verify them to start
-- using the agents, later we change it. Now I want them to have an easy
-- entry."
--
-- So the door stays open (0223: a stranger founds a workspace and is in) and
-- what waits for the platform's word is the SPEND. `org.verified_at` is the
-- fact; null means "nobody at the platform has looked at this workspace yet".
--
-- Where the wall is, and why it is a trigger rather than a route check: every
-- model call this product makes opens an `agent_run` first (invariant 5, the
-- runtime's step 3), from the assistant, the room's agents, the workflows,
-- the summarizer and the four pollers alike. A BEFORE INSERT on that table
-- refuses the run for an unverified organisation on every one of those paths
-- at once — including the path somebody adds next month without reading
-- this file. core/ pre-checks the same fact where a person is watching so the
-- refusal arrives as a sentence rather than as a 42501 inside a stream; that
-- is courtesy. This is the wall.
--
-- What is NOT gated: recording, transcription, the board, the rooms, the
-- meetings, the connections — the product. Only the runs that spend tokens.
--
-- Who verifies: the platform root, through the console (`platform_set_org_
-- verified`, both directions — a verification the operator cannot take back
-- is a door with no exit, D27). Every organisation that exists on the day this
-- lands is verified from the moment it was born: nothing changes for anybody
-- already here. The founding branch of register_account is the ONE writer of
-- an unverified row.

-- ─── the fact ─────────────────────────────────────────────────────────────
alter table echo.org
  add column verified_at timestamptz default now();

-- every organisation alive today has been looked at by definition — the
-- platform made or accepted each one — so it is verified since it was born,
-- not since this migration ran (the stamp is a date somebody may read)
update echo.org set verified_at = created_at;

comment on column echo.org.verified_at is
  '0224: when the platform verified this workspace for agent use (model '
  'spend). NULL = founded by a stranger through the gate and not yet looked '
  'at: its agent_run inserts are refused by tg_agent_run_needs_verified_org. '
  'Defaults to now(), so every birth but register_account''s founding branch '
  'is verified from its first second. Set through platform_set_org_verified.';

-- ─── the founding branch writes null ──────────────────────────────────────
-- Rebuilt from 0223's body (copied by the builder, one insert patched), not
-- retyped: `create or replace` accepts a stale body as cheerfully as a
-- current one (0155).
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
      -- 0224: founded UNVERIFIED. This is the one path that makes an
      -- organisation nobody at the platform has looked at; every other birth
      -- (the console, a demo, a seed) takes the column's default and is
      -- verified from its first second.
      insert into echo.org (name, kind, verified_at)
      values (v_name, 'personal', null)
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
  'named org PENDING (0082). Invitations (0060) remain the instant path. '
  'Since 0224: the founded workspace is UNVERIFIED (org.verified_at null) until '
  'the platform verifies it — its agents cannot spend until then.';

-- ─── the wall ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER so the read of echo.org does not depend on which role is
-- inserting (echo_app, echo_agent) or on whether an actor is set: the wall
-- must answer the same way for every caller. The errcode is the one the api
-- already maps to a refusal, and the HINT carries the code core/ turns into a
-- sentence — the message itself is never shown to a person.
create function echo.tg_agent_run_needs_verified_org() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if not exists (
    select 1 from echo.org o where o.id = new.org_id and o.verified_at is not null
  ) then
    raise exception 'this workspace is not verified yet; its agents cannot run'
      using errcode = 'insufficient_privilege', hint = 'org_unverified';
  end if;
  return new;
end;
$$;

create trigger agent_run_needs_verified_org
  before insert on echo.agent_run
  for each row execute function echo.tg_agent_run_needs_verified_org();

-- a new function is PUBLIC's to execute by default (0204, 0223)
revoke all on function echo.tg_agent_run_needs_verified_org() from public;

comment on function echo.tg_agent_run_needs_verified_org() is
  '0224: no agent_run for an unverified organisation — the wall under every '
  'model-spending path at once. HINT org_unverified is the code core/ maps.';

-- ─── the console's door, both directions ──────────────────────────────────
alter type echo.platform_audit_action add value if not exists 'org_verification_set';

create function echo.platform_set_org_verified(
  p_actor  uuid,
  p_org    uuid,
  p_on     boolean,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_now    boolean;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select (o.verified_at is not null) into v_now from echo.org o where o.id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'foreign_key_violation';
  end if;
  -- a no-op is not a change (0186): nothing written, nothing audited
  if v_now = coalesce(p_on, false) then
    return false;
  end if;

  update echo.org
     set verified_at = case when p_on then now() else null end
   where id = p_org;

  perform echo.record_platform_audit(p_actor, 'org_verification_set', null, p_org, v_reason);
  return true;
end;
$$;

revoke all on function echo.platform_set_org_verified(uuid, uuid, boolean, text) from public;
grant execute on function echo.platform_set_org_verified(uuid, uuid, boolean, text) to echo_app;

comment on function echo.platform_set_org_verified(uuid, uuid, boolean, text) is
  '0224: the platform root verifies a workspace for agent use, or takes it '
  'back. Audited as org_verification_set. Returns whether anything changed.';

-- ─── the list door carries the fact ───────────────────────────────────────
-- DROP first: `create or replace` cannot change a RETURNS TABLE (0152). The
-- grant goes with the drop and is restored below in the same transaction.
drop function if exists echo.platform_list_orgs();

create function echo.platform_list_orgs()
returns table (
  id              uuid,
  name            text,
  status          text,
  locale          text,
  accepts_signups boolean,
  verified_at     timestamptz,
  created_at      timestamptz,
  deleted_at      timestamptz,
  purge_after     timestamptz,
  member_count    bigint
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
           o.accepts_signups, o.verified_at,
           o.created_at, o.deleted_at, o.purge_after,
           count(u.id) as member_count
      from echo.org o
      left join echo.app_user u on u.org_id = o.id
     group by o.id;
end;
$$;

revoke all on function echo.platform_list_orgs() from public;
grant execute on function echo.platform_list_orgs() to echo_app;

comment on function echo.platform_list_orgs() is
  'The console''s cross-org sight (0091), widened in 0152 to carry '
  'accepts_signups and in 0224 to carry verified_at. Its RETURNS TABLE is a '
  'CONTRACT: a caller cannot select a column this does not return, and the '
  '42703 that says so reaches the screen as "could not load".';

-- ─── self-checks ──────────────────────────────────────────────────────────
-- Rolled back whole through the restrict_violation at the foot, 0223's shape.
-- The console door is NOT called here: its audit value was added to the enum
-- in this same transaction and Postgres refuses to USE a new enum value
-- before the transaction that added it commits. db/test/128 walks it.
do $$
declare
  v_person uuid := '00000000-0000-0000-0000-000000000224'::uuid;
  v_row    echo.app_user;
  v_marked uuid;
  v_cols   text;
  v_failed text;
  v_ok     boolean;
begin
  -- (0) the backfill left nobody unverified
  if exists (select 1 from echo.org where verified_at is null) then
    raise exception '0224 FAILED: an organisation alive before this migration is unverified';
  end if;

  -- (1) the list door returns the fact, and is still walled and granted
  select string_agg(p.proargnames[i], ',' order by i) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
         generate_subscripts(p.proargnames, 1) i
   where n.nspname = 'echo' and p.proname = 'platform_list_orgs';
  if v_cols is null or position('verified_at' in v_cols) = 0 then
    raise exception '0224 FAILED: the door does not return verified_at (returns: %)', v_cols;
  end if;
  if position('require_platform_root' in
      (select pg_get_functiondef(p.oid) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'echo' and p.proname = 'platform_list_orgs')) = 0 then
    raise exception '0224 FAILED: the door lost its platform-root guard';
  end if;
  if not has_function_privilege('echo_app', 'echo.platform_list_orgs()', 'execute') then
    raise exception '0224 FAILED: the app role lost execute on the console door';
  end if;
  if has_function_privilege('echo_agent', 'echo.platform_list_orgs()', 'execute') then
    raise exception '0224 FAILED: the agent role may list every organization';
  end if;

  -- (2) no new door is PUBLIC's (0204's class, asserted by 30_agent_wall too)
  if has_function_privilege('public', 'echo.tg_agent_run_needs_verified_org()', 'execute')
     or has_function_privilege('public', 'echo.platform_set_org_verified(uuid, uuid, boolean, text)', 'execute') then
    raise exception '0224 FAILED: a new door is PUBLIC''s to execute';
  end if;

  -- (3) a stranger's founding writes an UNVERIFIED workspace; the probe runs
  --     in B2C mode whatever the live setting is (0223's own device)
  select o.id into v_marked from echo.org o where o.accepts_signups;
  if v_marked is not null then
    update echo.org set accepts_signups = false where id = v_marked;
  end if;
  insert into auth.users (id, email)
  values (v_person, 'verify-check-0224@example.test')
  on conflict (id) do nothing;
  v_row := echo.register_account(v_person, 'verify-check-0224@example.test'::citext, 'Verify Probe');
  if (select verified_at from echo.org where id = v_row.org_id) is not null then
    raise exception '0224 FAILED: a workspace founded through the gate is born verified';
  end if;

  -- (4) the wall: the founded workspace's agent cannot open a run …
  begin
    insert into echo.agent_run (org_id, actor_id, kind, model)
    values (v_row.org_id, v_person, 'assistant', 'probe/0224');
    v_failed := 'an unverified organisation opened an agent run';
  exception when insufficient_privilege then
    v_failed := null;
  end;
  if v_failed is not null then raise exception '0224 FAILED: %', v_failed; end if;

  -- (5) … and can the moment it is verified — the control, without which (4)
  --     is satisfied by a trigger that refuses everyone
  update echo.org set verified_at = now() where id = v_row.org_id;
  insert into echo.agent_run (org_id, actor_id, kind, model)
  values (v_row.org_id, v_person, 'assistant', 'probe/0224');

  -- (6) any other birth is verified by default
  insert into echo.org (name) values ('0224 console-born') returning (verified_at is not null) into v_ok;
  if not v_ok then
    raise exception '0224 FAILED: an organisation made outside the gate is born unverified';
  end if;

  raise notice '0224 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
