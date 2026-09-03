-- db/0162 — the board's true delete, through one door.
--
-- The whole matrix (rule 7 — "the ordinary path is the product"): the
-- creator deletes their own card and every child leaves with it; a
-- colleague who did not make it is refused; an admin deletes anybody's;
-- another org is refused with the SAME sentence; and the wall the door
-- stands in has not moved — no app role holds DELETE on echo.task, and the
-- event log stays append-only for the api.
--
-- 100_tasks.sql asserts "a task can never be deleted" against the TABLE.
-- That is still true and still asserted there: this file is about the
-- function, and the two together are the claim — the row leaves through
-- the door or not at all.

reset role;

-- fixtures at owner altitude: two cards in org A (bob's and carol's), each
-- with one of every child; one card in org B for the wall test
insert into echo.task_column (id, org_id, name, tone, position, created_by)
values ('a2000000-0000-4000-8000-000000000c01',
        '0a000000-0000-4000-8000-00000000000a', 'در حال انجام', 'blue', 1,
        '01000000-0000-4000-8000-000000000001'),
       ('a2000000-0000-4000-8000-000000000c02',
        '0b000000-0000-4000-8000-00000000000b', 'Doing', 'blue', 1,
        '05000000-0000-4000-8000-000000000005');

insert into echo.task_label (id, org_id, name, color, created_by)
values ('a2000000-0000-4000-8000-000000000b01',
        '0a000000-0000-4000-8000-00000000000a', 'فوری', 'red',
        '01000000-0000-4000-8000-000000000001');

insert into echo.task (id, org_id, column_id, title, created_by)
values ('a2000000-0000-4000-8000-000000000e01',
        '0a000000-0000-4000-8000-00000000000a',
        'a2000000-0000-4000-8000-000000000c01',
        'کارت باب', '02000000-0000-4000-8000-000000000002'),
       ('a2000000-0000-4000-8000-000000000e02',
        '0a000000-0000-4000-8000-00000000000a',
        'a2000000-0000-4000-8000-000000000c01',
        'کارت کارول', '03000000-0000-4000-8000-000000000003'),
       ('a2000000-0000-4000-8000-000000000e03',
        '0b000000-0000-4000-8000-00000000000b',
        'a2000000-0000-4000-8000-000000000c02',
        'org B card', '05000000-0000-4000-8000-000000000005');

insert into echo.task_checklist_item (task_id, org_id, label, position)
values ('a2000000-0000-4000-8000-000000000e01',
        '0a000000-0000-4000-8000-00000000000a', 'خط اول', 1);
insert into echo.task_assignee (task_id, user_id, org_id)
values ('a2000000-0000-4000-8000-000000000e01',
        '03000000-0000-4000-8000-000000000003',
        '0a000000-0000-4000-8000-00000000000a');
insert into echo.task_comment (task_id, org_id, body, created_by)
values ('a2000000-0000-4000-8000-000000000e01',
        '0a000000-0000-4000-8000-00000000000a', 'یادداشت',
        '02000000-0000-4000-8000-000000000002');
insert into echo.task_label_link (task_id, label_id, org_id)
values ('a2000000-0000-4000-8000-000000000e01',
        'a2000000-0000-4000-8000-000000000b01',
        '0a000000-0000-4000-8000-00000000000a');
insert into echo.task_event (task_id, org_id, actor_id, kind)
values ('a2000000-0000-4000-8000-000000000e01',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002', 'created');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0162 door tests run under a non-bypass product role');

-- ─── a colleague is refused, and the refusal changes nothing ────────────
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.denied(
  $$select echo.delete_task('a2000000-0000-4000-8000-000000000e01')$$,
  '0162: a member cannot delete a card somebody else made');
select t.ok(
  exists (select 1 from echo.task where id = 'a2000000-0000-4000-8000-000000000e01'),
  '0162: the refused delete left the card where it was');

-- ─── THE ORDINARY PATH: the creator deletes their own, children and all ──
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  echo.delete_task('a2000000-0000-4000-8000-000000000e01'),
  '0162: a member deletes their own card');

reset role; -- the children are read at owner altitude: an absence seen from
            -- below the wall is indistinguishable from a row we cannot see
select t.ok(
  not exists (select 1 from echo.task where id = 'a2000000-0000-4000-8000-000000000e01')
  and not exists (select 1 from echo.task_checklist_item where task_id = 'a2000000-0000-4000-8000-000000000e01')
  and not exists (select 1 from echo.task_assignee       where task_id = 'a2000000-0000-4000-8000-000000000e01')
  and not exists (select 1 from echo.task_comment        where task_id = 'a2000000-0000-4000-8000-000000000e01')
  and not exists (select 1 from echo.task_label_link     where task_id = 'a2000000-0000-4000-8000-000000000e01')
  and not exists (select 1 from echo.task_event          where task_id = 'a2000000-0000-4000-8000-000000000e01'),
  '0162: the card and every child are gone — nothing is orphaned');
select t.ok(
  exists (select 1 from echo.task_label where id = 'a2000000-0000-4000-8000-000000000b01'),
  '0162: the LABEL survives — it is the org''s, not the card''s');

-- ─── THE PRIVILEGED PATH: an admin deletes a card they did not make ──────
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- admin
select t.ok(
  echo.delete_task('a2000000-0000-4000-8000-000000000e02'),
  '0162: an admin deletes a member''s card');

-- ─── another organisation, and a card that does not exist: one sentence ──
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- org B
select t.denied(
  $$select echo.delete_task('a2000000-0000-4000-8000-000000000e02')$$,
  '0162: another org''s admin is refused on a card they cannot see');
select t.denied(
  $$select echo.delete_task('a2000000-0000-4000-8000-0000000000ff')$$,
  '0162: deleting a card that does not exist reads exactly like not yours');
select t.ok(
  echo.delete_task('a2000000-0000-4000-8000-000000000e03'),
  '0162: and their own org''s card, they delete (the permitted twin)');

-- ─── THE WALL has not moved ─────────────────────────────────────────────
reset role;
select t.ok(
  not has_table_privilege('echo_app', 'echo.task', 'delete')
  and not has_table_privilege('echo_agent', 'echo.task', 'delete'),
  '0162: no app role holds DELETE on echo.task — the door is the only way');
select t.ok(
  not has_table_privilege('echo_app', 'echo.task_event', 'delete'),
  '0162: the event log stays append-only for the api');
select t.ok(
  has_function_privilege('echo_app', 'echo.delete_task(uuid)', 'execute')
  and not has_function_privilege('echo_agent', 'echo.delete_task(uuid)', 'execute')
  and not has_function_privilege('public', 'echo.delete_task(uuid)', 'execute'),
  '0162: the door opens for echo_app alone');

reset role;
