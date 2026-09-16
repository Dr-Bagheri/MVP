-- 0227 — a task has a room, and a project is what you are on
--
-- User directive (2026-09-16): "for tasks we need to assign them to a
-- chatroom as well: we can build a room and assign it to the tasks, and
-- people assigned in that task automatically will be assigned to the
-- chatroom as well — it does not [need] invitations this way, and only an
-- admin can do it. The projects in the main menu should be visible to the
-- members as well; they cannot edit it and they will only see the projects
-- that they are assigned to. Only an admin can change projects; they can
-- see all projects but only edit the ones they created themselves."
--
-- ── A TASK'S ROOM ─────────────────────────────────────────────────────────
--
-- `task.channel_id` points at a chat room (0184). MANY tasks may share one
-- room — "assign it to the tasks" — so it is a pointer on the task and not a
-- unique index on the channel the way a project's room is (0184's one room
-- per project). Composite FK, SET NULL NAMING ITS COLUMN (0188's class): the
-- purge deletes rooms, and a bare set-null over a key holding NOT NULL org_id
-- can only ever raise.
--
-- WHO MAY SET IT is a trigger and not a policy, because `task_update` admits
-- every active member (0144: the board is not walled — locking it would make
-- the product's main verb an admin's feature) and the room is the one field
-- on the card that is an admin's: it decides who is told what. The trigger
-- is SILENT when no actor is set, which is the purge's FK nulling a purged
-- room (0202's own sentence for the meeting's recording).
--
-- WHOEVER IS ON THE TASK IS IN ITS ROOM, and that is written where every
-- path meets: an AFTER trigger on the assignment, and one on the pointer, so
-- the board's dialog, the agent's hand and a future route all seat the
-- person the same way — "no invitation" is the design: a membership row is
-- the sidebar and the read cursor (0184), and the assignment IS the reason
-- they are there. The trigger is a definer door because `chat_member_write`
-- rightly lets a person write only their OWN row — nobody moves somebody
-- else's read cursor — and seating a colleague is exactly writing theirs.
-- Additive only: an unassignment does not remove a seat. A person who was
-- on the work keeps the room's history the way they keep a meeting they
-- attended (0202: un-planning is not un-remembering); leaving is theirs.
--
-- ── A PROJECT IS WHAT YOU ARE ON ──────────────────────────────────────────
--
-- 0181 ruled "every active member sees every project" and said what would
-- change it: "when privacy is wanted it arrives as a policy that reads it —
-- an absent feature, not a wrong one". It arrived. A MEMBER reads the
-- projects they are ON (a project_member row), LEAD, or made; an ADMIN reads
-- them all. Membership is a fact about another protected table, so the
-- policy asks a DEFINER helper rather than an EXISTS that would run as the
-- caller and silently intersect with project_member's own policy (D9, rule
-- 11's author-side corollary; actor_is_admin() is the same shape one table
-- over). The roster read narrows with it — the people on a project are a
-- fact about that project, and a project you cannot see has no roster you
-- may read; your own rows stay yours.
--
-- AN ADMIN EDITS WHAT THEY MADE. The four writes 0186 gave "an admin"
-- (rename, delete, roster, and everything the rail edits) now take the
-- 0077 hierarchy's sentence: your own record, or one whose author your role
-- strictly OUTRANKS (`echo.actor_outranks`, owner > admin > member). Two
-- reasons that is the spelling rather than `created_by = actor` alone: the
-- ORG OWNER is the one seat where "everything here is mine" is true, and a
-- project whose creator's account is tombstoned would otherwise be a row
-- nobody could ever touch again — the D27 class (a one-way door with no
-- exit built with its entrance). Creating stays any admin's; a folder
-- (0226) stays any admin's — a folder groups the surface, it is not a
-- project.
--
-- Cost, said out loud: a project's category on the board (task_topic) is
-- still org-readable — a member not on the project sees its folder as a
-- plain folder on the board, which is the board's own rule (a folder is
-- data), and the project's room stays a room every member may read (0184).
-- What narrowed is the project record: its people, its lead, its stage,
-- its progress.

begin;

-- ── A. the task's room ───────────────────────────────────────────────────
alter table echo.task add column channel_id uuid;

alter table echo.task
  add constraint task_room_same_org
  foreign key (channel_id, org_id) references echo.chat_channel (id, org_id)
  on delete set null (channel_id);

create index task_room_idx on echo.task (channel_id) where channel_id is not null;

comment on column echo.task.channel_id is
  '0227: the chat room this task''s people talk in. An admin''s to set (trigger); '
  'whoever is assigned is seated in it by trigger, no invitation. Many tasks may '
  'share one room. Nulled, never cascaded, when the room goes.';

-- the wall: an admin's to set
create function echo.tg_task_room_is_an_admins() returns trigger
  language plpgsql
  set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' then
    if new.channel_id is not distinct from old.channel_id then return new; end if;
  elsif new.channel_id is null then
    return new;
  end if;
  /* silent with no actor: the purge's FK nulling a purged room */
  if echo.actor_id() is null then
    return new;
  end if;
  if not echo.actor_is_admin() then
    raise exception 'only an admin may put a task in a room'
      using errcode = 'insufficient_privilege', hint = 'task_room_admin_only';
  end if;
  return new;
end
$fn$;

comment on function echo.tg_task_room_is_an_admins() is
  '0227: task.channel_id moves only under an admin''s identity. Silent when no actor is set — the purge''s FK nulling a purged room must never raise.';

create trigger tg_task_room_is_an_admins
  before insert or update of channel_id on echo.task
  for each row execute function echo.tg_task_room_is_an_admins();

-- the consequence, half one: a room put on a task seats everybody already on it
create function echo.tg_task_room_seats_assignees() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $fn$
begin
  if new.channel_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.channel_id is not distinct from old.channel_id then return null; end if;
  end if;
  insert into echo.chat_channel_member (channel_id, user_id, org_id)
  select new.channel_id, a.user_id, new.org_id
    from echo.task_assignee a
   where a.task_id = new.id
  on conflict do nothing;
  return null;
end
$fn$;

comment on function echo.tg_task_room_seats_assignees() is
  '0227: when a task gets a room, everybody assigned to it is seated there. Definer: seating a colleague is writing THEIR membership row, which chat_member_write rightly refuses to anybody else.';

create trigger tg_task_room_seats_assignees
  after insert or update of channel_id on echo.task
  for each row execute function echo.tg_task_room_seats_assignees();

-- the consequence, half two: a person put on a roomed task is seated
create function echo.tg_task_assignee_joins_room() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_channel uuid;
  v_org     uuid;
begin
  select t.channel_id, t.org_id into v_channel, v_org
    from echo.task t where t.id = new.task_id;
  if v_channel is null then
    return null;
  end if;
  insert into echo.chat_channel_member (channel_id, user_id, org_id)
  values (v_channel, new.user_id, v_org)
  on conflict do nothing;
  return null;
end
$fn$;

comment on function echo.tg_task_assignee_joins_room() is
  '0227: assigning somebody to a task that has a room seats them in the room — no invitation; the assignment is the reason they are there.';

create trigger tg_task_assignee_joins_room
  after insert on echo.task_assignee
  for each row execute function echo.tg_task_assignee_joins_room();

-- the history says it (0147's closed set, widened 0186's way: drop by name,
-- add the whole list — "who put this in a room, and when" is exactly what
-- the current row has forgotten)
alter table echo.task_event drop constraint task_event_kind_check;
alter table echo.task_event add constraint task_event_kind_check
  check (kind in (
    'created', 'done', 'undone', 'moved', 'renamed', 'priority',
    'due_set', 'due_cleared', 'assigned', 'unassigned',
    'label_added', 'label_removed', 'archived', 'restored',
    'renewed',
    'room_set', 'room_cleared'));

-- a new function is PUBLIC's to execute by default (0204's lesson): trigger
-- functions cannot be called directly, but the agent-wall test asserts the
-- structure and a definer door with a PUBLIC grant is what it looks for
revoke all on function echo.tg_task_room_is_an_admins()   from public;
revoke all on function echo.tg_task_room_seats_assignees() from public;
revoke all on function echo.tg_task_assignee_joins_room()  from public;

-- ── B. a project is what you are on ──────────────────────────────────────
create function echo.actor_on_project(p_project uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from echo.project_member m
     where m.project_id = p_project
       and m.user_id = echo.actor_id()
  );
$$;

revoke all on function echo.actor_on_project(uuid) from public;
grant execute on function echo.actor_on_project(uuid) to echo_app, echo_agent;

comment on function echo.actor_on_project(uuid) is
  '0227: is the acting person on this project''s roster? A definer helper so a read policy can ask it without an EXISTS that runs as the caller (D9).';

drop policy project_read         on echo.project;
drop policy project_update       on echo.project;
drop policy project_delete       on echo.project;
drop policy project_member_read  on echo.project_member;
drop policy project_member_write on echo.project_member;

/* READ: an admin sees every project; a member sees the ones they are on,
   lead, or made. The agent borrows the person's reach (M3), so the same
   sentence admits it. */
create policy project_read on echo.project
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (echo.actor_is_admin()
              or created_by = echo.actor_id()
              or lead_id    = echo.actor_id()
              or echo.actor_on_project(id)));

/* WRITE: an admin, and only what they made — or what an author they OUTRANK
   made (0077's sentence: the owner edits any admin's; an admin edits their
   own). Both halves of the policy carry it, so an UPDATE cannot move a
   project out from under its own author either. */
create policy project_update on echo.project
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and echo.actor_is_admin()
         and (created_by = echo.actor_id() or echo.actor_outranks(created_by)))
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_is_admin()
              and (created_by = echo.actor_id() or echo.actor_outranks(created_by)));

create policy project_delete on echo.project
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and echo.actor_is_admin()
         and (created_by = echo.actor_id() or echo.actor_outranks(created_by)));

/* THE ROSTER follows the project: readable by whoever may read the project
   (your own rows always — "am I on this?" needs no admin), writable by
   whoever may edit it. The roster policy asks about the PROJECT's author,
   which is a fact one table over — the definer helper below reads it. */
create function echo.actor_edits_project(p_project uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from echo.project p
     where p.id = p_project
       and p.org_id = echo.actor_org_id()
       and (p.created_by = echo.actor_id() or echo.actor_outranks(p.created_by))
  ) and echo.actor_is_admin();
$$;

revoke all on function echo.actor_edits_project(uuid) from public;
grant execute on function echo.actor_edits_project(uuid) to echo_app;

comment on function echo.actor_edits_project(uuid) is
  '0227: may the acting admin edit this project — theirs, or an author they outrank (0077)? Read by the roster''s write policy.';

create policy project_member_read on echo.project_member
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (echo.actor_is_admin()
              or user_id = echo.actor_id()
              or echo.actor_on_project(project_id)));

create policy project_member_write on echo.project_member
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and echo.actor_edits_project(project_id))
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_edits_project(project_id)
              and added_by = echo.actor_id());

comment on table echo.project is
  'Projects (0181). Since 0227: an admin reads every project and edits the ones they made (or whose author they outrank, 0077); a member reads the projects they are on, lead, or made. Creating stays an admin''s (0186).';

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v_cols int;
  v_n    int;
begin
  -- the FK names its column (0188's class, test 109's rule)
  select coalesce(array_length(confdelsetcols, 1), 0) into v_cols
    from pg_constraint where conname = 'task_room_same_org';
  if v_cols <> 1 then
    raise exception '0227 FAILED: task_room_same_org must null exactly one column (channel_id), it names %', v_cols;
  end if;

  -- the history's closed set knows the room (both spellings, or the reader
  -- renders one of them as nothing at all)
  if not exists (
    select 1 from pg_constraint where conname = 'task_event_kind_check'
       and pg_get_constraintdef(oid) like '%room_set%'
       and pg_get_constraintdef(oid) like '%room_cleared%'
  ) then
    raise exception '0227 FAILED: task_event_kind_check does not name the room events';
  end if;

  -- the three triggers stand
  select count(*) into v_n from pg_trigger
   where tgname in ('tg_task_room_is_an_admins', 'tg_task_room_seats_assignees', 'tg_task_assignee_joins_room')
     and not tgisinternal;
  if v_n <> 3 then
    raise exception '0227 FAILED: expected the three room triggers, found %', v_n;
  end if;

  -- no definer door here is PUBLIC's to execute
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo'
       and p.proname in ('tg_task_room_is_an_admins', 'tg_task_room_seats_assignees',
                         'tg_task_assignee_joins_room', 'actor_on_project', 'actor_edits_project')
       and (p.proacl is null or has_function_privilege('public', p.oid, 'execute'))
  ) then
    raise exception '0227 FAILED: a room or project helper is executable by PUBLIC';
  end if;

  -- the five policies are the new ones (the read admits by membership; the
  -- writes ask about the author) — asserted on the TEXT the catalogue holds,
  -- because a policy dropped and recreated later would not re-run this
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'project' and policyname = 'project_read'
       and qual like '%actor_on_project%' and qual like '%actor_is_admin%'
  ) then
    raise exception '0227 FAILED: project_read does not read membership';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'project' and policyname = 'project_update'
       and qual like '%actor_outranks%' and with_check like '%actor_outranks%'
  ) then
    raise exception '0227 FAILED: project_update does not ask about the author';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'project' and policyname = 'project_delete'
       and qual like '%actor_outranks%'
  ) then
    raise exception '0227 FAILED: project_delete does not ask about the author';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'project_member' and policyname = 'project_member_write'
       and qual like '%actor_edits_project%'
  ) then
    raise exception '0227 FAILED: the roster write does not ask about the project''s author';
  end if;

  -- and the discriminating half: creating a project is STILL any admin's —
  -- a narrowing that took the insert with it would leave a fresh admin with
  -- nothing to edit because they could make nothing
  if exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'project' and policyname = 'project_insert'
       and with_check like '%actor_outranks%'
  ) then
    raise exception '0227 FAILED: project_insert was narrowed — creating stays any admin''s';
  end if;
end
$chk$;

commit;
