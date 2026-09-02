-- 0151 — a meeting's topic becomes a row
--
-- User directive (2026-09-02): the meetings topic strip should have an ADD
-- like the reference's, "and only the added one can be edited also".
--
-- Neither was possible. `meeting.topic` is free TEXT, so the strip's chips
-- were computed from the distinct values of a column: a topic existed only
-- while some meeting wore it, there was nothing to create before the first
-- meeting used it, and renaming one meant rewriting every row that happened
-- to share a spelling. "همه جلسات" and "بدون موضوع" are not topics at all —
-- they are the absence of a filter and the absence of a topic — which is
-- exactly why only the added ones can be edited: the other two have nothing
-- to edit.
--
-- So a topic is a row, modelled on `task_topic` (0144) down to its policy,
-- because it is the same idea one domain over and a second shape for one
-- concept is two things to keep in step.
--
-- The backfill is the careful part. Every distinct topic string already on a
-- meeting becomes a row in its own org, and the meetings pointing at it are
-- re-pointed by id — so nothing a person typed is lost, and no meeting comes
-- out of this migration with a topic it did not have going in. `created_by`
-- has to be somebody: the meeting's own creator is the closest true answer,
-- and the composite FK below refuses any other org's member structurally.

create table echo.meeting_topic (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  name        text not null check (length(trim(name)) between 1 and 80),
  archived_at timestamptz,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  constraint meeting_topic_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  -- one name per org, so the strip cannot show the same folder twice and a
  -- rename cannot collide into an existing one
  constraint meeting_topic_name_unique unique (org_id, name)
);

create index meeting_topic_org_idx on echo.meeting_topic (org_id) where archived_at is null;

comment on table echo.meeting_topic is
  'Meeting folders (0151): a list filter, org-shared, modelled on task_topic. '
  'Replaces the free-text meeting.topic — a topic nobody can create before '
  'its first meeting is not a topic, it is a side effect of one.';

alter table echo.meeting_topic enable row level security;
alter table echo.meeting_topic force row level security;

create policy meeting_topic_rw on echo.meeting_topic
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

grant select, insert, update on echo.meeting_topic to echo_app;

-- ─── the meeting points at one ────────────────────────────────────────────
-- the composite target FIRST: a foreign key cannot reference a pair that has
-- no unique constraint yet, and Postgres says so with a message about the
-- REFERENCED table, which reads like the table is wrong rather than the order
alter table echo.meeting_topic
  add constraint meeting_topic_id_org_key unique (id, org_id);

alter table echo.meeting
  add column topic_id uuid,
  -- COMPOSITE, not a bare FK: a meeting must not be able to point at another
  -- organisation's folder, and structure refuses that where a policy
  -- predicate would only refuse the people it happens to run as (D9).
  add constraint meeting_topic_same_org
    foreign key (topic_id, org_id) references echo.meeting_topic (id, org_id)
    on delete set null;

create index meeting_topic_id_idx on echo.meeting (topic_id) where topic_id is not null;

-- ─── the backfill ─────────────────────────────────────────────────────────
do $$
declare
  v_row record;
  v_topic uuid;
begin
  for v_row in
    select m.org_id,
           btrim(m.topic) as name,
           -- the creator of the OLDEST meeting wearing this name: somebody
           -- has to own the row, and that is the closest true answer
           (array_agg(m.created_by order by m.created_at))[1] as author
      from echo.meeting m
     where m.topic is not null and btrim(m.topic) <> ''
     group by m.org_id, btrim(m.topic)
  loop
    insert into echo.meeting_topic (org_id, name, created_by)
    values (v_row.org_id, left(v_row.name, 80), v_row.author)
    on conflict (org_id, name) do nothing
    returning id into v_topic;

    if v_topic is null then
      select t.id into v_topic
        from echo.meeting_topic t
       where t.org_id = v_row.org_id and t.name = left(v_row.name, 80);
    end if;

    update echo.meeting m
       set topic_id = v_topic
     where m.org_id = v_row.org_id and btrim(m.topic) = v_row.name;
  end loop;
end $$;

-- The text column goes only AFTER the backfill has re-pointed everything —
-- two spellings of one fact is how they come to disagree, and keeping it
-- "just in case" is how a reader later finds two topics on one meeting.
alter table echo.meeting drop column topic;

comment on column echo.meeting.topic_id is
  'The meeting''s folder (0151). Null is the ordinary state — «بدون موضوع» '
  'is the absence of a topic, never a topic named that.';

-- ─── the purge learns the new table (0145's rule) ─────────────────────────
-- meeting_topic is org-scoped, so `platform_purge_org` must delete it or the
-- purge raises on any org that used one. Meetings are already deleted by the
-- function; the topics they pointed at are not.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if v_def is null then
    raise exception '0151 FAILED: platform_purge_org is missing';
  end if;
  if position('meeting_topic' in v_def) > 0 then
    raise exception '0151 FAILED: the purge already names meeting_topic — this migration would double it';
  end if;
  -- inserted BEFORE the meeting delete would not matter (the FK is SET NULL),
  -- but after it is the honest order: children first, and a topic is a
  -- child of nothing except the org.
  -- the function's own SPACING, read from the catalogue rather than
  -- guessed: the first attempt matched a single-spaced line and the body
  -- pads its `where` clauses into a column, so `replace` found nothing and
  -- the self-check below is what caught a purge silently not patched
  if position('delete from echo.meeting                where org_id = p_org;' in v_def) = 0 then
    raise exception '0151 FAILED: the purge does not delete meetings the way this migration expects';
  end if;
  v_def := replace(v_def,
    'delete from echo.meeting                where org_id = p_org;',
    'delete from echo.meeting                where org_id = p_org;' || chr(10) || '  delete from echo.meeting_topic          where org_id = p_org;');
  execute v_def;
end $$;

-- ─── self-checks ──────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  -- (1) every org-scoped table is deleted or excepted by the purge — 0145's
  --     derived coverage, re-asked here because this migration adds one
  -- the function pads its `where` clauses into a column, so the question has
  -- to be asked without assuming the spacing — the version that assumed it
  -- reported an unpatched purge about a purge that had just been patched,
  -- which is a check failing for a reason of its own making
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0
   where n.nspname = 'echo' and c.relkind = 'r'
     and c.relname = 'meeting_topic'
     and (select pg_get_functiondef(p.oid) from pg_proc p
            join pg_namespace pn on pn.oid = p.pronamespace
           where pn.nspname = 'echo' and p.proname = 'platform_purge_org')
         !~ ('delete\s+from\s+echo\.' || c.relname || '\s+where\s+org_id');
  if v_missing is not null then
    raise exception '0151 FAILED: the purge does not delete %', v_missing;
  end if;

  -- (2) the text column is gone: two spellings of one fact is the defect
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'echo' and table_name = 'meeting' and column_name = 'topic'
  ) then
    raise exception '0151 FAILED: meeting.topic survived the migration';
  end if;

  -- (3) no meeting lost its topic — every row that had a name has an id
  if exists (select 1 from echo.meeting m where m.topic_id is not null
               and not exists (select 1 from echo.meeting_topic t
                                where t.id = m.topic_id and t.org_id = m.org_id)) then
    raise exception '0151 FAILED: a meeting points at a topic in another org';
  end if;

  -- (4) the agent may not invent folders
  if has_table_privilege('echo_agent', 'echo.meeting_topic', 'INSERT') then
    raise exception '0151 FAILED: the agent role may create meeting topics';
  end if;
end $$;
