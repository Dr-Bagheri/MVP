-- 0215 — a skill keeps every version of itself.
--
-- Item 16: an organisation writes its own procedures in Persian, in the
-- product, and from then on an agent runs them. The authoring surface has
-- existed since 0007; what it lacked is the thing that makes a procedure
-- something a team can rely on — **a change you can see and undo**.
--
-- Today an edit is destructive. The operations lead rewrites «روش پذیرش
-- مشتری جدید», the agent's behaviour changes for everybody in the
-- organisation from that second, and the previous wording is gone. That is
-- fine for a draft and wrong for a procedure: the question people actually
-- ask about one is «what did this used to say», and there was no answer.
--
-- ── THE TRIGGER IS THE WRITER, AND NOBODY ELSE ────────────────────────────
--
-- No role holds INSERT, UPDATE or DELETE on this table. A version is appended
-- by a trigger on `echo.skill`, so "every edit is recorded" is a fact about
-- the database rather than a thing the api has to remember on four routes —
-- `record_status_change` (0040) set that precedent and its reasoning holds
-- exactly: the api can neither author a history nor omit one.
--
-- ── WHY THE ROW CARRIES level / org_id / user_id ──────────────────────────
--
-- So its read policy can be the SKILL'S OWN PREDICATE, word for word, over
-- its own columns — rather than an `exists (select … from echo.skill …)`,
-- which runs as the caller and silently intersects with that table's
-- policies (rule 11's author-side corollary). They cannot drift from the
-- skill's, because the trigger copies them and nothing else may write here.
--
-- ── RESTORING IS AN EDIT, NOT A REWIND ────────────────────────────────────
--
-- There is no operation here that moves a skill back. The api restores by
-- WRITING an old body onto the skill through the ordinary update, which
-- appends a new version — so version 7 may say what version 3 said, and the
-- history only ever grows. A ledger that can go backwards cannot be read as
-- one, which is the same argument 0211 made about a superseded decision.

begin;

create table echo.skill_version (
  id          uuid primary key default gen_random_uuid(),
  skill_id    uuid not null references echo.skill(id) on delete cascade,
  /* the skill's own three, copied by the trigger — see the header */
  level       echo.skill_level not null,
  org_id      uuid references echo.org(id),
  user_id     uuid references echo.app_user(id),

  version     integer not null check (version >= 1),
  name        text not null,
  description text not null,
  prompt      text not null,
  model       text,
  tools       jsonb not null,

  /* who saved it. NULL = a migration did (a system skill), the same spelling
     M15 uses for "the vendor did this" */
  created_by  uuid references echo.app_user(id),
  created_at  timestamptz not null default now(),

  constraint skill_version_tools_is_array check (jsonb_typeof(tools) = 'array'),
  constraint skill_version_one_per_number unique (skill_id, version)
);

comment on table echo.skill_version is
  '0215: every saved wording of a skill, appended by a trigger. No role writes here; restoring is an ordinary edit that appends a new version, never a rewind.';

create index skill_version_skill_idx on echo.skill_version (skill_id, version desc);

alter table echo.skill_version enable row level security;
alter table echo.skill_version force row level security;

/* 0018's `skill_read`, word for word, over this table's own copies of the
   three columns it reads. A version is visible exactly when its skill is. */
create policy skill_version_read on echo.skill_version for select to echo_app, echo_agent
  using (
    echo.actor_is_active()
    and (
      level = 'system'
      or (org_id = echo.actor_org_id()
          and (level = 'org' or user_id = echo.actor_id()))
    )
  );

grant select on echo.skill_version to echo_app, echo_agent;
/* and NOTHING else. The trigger below is the only writer there is. */

-- ── the writer ────────────────────────────────────────────────────────────

create function echo.tg_skill_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  /*
   * ONLY A CHANGE TO THE WORDING.
   *
   * Enabling, archiving and renaming the slug are STATE, not text: a version
   * per toggle would bury the four edits that matter in forty that do not,
   * and the question this table answers is «what did it used to say».
   */
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name
     and new.description is not distinct from old.description
     and new.prompt is not distinct from old.prompt
     and new.model is not distinct from old.model
     and new.tools is not distinct from old.tools then
    return new;
  end if;

  select coalesce(max(version), 0) + 1 into v_next
    from echo.skill_version where skill_id = new.id;

  insert into echo.skill_version
    (skill_id, level, org_id, user_id, version, name, description, prompt, model, tools, created_by)
  values
    (new.id, new.level, new.org_id, new.user_id, v_next,
     new.name, new.description, new.prompt, new.model, new.tools,
     /* the actor, when there is one. A migration seeding a system skill has
        none, and inventing one would put a person's name on a row they never
        touched. */
     echo.actor_id());
  return new;
end $$;

comment on function echo.tg_skill_version() is
  '0215 (D8-enumerated): appends a skill_version whenever a skill''s WORDING changes. Definer because no role may write that table — which is what stops a version being forged or skipped.';

revoke all on function echo.tg_skill_version() from public;

create trigger skill_version_append
  after insert or update on echo.skill
  for each row execute function echo.tg_skill_version();

-- ── the purge learns it ───────────────────────────────────────────────────
--
-- 0145's rule: an org-scoped table the purge does not name makes the purge
-- RAISE for any org that used the feature. Regenerated from the function's
-- own definition (0132), never retyped.
do $regen$
declare
  v_def text;
  v_anchor constant text := '  delete from echo.project_member         where org_id = p_org;';
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position(v_anchor in v_def) = 0 then
    raise exception
      'the purge body has moved on: its project_member line is not where this migration expects it. Re-read the function before editing it.';
  end if;
  if position('echo.skill_version' in v_def) > 0 then
    raise exception 'the purge already names echo.skill_version';
  end if;

  v_def := replace(
    v_def, v_anchor,
    '  delete from echo.skill_version          where org_id = p_org;' || E'\n' || v_anchor);
  execute v_def;
end $regen$;

-- ── backfill: every skill that exists gets its version 1 ──────────────────
--
-- Without this a skill written before today has an empty history, and its
-- first edit would produce a version 1 that is actually its second wording —
-- a history that starts by being wrong about itself.
insert into echo.skill_version
  (skill_id, level, org_id, user_id, version, name, description, prompt, model, tools, created_by, created_at)
select s.id, s.level, s.org_id, s.user_id, 1,
       s.name, s.description, s.prompt, s.model, s.tools,
       null, s.created_at
  from echo.skill s
 where not exists (select 1 from echo.skill_version v where v.skill_id = s.id);

-- ── self-checks ───────────────────────────────────────────────────────────
do $check$
declare
  v_org  uuid;
  v_user uuid;
  v_id   uuid;
  v_n    int;
  v_def  text;
begin
  -- 1. NOBODY WRITES A VERSION BY HAND. This is the wall: a history the api
  --    can author is a history the api can also forge.
  if has_table_privilege('echo_app', 'echo.skill_version', 'INSERT')
     or has_table_privilege('echo_agent', 'echo.skill_version', 'INSERT')
     or has_table_privilege('echo_app', 'echo.skill_version', 'UPDATE')
     or has_table_privilege('echo_app', 'echo.skill_version', 'DELETE') then
    raise exception '0215: a product role can write skill_version by hand';
  end if;
  -- the discriminating half: a table nobody can READ would pass the line
  -- above and be completely useless
  if not has_table_privilege('echo_app', 'echo.skill_version', 'SELECT') then
    raise exception '0215: nobody can read a skill''s history either';
  end if;

  -- 2. EVERY EXISTING SKILL HAS A HISTORY.
  select count(*) into v_n from echo.skill s
   where not exists (select 1 from echo.skill_version v where v.skill_id = s.id);
  if v_n <> 0 then
    raise exception '0215: % skills have no version 1 — the backfill missed them', v_n;
  end if;

  -- 3. THE TRIGGER APPENDS, AND ONLY FOR THE WORDING. The accept half plus
  --    its discriminator: every assertion above holds for a trigger that
  --    never fires.
  select id into v_org from echo.org order by created_at limit 1;
  select id into v_user from echo.app_user where org_id = v_org and status = 'active' limit 1;
  if v_org is not null and v_user is not null then
    insert into echo.skill (level, org_id, slug, name, description, prompt, created_by)
    values ('org', v_org, 'selfcheck-0215', 'سلف‌چک', '', 'نسخهٔ یک', v_user)
    returning id into v_id;

    select count(*) into v_n from echo.skill_version where skill_id = v_id;
    if v_n <> 1 then raise exception '0215: a new skill did not get version 1 (got %)', v_n; end if;

    update echo.skill set prompt = 'نسخهٔ دو' where id = v_id;
    select count(*) into v_n from echo.skill_version where skill_id = v_id;
    if v_n <> 2 then raise exception '0215: an edited prompt did not append a version (got %)', v_n; end if;

    /* THE DISCRIMINATOR: a state change is not an edit */
    update echo.skill set enabled = false where id = v_id;
    select count(*) into v_n from echo.skill_version where skill_id = v_id;
    if v_n <> 2 then raise exception '0215: toggling `enabled` appended a version (got %)', v_n; end if;

    delete from echo.skill where id = v_id;
    select count(*) into v_n from echo.skill_version where skill_id = v_id;
    if v_n <> 0 then raise exception '0215: versions outlived their skill'; end if;
  end if;

  -- 4. THE PURGE NAMES IT, and still names what it named before.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if position('delete from echo.skill_version' in v_def) = 0 then
    raise exception '0215: the purge does not delete skill versions';
  end if;
  if position('delete from echo.project_member' in v_def) = 0 then
    raise exception '0215: the regenerated purge lost project_member';
  end if;
end $check$;

commit;
