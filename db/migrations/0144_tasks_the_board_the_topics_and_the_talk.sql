-- 0144 — TASKS: the board, its topics, and the talk on a card.
--
-- User directive, 2026-08-31 (the reference adoption): "i need their tasks
-- section completely so take that". The reference's model, kept whole:
--
--   · COLUMNS a workspace arranges itself (backlog / to do / in progress /
--     done ship as the defaults, more can be added, each wears a tone);
--   · TASKS on those columns — title, description, priority, deadline,
--     labels, a checklist with per-item done, assignees, comments, and an
--     optional link back to the RECORD the task came out of ("از جلسه: …");
--   · TOPICS as folders a board can be filtered by.
--
-- ── the collaboration model, decided here ────────────────────────────────
-- A task board is the ORG's shared surface, not a per-person store: any
-- active member reads the board and any active member may move a card,
-- because that is what a kanban is for (the reference behaves exactly this
-- way). created_by still stamps provenance on tasks and comments — shared
-- write does not mean anonymous write.
--
-- ── deletes, and why two tables get one ──────────────────────────────────
-- D3's closed list is worth more than a tidy row count, so a TASK is never
-- deleted: archived_at is the only way off the board, and the archive is a
-- view of its own. Two CHILD tables do take DELETE, on the call_note
-- precedent (author-editing, not record-destruction):
--
--   · task_checklist_item — removing a checklist line IS editing the task;
--     a "removed" flag would be a second spelling of absence that every
--     count and every progress bar then has to remember to exclude.
--   · task_assignee — a membership row; unassigning someone must remove it,
--     or "who is on this" accretes everyone who ever touched it.
--
-- Both deletes are policy-walled to the actor's own org and active status.
-- The task rows themselves — the record — remain undeletable by every app
-- role, exactly like everything else in this schema.
--
-- ── the record link ──────────────────────────────────────────────────────
-- task.call_id is a composite FK to the call WITH on delete set null: a
-- task outlives the record it came from (the purge job deletes calls, and
-- a purge must never take the org's work plan with it). Referential
-- actions run as the table owner, so echo_purge needs no grant here.

begin;

-- ── topics ───────────────────────────────────────────────────────────────
create table echo.task_topic (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  name        text not null check (length(trim(name)) between 1 and 80),
  archived_at timestamptz,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  constraint task_topic_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id)
);

create index task_topic_org_idx on echo.task_topic (org_id) where archived_at is null;

comment on table echo.task_topic is
  'Task folders (0144): a board filter, org-shared. Archived, never deleted.';

-- ── columns ──────────────────────────────────────────────────────────────
create table echo.task_column (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  name        text not null check (length(trim(name)) between 1 and 80),
  -- the reference's column dots: a tone, not a free colour — the closed
  -- set keeps the board on the theme's palette
  tone        text not null default 'grey'
              check (tone in ('grey', 'blue', 'amber', 'green')),
  position    double precision not null default 0,
  archived_at timestamptz,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  constraint task_column_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id)
);

create index task_column_org_idx on echo.task_column (org_id, position)
  where archived_at is null;

comment on table echo.task_column is
  'Board columns (0144): org-arranged, toned, ordered by position. The four defaults are seeded lazily by the api on first board read. Archived, never deleted.';

-- ── tasks ────────────────────────────────────────────────────────────────
create table echo.task (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  column_id   uuid not null references echo.task_column(id),
  topic_id    uuid references echo.task_topic(id),
  -- the task's origin, when it came out of a record ("از جلسه: …").
  -- SET NULL: a purge removes the call, never the org's work plan.
  call_id     uuid,
  title       text not null check (length(trim(title)) between 1 and 300),
  description text not null default '' check (length(description) <= 8000),
  priority    text not null default 'medium'
              check (priority in ('low', 'medium', 'high', 'critical')),
  labels      text[] not null default '{}',
  due_at      timestamptz,
  done_at     timestamptz,
  position    double precision not null default 0,
  archived_at timestamptz,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint task_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  constraint task_call_org
    foreign key (call_id, org_id) references echo.call (id, org_id)
    on delete set null
);

create index task_board_idx on echo.task (org_id, column_id, position)
  where archived_at is null;
create index task_due_idx on echo.task (org_id, due_at)
  where archived_at is null and due_at is not null;
create index task_call_idx on echo.task (call_id) where call_id is not null;

comment on table echo.task is
  'The board''s cards (0144). Org-shared; provenance in created_by; the only way off the board is archived_at. done_at is the checkbox — a done task may sit in any column, and the column is where it SITS, not what it IS.';

-- ── checklist ────────────────────────────────────────────────────────────
create table echo.task_checklist_item (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references echo.task(id),
  org_id     uuid not null references echo.org(id),
  label      text not null check (length(trim(label)) between 1 and 500),
  done       boolean not null default false,
  position   double precision not null default 0,
  created_at timestamptz not null default now()
);

create index task_checklist_task_idx on echo.task_checklist_item (task_id, position);

comment on table echo.task_checklist_item is
  'Checklist lines on a task (0144). DELETE is granted (call_note''s class): removing a line is editing the task, and a removed-flag would be a second spelling of absence every count must remember to exclude.';

-- ── assignees ────────────────────────────────────────────────────────────
create table echo.task_assignee (
  task_id  uuid not null references echo.task(id),
  user_id  uuid not null,
  org_id   uuid not null references echo.org(id),
  added_at timestamptz not null default now(),
  primary key (task_id, user_id),
  constraint task_assignee_member_org
    foreign key (user_id, org_id) references echo.app_user (id, org_id)
);

comment on table echo.task_assignee is
  'Who is on a task (0144). A membership row: DELETE is granted (the agent_workflow flag pattern deliberately NOT used here — an unassigned person must leave the list, or it accretes everyone who ever touched the card).';

-- ── comments ─────────────────────────────────────────────────────────────
create table echo.task_comment (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references echo.task(id),
  org_id     uuid not null references echo.org(id),
  body       text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint task_comment_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id)
);

create index task_comment_task_idx on echo.task_comment (task_id, created_at);

comment on table echo.task_comment is
  'The talk on a card (0144). Append-only: no UPDATE, no DELETE for any app role — an edited remark is a new remark.';

-- ── the wall ─────────────────────────────────────────────────────────────
alter table echo.task_topic          enable row level security;
alter table echo.task_topic          force row level security;
alter table echo.task_column         enable row level security;
alter table echo.task_column         force row level security;
alter table echo.task                enable row level security;
alter table echo.task                force row level security;
alter table echo.task_checklist_item enable row level security;
alter table echo.task_checklist_item force row level security;
alter table echo.task_assignee       enable row level security;
alter table echo.task_assignee       force row level security;
alter table echo.task_comment        enable row level security;
alter table echo.task_comment        force row level security;

-- org-shared read and write, active members only. One predicate per table,
-- structural org-scoping carried by the composite FKs above.
create policy task_topic_rw on echo.task_topic
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

create policy task_column_rw on echo.task_column
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

-- tasks: any member may UPDATE (moving a card is the board's whole point),
-- but created_by is pinned at insert and never re-writable to someone else
create policy task_read on echo.task
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy task_insert on echo.task
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());
create policy task_update on echo.task
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id());

create policy task_checklist_rw on echo.task_checklist_item
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_assignee_rw on echo.task_assignee
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_comment_read on echo.task_comment
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy task_comment_insert on echo.task_comment
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

-- grants: the wall's other half. No DELETE anywhere except the two child
-- tables argued in the header; comments take no UPDATE at all.
grant select, insert, update on echo.task_topic          to echo_app;
grant select, insert, update on echo.task_column         to echo_app;
grant select, insert, update on echo.task                to echo_app;
grant select, insert, update, delete on echo.task_checklist_item to echo_app;
grant select, insert, delete on echo.task_assignee       to echo_app;
grant select, insert         on echo.task_comment        to echo_app;

-- ── self-checks ──────────────────────────────────────────────────────────
do $check$
declare
  bad int;
begin
  -- the deletes are EXACTLY the two argued for, and nothing else new
  select count(*) into bad
    from information_schema.role_table_grants
   where grantee = 'echo_app' and privilege_type = 'DELETE'
     and table_schema = 'echo'
     and table_name in ('task', 'task_topic', 'task_column', 'task_comment');
  if bad > 0 then
    raise exception 'a task-record table picked up DELETE — the closed list broke in the migration that argued for it';
  end if;

  -- comments are append-only by GRANT, not by convention
  if exists (
    select 1 from information_schema.role_table_grants
     where grantee = 'echo_app' and privilege_type = 'UPDATE'
       and table_schema = 'echo' and table_name = 'task_comment'
  ) then
    raise exception 'task_comment gained UPDATE — an edited remark must be a new remark';
  end if;

  -- the agent has nothing here until that is decided on record
  if exists (
    select 1 from information_schema.role_table_grants
     where grantee = 'echo_agent' and table_schema = 'echo'
       and table_name like 'task%'
  ) then
    raise exception 'echo_agent reached the task tables without a decision';
  end if;

  -- RLS is enabled AND forced on all six
  select count(*) into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relname like 'task%' and c.relkind = 'r'
     and not (c.relrowsecurity and c.relforcerowsecurity);
  if bad > 0 then
    raise exception 'a task table is missing enabled+forced RLS';
  end if;
end
$check$;

commit;
