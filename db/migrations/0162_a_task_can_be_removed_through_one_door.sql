-- 0162 — a task can be removed, through one door
--
-- 0144's comment on echo.task says "the only way off the board is
-- archived_at", and the board's red button was exactly that: an archive
-- wearing a trash icon. The user asked for the red button to delete (a card
-- somebody created by mistake is not history worth keeping, and an archive
-- full of typos buries the archive that matters). The reference product
-- deletes too.
--
-- SHAPE: a SECURITY DEFINER door, not a DELETE grant on echo.task (0032's
-- soft_delete_call is the precedent, D8: doors are enumerated with reasons).
-- Two reasons it is a door and not a policy:
--
--   1. the children. task_checklist_item, task_assignee, task_comment,
--      task_label_link and task_event all point at the task with plain
--      foreign keys and no ON DELETE. A bare DELETE grant would refuse on
--      the first child, and the fix — cascades — would hand every one of
--      those tables an implicit delete path that no policy of THEIRS ever
--      sees. The door deletes the children in one statement each, in one
--      transaction, and nothing else in the product can.
--   2. task_event is append-only (0147: echo_app holds INSERT and never
--      DELETE, "the api can neither author a trend nor omit one"). The
--      row's history leaves with the row — that is 0155's line, "the row's
--      content purges; the fact of a deletion is not content" — but it must
--      leave THROUGH the door, so append-only stays true for every caller
--      that is not this function.
--
-- WHO: the task's creator, or an admin — M11's rule for calls, applied to
-- the board. Any member may MOVE a card (task_update is any active member;
-- moving is the board's whole point), but removing one is a different act:
-- a card somebody else made is their work item, and "I tidied the board"
-- must not be able to mean "I deleted your task".
--
-- The refusal is ONE sentence for "no such task" and "not yours", 0032's
-- posture: a distinct message would let a member enumerate the tasks they
-- cannot see. It reads as 404 at the api, the way soft_delete_call's does.
--
-- WHAT IS NOT RECORDED: a deletion leaves no row behind. The M11 amendment
-- (2026-08-13) ruled a metadata-only record surface for member deletions
-- "direction ruled, build deferred"; a task deletion is the same class and
-- is deferred with it. Named here so it is a decision, not an absence.

create function echo.delete_task(p_task uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_actor uuid := echo.actor_id();
  v_owner uuid;
begin
  -- the visibility rule restated, because a definer function sees
  -- everything and must decide for itself: same org, active actor
  select t.created_by into v_owner
  from echo.task t
  where t.id = p_task
    and t.org_id = echo.actor_org_id()
    and echo.actor_is_active();

  if not found or (v_owner is distinct from v_actor and not echo.actor_is_admin()) then
    raise exception 'no such task, or not yours to delete'
      using errcode = 'insufficient_privilege';
  end if;

  -- children first, each by its own statement — the order is the FK order,
  -- and there is no cascade to hide a table this list forgot: a new child
  -- table with a plain FK makes this function RAISE, which is the loud
  -- failure a purge-shaped operation owes (0132, 0145)
  delete from echo.task_label_link     where task_id = p_task;
  delete from echo.task_event          where task_id = p_task;
  delete from echo.task_comment        where task_id = p_task;
  delete from echo.task_assignee       where task_id = p_task;
  delete from echo.task_checklist_item where task_id = p_task;
  delete from echo.task                where id = p_task;
  return true;
end;
$$;

comment on function echo.delete_task(uuid) is
  'The board''s true delete (0162): the creator or an admin removes a task and everything hanging off it, through this door alone. echo_app holds no DELETE on echo.task; task_event stays append-only for every other caller.';

revoke all on function echo.delete_task(uuid) from public;
grant execute on function echo.delete_task(uuid) to echo_app;

-- the comment 0144 left on the table is no longer true, and a comment that
-- names the ONLY way off the board misleads the moment there are two
comment on table echo.task is
  'The board''s cards (0144). Org-shared; provenance in created_by. Two ways off the board: archived_at (any member, reversible) and echo.delete_task (0162: creator or admin, final). done_at is the checkbox — a done task may sit in any column, and the column is where it SITS, not what it IS.';

-- ── self-checks: the WHOLE matrix (rule 7 — the ordinary path is the product)
do $$
declare
  v_org     uuid;
  v_maker   uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_col     uuid;
  v_task    uuid;
  v_task2   uuid;
  v_label   uuid;
begin
  insert into echo.org (name, locale) values ('probe-0162', 'fa') returning id into v_org;
  insert into auth.users (id, email) values
    (v_maker, 'probe-0162-maker@example.test'),
    (v_other, 'probe-0162-other@example.test'),
    (v_admin, 'probe-0162-admin@example.test')
    on conflict (id) do nothing;
  insert into echo.app_user (id, org_id, email, display_name, role, status) values
    (v_maker, v_org, 'probe-0162-maker@example.test', 'maker', 'member', 'active'),
    (v_other, v_org, 'probe-0162-other@example.test', 'other', 'member', 'active'),
    (v_admin, v_org, 'probe-0162-admin@example.test', 'admin', 'admin',  'active');
  insert into echo.task_column (org_id, name, position, created_by)
    values (v_org, 'probe', 0, v_maker) returning id into v_col;
  insert into echo.task_label (org_id, name, color, created_by)
    values (v_org, 'probe', 'grey', v_maker) returning id into v_label;

  -- a task with one of EVERY child, made by the maker
  perform set_config('echo.actor_id', v_maker::text, true);
  insert into echo.task (org_id, column_id, title, created_by)
    values (v_org, v_col, 'probe task', v_maker) returning id into v_task;
  insert into echo.task_checklist_item (task_id, org_id, label) values (v_task, v_org, 'line');
  insert into echo.task_assignee (task_id, user_id, org_id) values (v_task, v_other, v_org);
  insert into echo.task_comment (task_id, org_id, body, created_by) values (v_task, v_org, 'hi', v_maker);
  insert into echo.task_label_link (task_id, label_id, org_id) values (v_task, v_label, v_org);
  insert into echo.task_event (task_id, org_id, kind, actor_id) values (v_task, v_org, 'created', v_maker);

  -- REFUSED: another member, not an admin — one sentence, 42501
  perform set_config('echo.actor_id', v_other::text, true);
  begin
    perform echo.delete_task(v_task);
    raise exception 'CHECK FAILED: a colleague deleted a task they did not create';
  exception when insufficient_privilege then
    null;
  end;
  if not exists (select 1 from echo.task where id = v_task) then
    raise exception 'CHECK FAILED: the refused delete removed the row anyway';
  end if;

  -- THE ORDINARY PATH: the creator deletes their own — and the children go
  perform set_config('echo.actor_id', v_maker::text, true);
  if not echo.delete_task(v_task) then
    raise exception 'CHECK FAILED: the creator''s delete did not report true';
  end if;
  if exists (select 1 from echo.task where id = v_task)
     or exists (select 1 from echo.task_checklist_item where task_id = v_task)
     or exists (select 1 from echo.task_assignee where task_id = v_task)
     or exists (select 1 from echo.task_comment where task_id = v_task)
     or exists (select 1 from echo.task_label_link where task_id = v_task)
     or exists (select 1 from echo.task_event where task_id = v_task) then
    raise exception 'CHECK FAILED: something survived the creator''s delete';
  end if;

  -- THE PRIVILEGED PATH: an admin deletes a task somebody else made
  perform set_config('echo.actor_id', v_other::text, true);
  insert into echo.task (org_id, column_id, title, created_by)
    values (v_org, v_col, 'probe task 2', v_other) returning id into v_task2;
  perform set_config('echo.actor_id', v_admin::text, true);
  perform echo.delete_task(v_task2);
  if exists (select 1 from echo.task where id = v_task2) then
    raise exception 'CHECK FAILED: the admin''s delete left the row';
  end if;

  -- a task that does not exist reads exactly like one that is not yours
  begin
    perform echo.delete_task(gen_random_uuid());
    raise exception 'CHECK FAILED: deleting nothing succeeded';
  exception when insufficient_privilege then
    null;
  end;

  -- THE WALL is unchanged: no app role holds DELETE on the table itself, and
  -- the event log is still append-only for the api
  if has_table_privilege('echo_app', 'echo.task', 'delete')
     or has_table_privilege('echo_agent', 'echo.task', 'delete')
     or has_table_privilege('echo_app', 'echo.task_event', 'delete') then
    raise exception 'CHECK FAILED: a table-level DELETE appeared beside the door';
  end if;
  if not has_function_privilege('echo_app', 'echo.delete_task(uuid)', 'execute')
     or has_function_privilege('echo_agent', 'echo.delete_task(uuid)', 'execute') then
    raise exception 'CHECK FAILED: the door is granted to the wrong roles';
  end if;

  raise notice '0162 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
