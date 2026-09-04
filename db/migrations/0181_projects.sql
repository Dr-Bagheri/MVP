-- 0181 — projects
--
-- User directive, 2026-09-04: "in the menu also add a new section with the
-- platform theme design, with a sub menu on top — two of them for filter, sort
-- and add. The name for the new item in the menu is projects, and add these in
-- it" (with the reference's own project screens attached: a create dialog with
-- a title, a colour swatch and an icon, a member list, and the project's own
-- tabs — group chat, tasks, board, calendar).
--
-- ── WHAT A PROJECT IS HERE ────────────────────────────────────────────────
--
-- A named piece of work with people on it. That is all it is at the schema
-- level, and deliberately: everything the reference shows INSIDE a project —
-- its tasks, its board, its conversation — already exists in this product as
-- its own thing. A project that grew private copies of those would be a second
-- task table and a second chat, and the day they disagreed would be the day
-- somebody moved a card in one and not the other.
--
-- So a project OWNS nothing and POINTS at everything:
--   · its tasks are the board's tasks, filed under a `task_topic` that carries
--     `project_id` — which is why creating a project creates its category, the
--     behaviour the reference states out loud ("ضمناً به ازای ایجاد هر پروژه
--     یک «دسته‌بندی» هم در قسمت وظایف به صورت خودکار ایجاد خواهد شد").
--   · its conversation is a channel (db/0182) carrying `project_id`.
--
-- The one thing it owns is its MEMBERSHIP, because "who is on this" is a fact
-- about the project and about nothing else.
--
-- ── TONE, NOT COLOUR ──────────────────────────────────────────────────────
--
-- The same closed set the task board's columns and labels use. A free-text
-- colour would be the fifth place in this product where a hex can arrive that
-- the theme has no answer for, and a project's swatch has to be legible in
-- both themes like everything else.

begin;

create table echo.project (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  name        text not null check (length(trim(name)) between 1 and 120),
  /* one line under the name on the card — the reference has no field for it,
     but a list of projects with nothing but names is a list nobody can scan */
  summary     text not null default '' check (length(summary) <= 400),
  tone        text not null default 'grey'
              check (tone in ('grey', 'blue', 'green', 'amber', 'red',
                              'purple', 'teal', 'pink')),
  /* an emoji, or nothing. NOT a URL: an uploaded image needs a storage
     vertical, and a dropzone that does nothing is the thing this repo refuses
     to ship. The card falls back to the project's first letter, which is what
     the platform's Avatar already draws for a person. */
  icon        text check (icon is null or length(icon) between 1 and 8),
  archived_at timestamptz,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint project_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  /* the composite key the child tables point at, so a project and its member
     can never belong to two different organisations — structure rather than a
     policy subquery (D9/rule 11: an EXISTS in a policy runs as the caller and
     silently intersects with the other table's policies) */
  unique (id, org_id)
);

create index project_org_idx on echo.project (org_id) where archived_at is null;

comment on table echo.project is
  'Projects (0181): a named piece of work with people on it. Owns its membership and nothing else — its tasks are task_topic rows carrying project_id, its conversation is a channel carrying project_id.';

create table echo.project_member (
  project_id uuid not null,
  user_id    uuid not null,
  org_id     uuid not null references echo.org(id),
  added_by   uuid not null,
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id),
  constraint project_member_project
    foreign key (project_id, org_id) references echo.project (id, org_id) on delete cascade,
  constraint project_member_person
    foreign key (user_id, org_id) references echo.app_user (id, org_id),
  constraint project_member_author
    foreign key (added_by, org_id) references echo.app_user (id, org_id)
);

create index project_member_user_idx on echo.project_member (user_id);

comment on table echo.project_member is
  'Who is on a project (0181). The membership is the project''s own fact; everything else about it lives in the tables it points at.';

-- ── the task category a project brings with it ───────────────────────────
alter table echo.task_topic
  add column project_id uuid,
  add constraint task_topic_project
    foreign key (project_id, org_id) references echo.project (id, org_id) on delete cascade;

/* one category per project, and only one: the topic IS the project on the
   board, so a second would split its cards in two places */
create unique index task_topic_project_uniq on echo.task_topic (project_id)
  where project_id is not null;

comment on column echo.task_topic.project_id is
  'Set when this category was created by a project (0181). ON DELETE CASCADE: a project''s category has no meaning without it, and leaving an orphan would put a folder on the board that names nothing.';

-- ── the wall ─────────────────────────────────────────────────────────────
alter table echo.project        enable row level security;
alter table echo.project_member enable row level security;

/*
 * EVERY ACTIVE MEMBER SEES EVERY PROJECT. Private projects are a real feature
 * and this is not it: the reference's dialog picks who is ON a project, which
 * is who it is FOR, not who may know it exists. Making membership the read
 * wall would hide half an organisation's work from the other half by default,
 * and the first person to ask "why can't I see the project you just mentioned"
 * would be right. When privacy is wanted it arrives as a `visibility` column
 * and a policy that reads it — an absent feature, not a wrong one.
 */
create policy project_read on echo.project
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy project_insert on echo.project
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

create policy project_update on echo.project
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy project_member_read on echo.project_member
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy project_member_write on echo.project_member
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and added_by = echo.actor_id());

-- NO DELETE on `project` for anyone: a project is ARCHIVED, like every other
-- record in this product. The membership table takes delete because removing
-- somebody from a project is not deleting anything of theirs.
grant select, insert, update on echo.project        to echo_app;
grant select, insert, delete on echo.project_member to echo_app;
grant select on echo.project        to echo_agent;
grant select on echo.project_member to echo_agent;

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v int;
begin
  -- the agent reads and never writes (invariant 3)
  if has_table_privilege('echo_agent', 'echo.project', 'insert')
     or has_table_privilege('echo_agent', 'echo.project', 'update')
     or has_table_privilege('echo_agent', 'echo.project', 'delete')
     or has_table_privilege('echo_agent', 'echo.project_member', 'insert') then
    raise exception 'CHECK FAILED: the agent may write a project';
  end if;

  -- and a grant is not a policy: both new tables admit the agent by name
  select count(*) into v
    from pg_class t join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'echo' and t.relname in ('project', 'project_member')
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'echo' and p.tablename = t.relname
          and 'echo_agent' = any(p.roles));
  if v > 0 then
    raise exception 'CHECK FAILED: % new table(s) the agent may SELECT have no policy admitting it', v;
  end if;

  -- nobody deletes a project
  if has_table_privilege('echo_app', 'echo.project', 'delete') then
    raise exception 'CHECK FAILED: a project can be deleted — it is archived, like everything else here';
  end if;

  -- the category link is one-to-one
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'echo' and indexname = 'task_topic_project_uniq') then
    raise exception 'CHECK FAILED: a project could take two task categories';
  end if;
end $chk$;

commit;
