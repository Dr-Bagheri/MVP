-- 0218 — a demo organisation is born whole, and says so on its own row.
--
-- Added 2026-09-09: a "Seed a demo organization" action in the platform
-- console — a fourth tab that creates a complete, rehearsable organisation on
-- a chosen date, in English or Persian, shows the presenter's credentials
-- once, lists what exists, and can re-seed or remove one.
--
-- Three doors and one column. Each is here rather than in core for a reason
-- that is about AUTHORITY, not convenience.
--
-- ── the column ─────────────────────────────────────────────────────────────
-- `echo.org.demo jsonb` records {seeded_at, language, demo_date, seeded_by,
-- reseeded_at}. It is a column and not a table because it is exactly one
-- value per organisation with no lifetime of its own: as a table it would
-- need policies, grants, a purge line and an entry in every coverage check —
-- four places to get wrong for one fact. It is jsonb and not five columns
-- because nothing joins on it, nothing sorts by it, and the shape will grow
-- (0145's own lesson about narrow columns cuts the other way when the value
-- is a note about provenance).
--
-- Its presence is also a CAPABILITY: `demo is not null` is what makes
-- platform_clear_demo_org safe to point at an organisation at all. A door
-- that empties an organisation must be unable to name a real customer's, and
-- the cheapest way to make a wrong state unrepresentable is to require a flag
-- that only this feature ever writes.
--
-- ── platform_create_demo_org ───────────────────────────────────────────────
-- Creating an organisation is already root-walled and audited (0082); this
-- door does the same and ALSO seats the people, in ONE statement run. It is
-- not "platform_create_org plus five calls" because the intermediate state —
-- an organisation with no owner — is one the product has no name for: RLS
-- reads the actor's org, and an org whose only member does not exist yet is
-- invisible to everybody including the person who just made it. One
-- transaction means that state is never observable and never has to be
-- cleaned up.
--
-- The auth identities are NOT created here. `app_user.id` IS the
-- `auth.users.id` for a human (0171 replaced the foreign key with a trigger
-- that still demands the identity), and only the Supabase Auth admin API can
-- mint one. So core mints them first and supplies the ids; the door refuses
-- an id that is not authable, which is the trigger doing its job rather than
-- a second copy of the rule here.
--
-- The agents are NOT created here either, and that is 0171 working as
-- designed: `org_provision_agents` fires AFTER INSERT on echo.org, so Roya
-- and Ava arrive with the organisation. Provisioning them by hand would be a
-- second spelling of a rule that already runs.
--
-- ── platform_clear_demo_org ────────────────────────────────────────────────
-- Re-seeding for a new date must remove the CONTENT and keep the ACCOUNTS:
-- the credentials were shown once, and a re-seed that invalidated them would
-- make the shown-once panel a lie.
--
-- It deletes DYNAMICALLY — every table in `echo` carrying `org_id`, except
-- `app_user` (the accounts) and `deletion_record` (which cascades from the
-- org) — retrying the ones that fail on a foreign key until nothing is left.
-- The obvious alternative was to copy platform_purge_org's enumerated list
-- minus its last two lines, and it was refused on the evidence: that list has
-- been WRONG twice (0132's regeneration, and 0145, where thirteen tables the
-- purge had never learned made it raise for any org that had used those
-- features). An enumeration is a promise somebody has to keep by hand on
-- every new table; the catalogue keeps itself. The FK graph decides the
-- order, so nobody has to know it, and a cycle is a named refusal rather than
-- a silent partial clear.
--
-- The one thing the loop cannot discover is a CYCLE, and there is exactly one
-- (workflow ↔ workflow_version), broken the same way the purge breaks it: by
-- nulling the pointer first.
--
-- ── platform_demo_orgs ─────────────────────────────────────────────────────
-- A separate read door rather than widening `platform_list_orgs`, whose
-- `RETURNS TABLE` is a contract — 0152 shipped as a live 500 because a body
-- selected a column its own signature did not declare, and changing that
-- signature means DROP and CREATE and re-granting. A console tab that needs
-- five columns nothing else wants gets its own door.
--
-- ── what this migration does NOT do ────────────────────────────────────────
-- No behavioural self-check calls these doors, and the reason is mechanical:
-- this migration ADDS two `platform_audit_action` values, and a new enum
-- value cannot be used in the transaction that created it. The self-checks at
-- the foot therefore assert STRUCTURE — the column, the security posture, the
-- ACLs, the guard's presence in each body. The behaviour is asserted by
-- db/test/125_demo_org.sql, which runs after every migration has landed and
-- can walk the whole matrix.

begin;

-- ── the column ─────────────────────────────────────────────────────────────
alter table echo.org
  add column demo jsonb,
  add constraint org_demo_is_object
    check (demo is null or jsonb_typeof(demo) = 'object');

comment on column echo.org.demo is
  '0218: set only by the platform console''s demo seeder — {seeded_at, language, demo_date, seeded_by, reseeded_at}. Its presence is what allows platform_clear_demo_org to empty this organisation; a customer''s org has NULL here and cannot be named by that door.';

-- ── the audit vocabulary ───────────────────────────────────────────────────
-- Deliberately distinct from 'org_created': a demo organisation arrives with
-- five active accounts and a password that was handed to a person, and an
-- audit line that could not be told apart from an ordinary creation would
-- hide exactly the entry a reviewer is looking for.
alter type echo.platform_audit_action add value if not exists 'demo_org_created';
alter type echo.platform_audit_action add value if not exists 'demo_org_reseeded';

-- ── CREATE: the organisation, its owner and its members, in one run ────────
create function echo.platform_create_demo_org(
  p_actor    uuid,
  p_name     text,
  p_language text,
  p_demo_date date,
  p_people   jsonb,
  p_reason   text
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_reason  text;
  v_name    text;
  v_org     uuid;
  v_owners  integer;
  v_count   integer;
  v_person  jsonb;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  v_name := btrim(coalesce(p_name, ''));
  if length(v_name) = 0 then
    raise exception 'organization name cannot be empty' using errcode = 'check_violation';
  end if;
  -- 0082's rule, and it is not decoration: names are the signup JOIN KEY, so
  -- a duplicate would make the existing organisation unjoinable by name.
  if exists (
    select 1 from echo.org o
     where o.status = 'active' and lower(btrim(o.name)) = lower(v_name)
  ) then
    raise exception 'an active organization already has this name'
      using errcode = 'unique_violation';
  end if;

  if p_language is null or p_language not in ('en', 'fa') then
    raise exception 'demo language must be en or fa'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_demo_date is null then
    raise exception 'a demo date is required' using errcode = 'invalid_parameter_value';
  end if;

  if p_people is null or jsonb_typeof(p_people) <> 'array' then
    raise exception 'people must be a json array' using errcode = 'invalid_parameter_value';
  end if;
  v_count := jsonb_array_length(p_people);
  if v_count < 2 or v_count > 25 then
    raise exception 'a demo organization has between 2 and 25 people'
      using errcode = 'invalid_parameter_value';
  end if;

  -- exactly one owner. Not "at least one": two owners in a seeded org is a
  -- shape the product never produces, and the shown-once panel names ONE
  -- person, so a second owner would be an account nobody was told about.
  select count(*) into v_owners
    from jsonb_array_elements(p_people) e
   where e->>'role' = 'owner';
  if v_owners <> 1 then
    raise exception 'a demo organization has exactly one owner, got %', v_owners
      using errcode = 'invalid_parameter_value';
  end if;

  for v_person in select e from jsonb_array_elements(p_people) e loop
    if coalesce(v_person->>'id', '') = ''
       or coalesce(btrim(v_person->>'email'), '') = ''
       or coalesce(btrim(v_person->>'display_name'), '') = '' then
      raise exception 'every person needs an id, an email and a display name'
        using errcode = 'invalid_parameter_value';
    end if;
    if coalesce(v_person->>'role', 'member') not in ('owner', 'member', 'admin') then
      raise exception 'a demo person is an owner, an admin or a member'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  insert into echo.org (name, locale, demo)
  values (
    v_name,
    p_language,
    jsonb_build_object(
      'seeded_at', to_jsonb(now()),
      'language', p_language,
      'demo_date', to_jsonb(p_demo_date),
      'seeded_by', to_jsonb(p_actor)
    )
  )
  returning id into v_org;

  -- The seats. `accepted_at` is stamped and `accepted_by` is NULL — M15's own
  -- spelling for "the vendor did this, no member of this organisation
  -- accepted anybody". The timezone is the demo's zone for everyone, because
  -- an organisation whose meetings are in Tehran and whose members read them
  -- in the browser's zone is a demo that shows the wrong hour.
  insert into echo.app_user
    (id, org_id, email, display_name, display_name_en, username, job_title,
     role, status, locale, timezone, accepted_at, accepted_by)
  select
    (e->>'id')::uuid,
    v_org,
    btrim(e->>'email')::public.citext,
    btrim(e->>'display_name'),
    nullif(btrim(coalesce(e->>'display_name_en', '')), ''),
    nullif(btrim(coalesce(e->>'username', '')), ''),
    nullif(btrim(coalesce(e->>'job_title', '')), ''),
    coalesce(e->>'role', 'member')::echo.member_role,
    'active'::echo.user_status,
    p_language,
    'Asia/Tehran',
    now(),
    null
  from jsonb_array_elements(p_people) e;

  perform echo.record_platform_audit(
    p_actor, 'demo_org_created', null, v_org,
    v_reason || ' [demo: ' || p_language || ', ' || p_demo_date::text || ']');
  return v_org;
end;
$fn$;

revoke all on function echo.platform_create_demo_org(uuid, text, text, date, jsonb, text) from public;
grant execute on function echo.platform_create_demo_org(uuid, text, text, date, jsonb, text) to echo_app;

comment on function echo.platform_create_demo_org(uuid, text, text, date, jsonb, text) is
  '0218: a demo organisation and its people in one statement run — root-walled, audited, and refusing an organisation with no owner. The auth identities are minted by core before this is called; the agents arrive on the org insert (0171).';

-- ── CLEAR: the content goes, the accounts stay ─────────────────────────────
create function echo.platform_clear_demo_org(
  p_actor     uuid,
  p_org       uuid,
  p_demo_date date,
  p_reason    text
) returns integer
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_reason    text;
  v_demo      jsonb;
  v_deleted   integer := 0;
  v_rows      integer;
  v_pending   text[];
  v_next      text[];
  v_table     text;
  v_progress  boolean;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select o.demo into v_demo from echo.org o where o.id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  -- THE wall. Everything below empties an organisation; this is the line that
  -- makes it impossible to point at one that is not a demo.
  if v_demo is null then
    raise exception 'only a demo organization can be cleared'
      using errcode = 'check_violation';
  end if;

  -- the one cycle the FK graph cannot resolve by retrying (0145 broke it the
  -- same way in the purge): a workflow points at its current version and the
  -- version points back
  update echo.workflow set current_version_id = null where org_id = p_org;

  -- Every org-scoped table, from the CATALOGUE. `app_user` is the point of
  -- this door; `deletion_record` cascades from the organisation and is
  -- excepted with that reason in db/test/125.
  select array_agg(c.relname order by c.relname) into v_pending
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
   where n.nspname = 'echo'
     and c.relkind = 'r'
     and a.attname = 'org_id'
     and not a.attisdropped
     and c.relname not in ('app_user', 'deletion_record');

  while array_length(v_pending, 1) is not null loop
    v_progress := false;
    v_next := '{}';
    foreach v_table in array v_pending loop
      begin
        execute format('delete from echo.%I where org_id = $1', v_table) using p_org;
        get diagnostics v_rows = row_count;
        v_deleted := v_deleted + v_rows;
        v_progress := true;
      exception when foreign_key_violation then
        -- a child is still standing; it will be gone on a later pass
        v_next := v_next || v_table;
      end;
    end loop;
    if not v_progress then
      raise exception 'cannot clear the demo organization: a cycle remains among %', v_next
        using errcode = 'foreign_key_violation';
    end if;
    v_pending := v_next;
  end loop;

  update echo.org
     set demo = v_demo
                || jsonb_build_object('demo_date', to_jsonb(p_demo_date))
                || jsonb_build_object('reseeded_at', to_jsonb(now()))
                || jsonb_build_object('reseeded_by', to_jsonb(p_actor))
   where id = p_org;

  perform echo.record_platform_audit(
    p_actor, 'demo_org_reseeded', null, p_org,
    v_reason || ' [cleared ' || v_deleted::text || ' rows for ' || p_demo_date::text || ']');
  return v_deleted;
end;
$fn$;

revoke all on function echo.platform_clear_demo_org(uuid, uuid, date, text) from public;
grant execute on function echo.platform_clear_demo_org(uuid, uuid, date, text) to echo_app;

comment on function echo.platform_clear_demo_org(uuid, uuid, date, text) is
  '0218: empty a DEMO organisation of content and keep its accounts, so a re-seed for a new date does not invalidate credentials that were shown once. Refuses any organisation whose `demo` is null.';

-- ── READ: which organisations are demos ────────────────────────────────────
create function echo.platform_demo_orgs(p_actor uuid)
returns table (
  id           uuid,
  name         text,
  status       echo.org_status,
  locale       text,
  created_at   timestamptz,
  deleted_at   timestamptz,
  demo         jsonb,
  owner_email  text,
  member_count integer
)
  language plpgsql
  security definer
  set search_path = ''
as $fn$
begin
  perform echo.require_platform_root(p_actor);
  return query
    select o.id, o.name, o.status, o.locale, o.created_at, o.deleted_at, o.demo,
           (select u.email::text from echo.app_user u
             where u.org_id = o.id and u.role = 'owner' and u.kind = 'human'
             order by u.created_at limit 1),
           (select count(*)::integer from echo.app_user u
             where u.org_id = o.id and u.kind = 'human')
      from echo.org o
     where o.demo is not null
     order by o.created_at desc;
end;
$fn$;

revoke all on function echo.platform_demo_orgs(uuid) from public;
grant execute on function echo.platform_demo_orgs(uuid) to echo_app;

comment on function echo.platform_demo_orgs(uuid) is
  '0218: the demo tab''s list. Its own door rather than a wider platform_list_orgs, whose RETURNS TABLE is a contract (0152).';

-- ── self-checks ────────────────────────────────────────────────────────────
-- STRUCTURE only, and the reason is mechanical rather than a preference: this
-- file adds two enum values, and a new value cannot be USED in the
-- transaction that added it — so no check here may call a door that names
-- one. db/test/125_demo_org.sql walks the behaviour.
do $check$
declare
  v_sig    text;
  v_acl    aclitem[];
  v_def    text;
  v_kind   text;
  v_secdef boolean;
  v_config text[];
begin
  select data_type into v_kind
    from information_schema.columns
   where table_schema = 'echo' and table_name = 'org' and column_name = 'demo';
  if v_kind is distinct from 'jsonb' then
    raise exception '0218: echo.org.demo is % , not jsonb', coalesce(v_kind, '(absent)');
  end if;

  foreach v_sig in array array[
    'echo.platform_create_demo_org(uuid, text, text, date, jsonb, text)',
    'echo.platform_clear_demo_org(uuid, uuid, date, text)',
    'echo.platform_demo_orgs(uuid)'
  ] loop
    -- A NULL acl does not mean "no grants", it means "the defaults", and the
    -- default is EXECUTE to PUBLIC. 0204 shipped a door that way and
    -- db/test/30_agent_wall.sql caught it; this is that lesson, written where
    -- the door is born rather than in the migration that repairs it.
    select p.proacl into v_acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.oid = v_sig::regprocedure;
    if v_acl is null then
      raise exception '0218: % has a null ACL — null means PUBLIC may call it', v_sig;
    end if;
    if has_function_privilege('public', v_sig, 'EXECUTE') then
      raise exception '0218: PUBLIC can still execute %', v_sig;
    end if;
    if not has_function_privilege('echo_app', v_sig, 'EXECUTE') then
      raise exception '0218: echo_app cannot execute % — the console would 42501', v_sig;
    end if;
    if has_function_privilege('echo_agent', v_sig, 'EXECUTE')
       or has_function_privilege('echo_purge', v_sig, 'EXECUTE') then
      raise exception '0218: % is reachable from a role that is not the api', v_sig;
    end if;

    select p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
      into v_secdef, v_config, v_def
      from pg_proc p where p.oid = v_sig::regprocedure;
    if not v_secdef then
      raise exception '0218: % is not security definer', v_sig;
    end if;
    if v_def !~ 'require_platform_root' then
      raise exception '0218: % does not ask require_platform_root', v_sig;
    end if;
    -- BOTH spellings are the empty path: Postgres stores it quoted, and a
    -- check demanding only the bare form refused its own correct function
    -- once already (0204).
    if v_config is null
       or not (v_config @> array['search_path='] or v_config @> array['search_path=""']) then
      raise exception '0218: % does not pin an empty search_path', v_sig;
    end if;
  end loop;

  -- the clear door's wall is a LINE IN ITS BODY, and the standing test proves
  -- it fires; asserting it is present here means a later `create or replace`
  -- that drops it cannot land quietly
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'echo.platform_clear_demo_org(uuid, uuid, date, text)'::regprocedure;
  if v_def !~ 'only a demo organization can be cleared' then
    raise exception '0218: the clear door lost the guard that keeps it off a real organisation';
  end if;
  if v_def !~ 'app_user' then
    raise exception '0218: the clear door no longer names app_user as the table it keeps';
  end if;
end
$check$;

commit;
