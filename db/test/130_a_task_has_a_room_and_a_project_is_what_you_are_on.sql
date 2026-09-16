-- db/0227 — a task has a room, and a project is what you are on.
--
-- THE WHOLE MATRIX, both halves (rule 7's corollary: the ordinary path is
-- the product):
--
--   the room   a member cannot put a task in a room; an admin can; a room
--              put on a task seats whoever is already on it; a person put on
--              a roomed task is seated; the same person on a second task in
--              the same room is seated once; an unassignment keeps the seat;
--              the purge's set-null does not raise and names its column.
--   the reach  a member sees the projects they are on or lead and not the
--              others; an admin sees them all; an admin edits their own and
--              not the owner's; the owner edits an admin's (0077: outranks);
--              the roster follows the project; the agent borrows the
--              person's reach; creating stays any admin's.
--
--   alice  owner,  org A · dave  admin, org A
--   bob    member, org A, ACTIVE · carol member, org A, ACTIVE
--   (never dan — 04 is PENDING, and "a member cannot" would measure
--    actor_is_active() instead of the rule)

reset role;
select t.ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'echo' and table_name = 'task' and column_name = 'channel_id'),
  '0227: task.channel_id exists');

-- fixtures at owner altitude: a column, two tasks by alice, a room
insert into echo.task_column (id, org_id, name, tone, position, created_by)
values ('a0000000-0000-4000-8000-00000000c227',
        '0a000000-0000-4000-8000-00000000000a', 'برای انجام', 'blue', 1,
        '01000000-0000-4000-8000-000000000001');
insert into echo.task (id, org_id, column_id, title, created_by)
values ('a0000000-0000-4000-8000-00000000e227', '0a000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-00000000c227', 'مهاجرت داده', '01000000-0000-4000-8000-000000000001'),
       ('a0000000-0000-4000-8000-00000000e228', '0a000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-00000000c227', 'آزمون بار', '01000000-0000-4000-8000-000000000001');
insert into echo.chat_channel (id, org_id, name, created_by) values
  ('a7000000-0000-4000-8000-0000000000c7', '0a000000-0000-4000-8000-00000000000a',
   'اتاق مهاجرت', '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0227 tests run under a non-bypass product role');

-- ─── THE ROOM IS AN ADMIN'S TO SET ──────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, ACTIVE member
-- bob may edit the card (0144: the board is not walled) — the ROOM is the
-- one field the trigger keeps for an admin, so this is a raise, not a
-- zero-row update
select t.raises(
  $$update echo.task set channel_id = 'a7000000-0000-4000-8000-0000000000c7'
     where id = 'a0000000-0000-4000-8000-00000000e227'$$,
  '42501',
  '0227: a member cannot put a task in a room');
-- the control that makes the line above about the ROOM: the same member
-- may still move the card's title
update echo.task set title = 'مهاجرت دادهٔ اصلی' where id = 'a0000000-0000-4000-8000-00000000e227';
select t.ok(
  (select title from echo.task where id = 'a0000000-0000-4000-8000-00000000e227') = 'مهاجرت دادهٔ اصلی',
  '0227: the same member still edits the card (the wall is the room, not the card)');

-- ─── WHOEVER IS ON THE TASK IS IN ITS ROOM ──────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner
-- bob is on the task BEFORE it has a room
insert into echo.task_assignee (task_id, user_id, org_id)
values ('a0000000-0000-4000-8000-00000000e227', '02000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a');
select t.ok(
  not exists (select 1 from echo.chat_channel_member
               where channel_id = 'a7000000-0000-4000-8000-0000000000c7'
                 and user_id = '02000000-0000-4000-8000-000000000002'),
  '0227: an assignment to a task with no room seats nobody (the control)');

update echo.task set channel_id = 'a7000000-0000-4000-8000-0000000000c7'
 where id = 'a0000000-0000-4000-8000-00000000e227';
select t.ok(
  (select channel_id from echo.task where id = 'a0000000-0000-4000-8000-00000000e227')
    = 'a7000000-0000-4000-8000-0000000000c7'::uuid,
  '0227: an admin puts a task in a room');
select t.ok(
  exists (select 1 from echo.chat_channel_member
           where channel_id = 'a7000000-0000-4000-8000-0000000000c7'
             and user_id = '02000000-0000-4000-8000-000000000002'),
  '0227: a room put on a task seats whoever was already on it');

-- carol is put on the task AFTER it has a room
insert into echo.task_assignee (task_id, user_id, org_id)
values ('a0000000-0000-4000-8000-00000000e227', '03000000-0000-4000-8000-000000000003',
        '0a000000-0000-4000-8000-00000000000a');
select t.ok(
  exists (select 1 from echo.chat_channel_member
           where channel_id = 'a7000000-0000-4000-8000-0000000000c7'
             and user_id = '03000000-0000-4000-8000-000000000003'),
  '0227: a person put on a roomed task is seated in the room');

-- a plain admin (not the owner) may put a second task in the same room, and
-- bob, already seated, is seated ONCE — the second assignment is a no-op
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, admin
update echo.task set channel_id = 'a7000000-0000-4000-8000-0000000000c7'
 where id = 'a0000000-0000-4000-8000-00000000e228';
insert into echo.task_assignee (task_id, user_id, org_id)
values ('a0000000-0000-4000-8000-00000000e228', '02000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a');
select t.ok(
  (select channel_id from echo.task where id = 'a0000000-0000-4000-8000-00000000e228')
    = 'a7000000-0000-4000-8000-0000000000c7'::uuid
  and (select count(*) from echo.chat_channel_member
        where channel_id = 'a7000000-0000-4000-8000-0000000000c7'
          and user_id = '02000000-0000-4000-8000-000000000002') = 1,
  '0227: an admin rooms a second task; a person already seated is seated once');

-- an unassignment keeps the seat (additive — leaving is the person's own)
delete from echo.task_assignee
 where task_id = 'a0000000-0000-4000-8000-00000000e227'
   and user_id = '03000000-0000-4000-8000-000000000003';
select t.ok(
  exists (select 1 from echo.chat_channel_member
           where channel_id = 'a7000000-0000-4000-8000-0000000000c7'
             and user_id = '03000000-0000-4000-8000-000000000003'),
  '0227: taking a person off the task does not take them out of the room');

-- ─── THE PURGE'S SET-NULL NAMES ITS COLUMN AND RAISES NOTHING ───────────
reset role;
delete from echo.chat_channel where id = 'a7000000-0000-4000-8000-0000000000c7';
select t.ok(
  (select channel_id is null and org_id = '0a000000-0000-4000-8000-00000000000a'::uuid
     from echo.task where id = 'a0000000-0000-4000-8000-00000000e227'),
  '0227: deleting the room clears the task''s pointer, keeps its org, and the admin-only trigger stays silent with no actor');
select t.ok(
  (select coalesce(array_length(confdelsetcols, 1), 0) from pg_constraint where conname = 'task_room_same_org') = 1,
  '0227: task_room_same_org nulls exactly its own column');

-- ─── A PROJECT IS WHAT YOU ARE ON ───────────────────────────────────────
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner
insert into echo.project (id, org_id, name, created_by)
values ('a2270000-0000-4000-8000-000000000001', echo.actor_org_id(), 'پروژهٔ آلیس', echo.actor_id());
insert into echo.project_member (project_id, user_id, org_id, added_by)
values ('a2270000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000002',
        echo.actor_org_id(), echo.actor_id());                                        -- bob is ON alice's

select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, admin
-- creating stays any admin's — the discriminating half of the narrowing
insert into echo.project (id, org_id, name, created_by, lead_id)
values ('a2270000-0000-4000-8000-000000000002', echo.actor_org_id(), 'پروژهٔ دیوید', echo.actor_id(),
        '03000000-0000-4000-8000-000000000003');                                       -- carol LEADS dave's
select t.ok(
  exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000002'),
  '0227: a plain admin still creates a project');

-- a member sees what they are ON or LEAD, and not the rest
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000001'),
  '0227: a member sees the project they are on');
select t.ok(
  not exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000002'),
  '0227: a member does not see a project they are not on');
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000002'),
  '0227: a member sees the project they lead');
select t.ok(
  not exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000001'),
  '0227: the lead of one project does not see another she is not on');

-- the roster follows the project
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  exists (select 1 from echo.project_member
           where project_id = 'a2270000-0000-4000-8000-000000000001'
             and user_id = '02000000-0000-4000-8000-000000000002'),
  '0227: a member reads the roster of the project they are on');
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  not exists (select 1 from echo.project_member
               where project_id = 'a2270000-0000-4000-8000-000000000001'),
  '0227: a member cannot read the roster of a project they are not on');

-- the agent borrows the person's reach (M3)
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob's agent
select t.ok(
  exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000001')
  and not exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000002'),
  '0227: the agent sees exactly what the person sees');
set local role echo_app;

-- an admin sees them all, and edits only what they made
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave
select t.ok(
  exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000001')
  and exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000002'),
  '0227: an admin sees every project');
update echo.project set name = 'پروژهٔ دیوید ۲' where id = 'a2270000-0000-4000-8000-000000000002';
select t.ok(
  (select name from echo.project where id = 'a2270000-0000-4000-8000-000000000002') = 'پروژهٔ دیوید ۲',
  '0227: an admin renames the project they made');
-- an UPDATE walled by a policy matches zero rows and succeeds (0186's
-- note), so the assertion is on the record — read as dave, who CAN see it
select t.writes_nothing(
  $$update echo.project set name = 'دست‌درازی' where id = 'a2270000-0000-4000-8000-000000000001'$$,
  '0227: an admin renaming the owner''s project changes nothing');
select t.ok(
  (select name from echo.project where id = 'a2270000-0000-4000-8000-000000000001') = 'پروژهٔ آلیس',
  '0227: the owner''s project keeps its name');
insert into echo.project_member (project_id, user_id, org_id, added_by)
values ('a2270000-0000-4000-8000-000000000002', '02000000-0000-4000-8000-000000000002',
        echo.actor_org_id(), echo.actor_id());
select t.ok(
  exists (select 1 from echo.project_member
           where project_id = 'a2270000-0000-4000-8000-000000000002'
             and user_id = '02000000-0000-4000-8000-000000000002'),
  '0227: an admin puts a colleague on the project they made');
select t.denied(
  $$insert into echo.project_member (project_id, user_id, org_id, added_by)
    values ('a2270000-0000-4000-8000-000000000001', '03000000-0000-4000-8000-000000000003',
            echo.actor_org_id(), echo.actor_id())$$,
  '0227: an admin cannot put anybody on the owner''s project');
select t.writes_nothing(
  $$delete from echo.project where id = 'a2270000-0000-4000-8000-000000000001'$$,
  '0227: an admin deleting the owner''s project deletes nothing');

-- the owner outranks an admin (0077), so the owner edits the admin's
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
update echo.project set name = 'پروژهٔ دیوید، به دست آلیس' where id = 'a2270000-0000-4000-8000-000000000002';
select t.ok(
  (select name from echo.project where id = 'a2270000-0000-4000-8000-000000000002') = 'پروژهٔ دیوید، به دست آلیس',
  '0227: the owner renames an admin''s project (outranks its author)');
delete from echo.project where id = 'a2270000-0000-4000-8000-000000000002';
select t.ok(
  not exists (select 1 from echo.project where id = 'a2270000-0000-4000-8000-000000000002'),
  '0227: the owner deletes an admin''s project');

-- a member still edits nothing, and creates nothing (0186, unchanged)
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, on alice's
select t.writes_nothing(
  $$update echo.project set name = 'نام باب' where id = 'a2270000-0000-4000-8000-000000000001'$$,
  '0227: a member on a project still cannot rename it');
select t.denied(
  $$insert into echo.project (org_id, name, created_by)
    values (echo.actor_org_id(), 'پروژهٔ باب', echo.actor_id())$$,
  '0227: a member still cannot create a project');

-- the helpers are nobody's to call from outside the product roles
reset role;
select t.ok(
  not has_function_privilege('public', 'echo.actor_on_project(uuid)', 'execute')
  and not has_function_privilege('public', 'echo.actor_edits_project(uuid)', 'execute')
  and has_function_privilege('echo_app', 'echo.actor_on_project(uuid)', 'execute')
  and has_function_privilege('echo_agent', 'echo.actor_on_project(uuid)', 'execute'),
  '0227: the reach helpers are the product roles'' and not PUBLIC''s');
