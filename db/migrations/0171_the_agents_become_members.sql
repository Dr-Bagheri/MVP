-- 0171 — the agents become members
--
-- USER DIRECTIVE, 2026-09-03, choosing Buzz's model over the two cheaper ones:
-- "Give them real identities. Each agent gets its own actor row, its own role,
-- its own RLS scope, and can act when nobody is watching ... gave them admin
-- roles and make them members of the platform."
--
-- ── WHAT THIS CHANGES, SAID PLAINLY ────────────────────────────────────────
--
-- Until now an agent was a CONFIGURATION ROW: a name, a prompt, a tool list.
-- Every read it made ran under the identity of the person who asked, which is
-- invariant 2 ("the agent borrows the caller's authority and never more").
--
-- After this it is a MEMBER. `echo.app_user` gains rows whose `kind` is
-- 'agent', and RLS answers for them exactly as it answers for a person —
-- because they ARE people as far as the wall is concerned, which is the whole
-- reason this is the smallest possible version of the change. No new policy
-- family, no second wall, no `or is_an_agent()` disjunction bolted onto forty
-- existing policies. One column, and the existing wall does the rest.
--
-- That is also why Buzz's model is buildable here at all. Their agents have
-- their own keypair and their own channel membership; ours get their own
-- app_user row and their own org membership. Same idea, different substrate.
--
-- ── THE COST, ON THE RECORD ────────────────────────────────────────────────
--
-- Invariant 2 is AMENDED, not quietly bypassed. An agent acting on its own
-- behalf does not borrow anybody's authority — it has its own, and at `admin`
-- it reaches what an admin reaches. That is the user's explicit ruling and it
-- is what makes unattended work possible at all; a helper that can only act
-- while somebody watches cannot do the thing being asked for.
--
-- What does NOT change, and is the reason this is safe enough to build:
--   · the agent's DB ROLE is still `echo_agent`, which holds no DELETE on any
--     product table. An agent cannot destroy, only add and amend.
--   · everything that leaves the building still goes through a human door:
--     mail drafts are INSERT-only for echo_agent (0114), member messages are
--     echo_app's alone (0167), write tools emit proposals a person confirms.
--   · `owner` stays a human role. An agent is an admin, never an owner, so
--     the doors that require ownership — transferring ownership, restoring a
--     deleted call — remain closed to it.
--   · the audit trail now names the AGENT. That is strictly more honest than
--     what we had, where an agent's reads were recorded against the person who
--     happened to ask.
--
-- ── THE auth.users PROBLEM, AND WHY A TRIGGER ──────────────────────────────
--
-- `app_user.id` has a foreign key to `auth.users(id)`: every member is an
-- authentication identity. An agent is not — it has no password, no email, no
-- way to sign in, and giving it one would be a door that exists for nobody.
--
-- A conditional foreign key is not expressible, so the FK is replaced by a
-- trigger that enforces the SAME rule for humans and stays out of the way for
-- agents. This repo's own preference is a constraint over a predicate, and
-- that preference is not being ignored — it cannot be honoured here, so the
-- checks below assert both directions: a human id that is not an auth identity
-- is still refused, and an agent id is still accepted.

begin;

create type echo.actor_kind as enum ('human', 'agent');

alter table echo.app_user
  add column kind echo.actor_kind not null default 'human',
  -- which agent this row IS. NULL for a person; the handle for a seat.
  add column agent_handle text
    check (agent_handle is null or agent_handle ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  add constraint app_user_agent_shape check (
    (kind = 'human' and agent_handle is null)
 or (kind = 'agent' and agent_handle is not null)
  );

comment on column echo.app_user.kind is
  '0171: is this member a person or an agent. Agents are members — RLS answers for them exactly as for a person — but they have no auth identity and never sign in.';
comment on column echo.app_user.agent_handle is
  '0171: for kind = agent, which assistant_agent this seat belongs to. One seat per agent per org.';

-- one seat per agent per organisation
create unique index app_user_agent_seat_key
  on echo.app_user (org_id, agent_handle) where kind = 'agent';

-- ── the auth identity rule, for humans only ────────────────────────────────
do $$
begin
  if to_regclass('auth.users') is not null then
    alter table echo.app_user drop constraint if exists app_user_auth_fk;
  end if;
end $$;

create or replace function echo.tg_app_user_is_authable() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- exactly what the foreign key said, for the rows it was about
  if new.kind = 'human'
     and to_regclass('auth.users') is not null
     and not exists (select 1 from auth.users u where u.id = new.id) then
    raise exception 'a human member must be an authentication identity'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

create trigger app_user_is_authable
  before insert or update of id, kind on echo.app_user
  for each row execute function echo.tg_app_user_is_authable();

-- ── kind is immutable ──────────────────────────────────────────────────────
-- A person turned into an agent would keep their calls, their tasks and their
-- history while losing the account that owns them; an agent turned into a
-- person would be an admin nobody can sign in as. Neither is a state anything
-- downstream is written for.
create or replace function echo.tg_app_user_kind_frozen() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     or new.agent_handle is distinct from old.agent_handle then
    raise exception 'what a member IS does not change'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger app_user_kind_frozen
  before update on echo.app_user
  for each row execute function echo.tg_app_user_kind_frozen();

-- ── the seats ──────────────────────────────────────────────────────────────
-- A definer door, because creating a member is admin-gated by policy and this
-- has to work for an organisation that has no admin awake — at registration,
-- and in the backfill below.
create or replace function echo.provision_agent_seats(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_made integer := 0;
  v_agent record;
begin
  for v_agent in
    select handle, name from echo.assistant_agent
     where level = 'system' and enabled and archived_at is null
  loop
    -- idempotent: the seat is the (org, handle) pair, and re-running must not
    -- mint a second one or disturb one somebody has already used
    if not exists (
      select 1 from echo.app_user
       where org_id = p_org and kind = 'agent' and agent_handle = v_agent.handle
    ) then
      insert into echo.app_user
        (id, org_id, email, display_name, role, status, kind, agent_handle,
         accepted_at, accepted_by)
      values (
        gen_random_uuid(), p_org,
        -- deterministic, unique, and visibly not a mailbox: nothing delivers
        -- here and the shape says so at a glance
        v_agent.handle || '.' || replace(p_org::text, '-', '') || '@agents.neurai.invalid',
        v_agent.name,
        'admin',            -- the user's ruling, 2026-09-03
        'active',
        'agent', v_agent.handle,
        now(),
        null                -- nobody accepted them; the platform provisioned them
      );
      v_made := v_made + 1;
    end if;
  end loop;
  return v_made;
end $fn$;

revoke all on function echo.provision_agent_seats(uuid) from public;
grant execute on function echo.provision_agent_seats(uuid) to echo_app;

comment on function echo.provision_agent_seats(uuid) is
  '0171: give every shipped agent a seat in this organisation. Idempotent. Called by the trigger on org insert and by the backfill.';

-- every NEW organisation gets them, without anybody remembering to ask
create or replace function echo.tg_org_provision_agents() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform echo.provision_agent_seats(new.id);
  return new;
end $$;

create trigger org_provision_agents
  after insert on echo.org
  for each row execute function echo.tg_org_provision_agents();

-- ...and every organisation that already exists
do $$
declare v_org record; v_total integer := 0;
begin
  for v_org in select id from echo.org loop
    v_total := v_total + echo.provision_agent_seats(v_org.id);
  end loop;
  raise notice '0171: provisioned % agent seat(s)', v_total;
end $$;

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare v_org uuid; v_failed boolean; v_seats int; v_agents int;
begin
  select id into v_org from echo.org limit 1;
  if v_org is null then
    raise notice '0171: no organisation in this database — the behavioural checks did not run, result unknown';
    return;
  end if;

  -- THE ORDINARY PATH: every org has one active admin seat per shipped agent
  select count(*) into v_agents from echo.assistant_agent
   where level = 'system' and enabled and archived_at is null;
  select count(*) into v_seats from echo.app_user
   where org_id = v_org and kind = 'agent';
  if v_seats <> v_agents then
    raise exception 'CHECK FAILED: % seats for % shipped agents', v_seats, v_agents;
  end if;
  if exists (
    select 1 from echo.app_user
     where org_id = v_org and kind = 'agent'
       and (role <> 'admin' or status <> 'active')
  ) then
    raise exception 'CHECK FAILED: an agent seat is not an active admin';
  end if;

  -- and they are ADMINS, never owners: the doors that need ownership stay shut
  if exists (select 1 from echo.app_user where kind = 'agent' and role = 'owner') then
    raise exception 'CHECK FAILED: an agent holds the owner role';
  end if;

  -- idempotent: running it again mints nothing
  if echo.provision_agent_seats(v_org) <> 0 then
    raise exception 'CHECK FAILED: provisioning twice made a second seat';
  end if;

  -- a human id that is not an auth identity is STILL refused — the trigger
  -- keeps exactly what the foreign key kept
  if to_regclass('auth.users') is not null then
    v_failed := false;
    begin
      insert into echo.app_user (id, org_id, email, display_name, status)
      values (gen_random_uuid(), v_org, 'ghost@example.invalid', 'ghost', 'pending');
    exception when others then v_failed := true;
    end;
    if not v_failed then
      raise exception 'CHECK FAILED: a human with no auth identity was accepted';
    end if;
  end if;

  -- what a member IS does not change
  v_failed := false;
  begin
    update echo.app_user set kind = 'human', agent_handle = null
     where org_id = v_org and kind = 'agent';
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'CHECK FAILED: an agent was turned into a person';
  end if;

  -- the shape constraint holds both ways
  v_failed := false;
  begin
    insert into echo.app_user (id, org_id, email, display_name, status, kind, agent_handle, accepted_at)
    values (gen_random_uuid(), v_org, 'x@agents.neurai.invalid', 'x', 'active', 'agent', null, now());
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'CHECK FAILED: an agent seat with no handle was accepted';
  end if;
end $chk$;

commit;
