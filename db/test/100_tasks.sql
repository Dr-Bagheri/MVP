-- db/0144 — the task board: org-shared, org-walled, and the two argued deletes.
--
-- The load-bearing rows of the matrix:
--   · any active member of the org reads the board and moves a card
--     (collaborative by design — that is what a kanban is for);
--   · another org sees NOTHING, on every one of the six tables;
--   · created_by is pinned at insert (a fact must not be supplyable);
--   · a comment can never be edited and a task can never be deleted;
--   · the two granted deletes (checklist line, assignee row) actually work,
--     and only inside the actor's own org.

reset role;

-- fixtures at owner altitude: a column, a topic, a task with one checklist
-- line and one comment, all in org A; a column in org B for the wall test
insert into echo.task_column (id, org_id, name, tone, position, created_by)
values ('a0000000-0000-4000-8000-000000000c01',
        '0a000000-0000-4000-8000-00000000000a', 'برای انجام', 'blue', 1,
        '01000000-0000-4000-8000-000000000001'),
       ('a0000000-0000-4000-8000-000000000c02',
        '0b000000-0000-4000-8000-00000000000b', 'To do', 'blue', 1,
        '05000000-0000-4000-8000-000000000005');

insert into echo.task_topic (id, org_id, name, created_by)
values ('a0000000-0000-4000-8000-000000000d01',
        '0a000000-0000-4000-8000-00000000000a', 'راه‌اندازی',
        '01000000-0000-4000-8000-000000000001');

insert into echo.task (id, org_id, column_id, topic_id, title, priority, created_by)
values ('a0000000-0000-4000-8000-000000000e01',
        '0a000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000c01',
        'a0000000-0000-4000-8000-000000000d01',
        'اجرای اسکریپت مهاجرت', 'critical',
        '01000000-0000-4000-8000-000000000001');

insert into echo.task_checklist_item (id, task_id, org_id, label, position)
values ('a0000000-0000-4000-8000-000000000f01',
        'a0000000-0000-4000-8000-000000000e01',
        '0a000000-0000-4000-8000-00000000000a', 'نوشتن اسکریپت', 1);

insert into echo.task_comment (id, task_id, org_id, body, created_by)
values ('a0000000-0000-4000-8000-000000000f51',
        'a0000000-0000-4000-8000-000000000e01',
        '0a000000-0000-4000-8000-00000000000a', 'قفل حساب‌ها بررسی شود',
        '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0144 policy tests run under a non-bypass product role');

-- ─── bob, an ordinary MEMBER of org A: the collaborative path ────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.ok(
  (select count(*) from echo.task) = 1,
  '0144: a member reads the org''s board');

-- moving a card is the board's whole point — a member moves ANY task
update echo.task set done_at = now()
 where id = 'a0000000-0000-4000-8000-000000000e01';
select t.ok(
  (select done_at is not null from echo.task
    where id = 'a0000000-0000-4000-8000-000000000e01'),
  '0144: a member moves/marks a card they did not create — the board is shared');

-- a member creates a task, and created_by is PINNED to them
select t.denied(
  $$insert into echo.task (org_id, column_id, title, created_by)
    values ('0a000000-0000-4000-8000-00000000000a',
            'a0000000-0000-4000-8000-000000000c01',
            'x', '01000000-0000-4000-8000-000000000001')$$,
  '0144: created_by cannot be supplied as someone else');

insert into echo.task (id, org_id, column_id, title, created_by)
values ('a0000000-0000-4000-8000-000000000e02',
        '0a000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000c01',
        'تسک باب', '02000000-0000-4000-8000-000000000002');
select t.ok(
  exists (select 1 from echo.task where id = 'a0000000-0000-4000-8000-000000000e02'),
  '0144: a member creates their own task');

-- the checklist delete WORKS (the argued exception, positively detected)
delete from echo.task_checklist_item
 where id = 'a0000000-0000-4000-8000-000000000f01';
select t.ok(
  not exists (select 1 from echo.task_checklist_item
               where id = 'a0000000-0000-4000-8000-000000000f01'),
  '0144: removing a checklist line is editing the task — the delete works');

-- assignee membership: add self, then remove self — the row LEAVES
insert into echo.task_assignee (task_id, user_id, org_id)
values ('a0000000-0000-4000-8000-000000000e01',
        '02000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a');
delete from echo.task_assignee
 where task_id = 'a0000000-0000-4000-8000-000000000e01'
   and user_id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  not exists (select 1 from echo.task_assignee
               where task_id = 'a0000000-0000-4000-8000-000000000e01'),
  '0144: an unassigned person leaves the list — membership rows delete, never accrete');

-- the record itself does NOT delete, for anyone
select t.denied(
  $$delete from echo.task where id = 'a0000000-0000-4000-8000-000000000e01'$$,
  '0144: a task row cannot be deleted — archived_at is the only way off the board');

-- comments are append-only by grant
select t.denied(
  $$update echo.task_comment set body = 'edited'
     where id = 'a0000000-0000-4000-8000-000000000f51'$$,
  '0144: a comment cannot be edited — an edited remark is a new remark');
select t.denied(
  $$delete from echo.task_comment
     where id = 'a0000000-0000-4000-8000-000000000f51'$$,
  '0144: a comment cannot be deleted');

-- ─── erin, in ANOTHER ORG: the wall, on every table ──────────────────────
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);

select t.ok(
  (select count(*) from echo.task) = 0
  and (select count(*) from echo.task_topic) = 0
  and (select count(*) from echo.task_comment) = 0
  and (select count(*) from echo.task_checklist_item) = 0
  and (select count(*)
         from echo.task_column
        where org_id = '0a000000-0000-4000-8000-00000000000a') = 0,
  '0144: another org sees none of org A''s board — tasks, topics, columns, checklist, comments');

-- and cannot write INTO org A even naming its ids outright
select t.denied(
  $$insert into echo.task (org_id, column_id, title, created_by)
    values ('0a000000-0000-4000-8000-00000000000a',
            'a0000000-0000-4000-8000-000000000c01',
            'x', '05000000-0000-4000-8000-000000000005')$$,
  '0144: a stranger cannot write into org A''s board');

-- erin CAN use her own org's board — the wall keeps orgs apart, not out
insert into echo.task (id, org_id, column_id, title, created_by)
values ('a0000000-0000-4000-8000-000000000e03',
        '0b000000-0000-4000-8000-00000000000b',
        'a0000000-0000-4000-8000-000000000c02',
        'Erin''s task', '05000000-0000-4000-8000-000000000005');
select t.ok(
  (select count(*) from echo.task) = 1,
  '0144: org B''s own board works, and holds exactly org B''s rows');

-- ─── dan, PENDING in org A: not yet inside the wall ─────────────────────
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true);
select t.ok(
  (select count(*) from echo.task) = 0,
  '0144: a pending member sees no board — active status is part of the wall');

-- ─── 0147: labels, their links, and the append-only history ─────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

insert into echo.task_label (id, org_id, name, color, created_by)
values ('a0000000-0000-4000-8000-0000000000b1',
        '0a000000-0000-4000-8000-00000000000a', 'فوری', 'red',
        '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select color from echo.task_label where id = 'a0000000-0000-4000-8000-0000000000b1') = 'red',
  '0147: a member creates a label with a tone from the closed set');

select t.denied(
  $$update echo.task_label set color = '#ff0000'
     where id = 'a0000000-0000-4000-8000-0000000000b1'$$,
  '0147: a free colour is refused — the chips stay on the theme''s palette');

insert into echo.task_label_link (task_id, label_id, org_id)
values ('a0000000-0000-4000-8000-000000000e01',
        'a0000000-0000-4000-8000-0000000000b1',
        '0a000000-0000-4000-8000-00000000000a');
delete from echo.task_label_link
 where task_id = 'a0000000-0000-4000-8000-000000000e01'
   and label_id = 'a0000000-0000-4000-8000-0000000000b1';
select t.ok(
  not exists (select 1 from echo.task_label_link
               where task_id = 'a0000000-0000-4000-8000-000000000e01'),
  '0147: taking a label off a card removes the row — membership, not a flag');

insert into echo.task_event (task_id, org_id, actor_id, kind, detail)
values ('a0000000-0000-4000-8000-000000000e01',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002', 'done', '{}'::jsonb);
select t.ok(
  (select count(*) from echo.task_event
    where task_id = 'a0000000-0000-4000-8000-000000000e01') = 1,
  '0147: the history takes an entry');

select t.denied(
  $$insert into echo.task_event (task_id, org_id, actor_id, kind)
    values ('a0000000-0000-4000-8000-000000000e01',
            '0a000000-0000-4000-8000-00000000000a',
            '01000000-0000-4000-8000-000000000001', 'done')$$,
  '0147: a history entry cannot be written in someone else''s name');

select t.denied(
  $$update echo.task_event set kind = 'undone'
     where task_id = 'a0000000-0000-4000-8000-000000000e01'$$,
  '0147: history cannot be edited — an edited history is not a history');
select t.denied(
  $$delete from echo.task_event
     where task_id = 'a0000000-0000-4000-8000-000000000e01'$$,
  '0147: history cannot be deleted');

select t.denied(
  $$insert into echo.task_event (task_id, org_id, actor_id, kind)
    values ('a0000000-0000-4000-8000-000000000e01',
            '0a000000-0000-4000-8000-00000000000a',
            '02000000-0000-4000-8000-000000000002', 'exploded')$$,
  '0147: an unknown history kind is refused — the reader renders a sentence per kind');

-- the wall: another org sees none of it
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.ok(
  (select count(*) from echo.task_label) = 0
  and (select count(*) from echo.task_event) = 0
  and (select count(*) from echo.task_label_link) = 0,
  '0147: another org sees no labels, links or history of org A');
