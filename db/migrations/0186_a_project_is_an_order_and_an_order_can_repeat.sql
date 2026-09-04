-- 0186 — a project is an admin's to give, and an order can repeat
--
-- User directive, 2026-09-04: "projects and tasks have a connection. The
-- admins only can make projects and they will add members or other admins to
-- it. In each project they can set tasks with all the details of the tasks …
-- then they can give it to someone as an order and make a schedule for it: to
-- be unlimited in time, or renew every time it finishes, or until this date;
-- also it has a gap between each renew. It is basically a place to create
-- tasks and give it to someone else and then have a good look of all tasks
-- with sorts of who did what and who didn't."
--
-- ── WHAT CHANGES, AND WHAT DOES NOT ───────────────────────────────────────
--
-- 0181 let any active member create a project. That was the wrong reading of
-- what a project IS here: the directive makes it the place where work is
-- ASSIGNED, and assigning work is a thing a role does. So creation, renaming,
-- archiving and membership become admin-only, and READING stays exactly as it
-- was — every active member still sees every project, because the wall is
-- about who may hand out work, never about who may know what the team is
-- doing. (0181's own note on that ruling is unchanged and still the reason.)
--
-- Note what is NOT admin-walled: the tasks themselves. A member may still
-- create, move and finish a card on the board — including a card inside a
-- project's category. The project is the folder and the order-giving surface;
-- the board is where the work happens, and locking the board would make the
-- product's main verb an admin feature.
--
-- ── AN ORDER THAT COMES BACK ──────────────────────────────────────────────
--
-- `task_recurrence` is the schedule, and the trigger is COMPLETION, which is
-- exactly what was asked for ("renew every time it finishes"). Not a cadence:
-- a weekly cleaning task that fires every Monday whether or not last Monday's
-- was done produces a column of identical unfinished cards, and the person it
-- was given to has no way to say so. Renewing on completion cannot pile up.
--
--   gap_days   — the wait between finishing one and the next one being due.
--                Zero is legal and means "immediately", which is a real
--                answer and not a missing one.
--   until_date — NULL is "unlimited in time". A nullable date rather than a
--                mode column plus a date: two spellings of one fact is how
--                they come to disagree, and "no end" has exactly one shape.
--   active     — set false when the series ends, so a schedule that has run
--                its course SAYS SO on the card instead of sitting there
--                looking armed.
--
-- ── WHERE THE NEXT INSTANCE COMES FROM ────────────────────────────────────
--
-- The completing transaction creates it, in core (`tasks.update`), not a
-- worker. Considered and rejected: a queue that spawns the next card when the
-- gap expires. It would need a handler, a poller and a dead-letter path for a
-- feature whose whole content is one INSERT, and — the deciding half — the
-- person who just ticked the box would see nothing happen. A card that
-- appears immediately with its due date set after the gap is visible,
-- transactional, and cannot be lost between two processes.
--
-- The consequence, stated rather than discovered: the next card exists from
-- the moment the last one is finished, sitting in the first column with a
-- future due date. It is on the board early. That is the price of making the
-- renewal a fact the person can see, and it is the right way round — the
-- alternative failure is a task that was supposed to come back and did not.
--
-- ── THE CHAIN IS THE HISTORY ──────────────────────────────────────────────
--
-- Every instance carries `recurrence_id`, so "this is the fourth time this
-- was done" is a query rather than a counter somebody maintains. ON DELETE
-- SET NULL, because a schedule somebody stops is not a reason to lose the
-- work already finished under it.

begin;

-- ── the project becomes an admin's to give ───────────────────────────────
drop policy project_insert        on echo.project;
drop policy project_update        on echo.project;
drop policy project_member_write  on echo.project_member;

create policy project_insert on echo.project
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_is_admin()
              and created_by = echo.actor_id());

create policy project_update on echo.project
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin());

/* PUTTING SOMEBODY ON A PROJECT IS GIVING THEM WORK, so it is the same
   permission as making one. A member removing THEMSELVES would be a
   reasonable separate feature and is deliberately not here: "leave" and
   "remove" look identical in a membership table, and the difference is
   exactly the thing an audit would need. */
create policy project_member_write on echo.project_member
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin()
              and added_by = echo.actor_id());

-- ── the schedule ─────────────────────────────────────────────────────────
create table echo.task_recurrence (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references echo.org(id),
  /* the wait between one instance finishing and the next falling due */
  gap_days   int not null default 0 check (gap_days between 0 and 365),
  /* NULL = unlimited in time. See the header for why this is not a mode. */
  until_date date,
  active     boolean not null default true,
  /* how many times it has come back — written by the same statement that
     creates the instance, so it cannot drift from the chain it counts */
  renewed    int not null default 0 check (renewed >= 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint task_recurrence_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  unique (id, org_id)
);

comment on table echo.task_recurrence is
  'A repeating order (0186): when its task is finished, the next one falls due gap_days later, until until_date or forever. The trigger is COMPLETION, never a clock — a cadence piles up identical unfinished cards.';

alter table echo.task
  add column recurrence_id uuid,
  add constraint task_recurrence_fk
    foreign key (recurrence_id, org_id) references echo.task_recurrence (id, org_id)
    on delete set null;

create index task_recurrence_chain on echo.task (recurrence_id)
  where recurrence_id is not null;

comment on column echo.task.recurrence_id is
  'The repeating order this card is an instance of (0186). SET NULL on delete: stopping a schedule must not lose the work already finished under it.';

-- ── the history learns the word ──────────────────────────────────────────
/* the vocabulary is a CHECK, so a new kind is a migration — which is the
   point of a closed set: the reader renders a sentence per kind, and one it
   has never heard of renders as nothing at all */
alter table echo.task_event drop constraint task_event_kind_check;
alter table echo.task_event add constraint task_event_kind_check
  check (kind in (
    'created', 'done', 'undone', 'moved', 'renamed', 'priority',
    'due_set', 'due_cleared', 'assigned', 'unassigned',
    'label_added', 'label_removed', 'archived', 'restored',
    'renewed'));

-- ── the wall ─────────────────────────────────────────────────────────────
alter table echo.task_recurrence enable row level security;
alter table echo.task_recurrence force row level security;

create policy task_recurrence_read on echo.task_recurrence
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

/*
 * NOT admin-walled, deliberately. A schedule is a property of a TASK, and a
 * member may already create and finish tasks on the board — a repeating
 * reminder on your own card is an ordinary thing to want. The admin wall
 * belongs where the directive put it: on the project, which is the surface
 * for handing work to somebody else.
 */
create policy task_recurrence_insert on echo.task_recurrence
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

create policy task_recurrence_update on echo.task_recurrence
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

grant select, insert, update on echo.task_recurrence to echo_app;
grant select on echo.task_recurrence to echo_agent;

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v int;
begin
  -- the agent reads and never writes (invariant 3)
  if has_table_privilege('echo_agent', 'echo.task_recurrence', 'insert')
     or has_table_privilege('echo_agent', 'echo.task_recurrence', 'update')
     or has_table_privilege('echo_agent', 'echo.task_recurrence', 'delete') then
    raise exception 'CHECK FAILED: the agent may write a schedule';
  end if;

  -- a grant is not a policy (0178): the agent is named on the new table
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'task_recurrence'
       and 'echo_agent' = any(roles)) then
    raise exception 'CHECK FAILED: the agent may SELECT task_recurrence with no policy admitting it';
  end if;

  -- RLS enabled AND forced
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'echo' and c.relname = 'task_recurrence'
       and c.relrowsecurity and c.relforcerowsecurity) then
    raise exception 'CHECK FAILED: RLS is not enabled AND forced on task_recurrence';
  end if;

  /* THE ADMIN WALL IS ON ALL THREE WRITES, checked by reading the policies
     rather than by trusting the three CREATE statements above — a policy
     recreated without its predicate is the exact edit this check exists for */
  select count(*) into v
    from pg_policies
   where schemaname = 'echo'
     and policyname in ('project_insert', 'project_update', 'project_member_write')
     and coalesce(qual, '') || coalesce(with_check, '') like '%actor_is_admin%';
  if v <> 3 then
    raise exception 'CHECK FAILED: only % of the 3 project write policies check actor_is_admin', v;
  end if;

  -- and READING is still everybody's: the wall is about giving work, not
  -- about knowing what the team is doing
  select count(*) into v
    from pg_policies
   where schemaname = 'echo' and policyname in ('project_read', 'project_member_read')
     and coalesce(qual, '') like '%actor_is_admin%';
  if v <> 0 then
    raise exception 'CHECK FAILED: a project read policy grew an admin check — every active member sees every project (0181)';
  end if;

  /* the event vocabulary took the new word AND kept the old ones — a
     rewritten CHECK that dropped one would only be found by whichever
     history entry stopped being writable, weeks later */
  if not exists (
    select 1 from pg_constraint
     where conname = 'task_event_kind_check'
       and pg_get_constraintdef(oid) like '%renewed%'
       and pg_get_constraintdef(oid) like '%label_removed%'
       and pg_get_constraintdef(oid) like '%due_cleared%') then
    raise exception 'CHECK FAILED: the event vocabulary lost a kind while gaining one';
  end if;
end $chk$;

commit;
