-- db/0191 — deleting a project deletes the project, not the work.
--
-- Two halves, and the second is the one that would have shipped broken.
--
-- THE WALL: `echo_app` had no DELETE on echo.project at all, so before 0191 a
-- delete button was refused by the GRANT — for everybody. `t.writes_nothing`
-- exists to tell that apart from a policy refusing ONE caller, and it is used
-- below for exactly that reason.
--
-- THE CASCADE: 0181 pointed the task category and the chat channel at a
-- project with `on delete cascade`, and echo.task.topic_id references the
-- category with NO `on delete` clause — so NO ACTION. Deleting a project with
-- any task under it walked that chain and RAISED. The button would have
-- worked on an empty project and 500'd on every project anybody had used,
-- which is why the fixture here has a task, a folder and a room on it. An
-- empty-project fixture passes against the broken schema.
--
--   alice  owner,  org A
--   bob    member, org A, ACTIVE — the ordinary member the wall is about
--   erin   owner,  org B — another org's most privileged person

reset role;

insert into echo.project (id, org_id, name, created_by) values
  ('a8000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   'پروژهٔ حذفی', '01000000-0000-4000-8000-000000000001');

/* the three things that hang off it, all present on purpose */
insert into echo.project_member (project_id, user_id, org_id, added_by) values
  ('a8000000-0000-4000-8000-0000000000a1', '02000000-0000-4000-8000-000000000002',
   '0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001');

insert into echo.task_topic (id, org_id, name, project_id, created_by) values
  ('a8000000-0000-4000-8000-0000000000b1', '0a000000-0000-4000-8000-00000000000a',
   'پروژهٔ حذفی', 'a8000000-0000-4000-8000-0000000000a1',
   '01000000-0000-4000-8000-000000000001');

insert into echo.chat_channel (id, org_id, name, created_by, project_id) values
  ('a8000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-00000000000a',
   'اتاق پروژه', '01000000-0000-4000-8000-000000000001',
   'a8000000-0000-4000-8000-0000000000a1');

/* THE CARD THAT MADE THE OLD CHAIN RAISE — on a column this file SEEDS.
   The first version selected the org's first `task_column`, and the fixture
   has none: the insert wrote zero rows, the card never existed, and «the card
   is still on the board» failed for a reason that had nothing to do with the
   migration. Rule 9 — a check that depends on ambient data seeds its own, and
   the assertion below proves this one had a subject before the delete ran. */
insert into echo.task_column (id, org_id, name, position, created_by) values
  ('a8000000-0000-4000-8000-0000000000e1', '0a000000-0000-4000-8000-00000000000a',
   'برای انجام', 1, '01000000-0000-4000-8000-000000000001');

insert into echo.task (id, org_id, column_id, topic_id, title, created_by) values
  ('a8000000-0000-4000-8000-0000000000d1', '0a000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-0000000000e1', 'a8000000-0000-4000-8000-0000000000b1',
   'کار واقعی', '02000000-0000-4000-8000-000000000002');

insert into echo.chat_message (org_id, channel_id, author_kind, author_id, body) values
  ('0a000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-0000000000c1',
   'user', '02000000-0000-4000-8000-000000000002', 'حرفی که زده شده');

/* THE SUBJECT, asserted BEFORE the delete. Without this line the survival
   check below passes against a fixture that never wrote the card, which is
   exactly how the first run of this file failed. */
select t.ok(
  exists (select 1 from echo.task where id = 'a8000000-0000-4000-8000-0000000000d1'::uuid)
  and exists (select 1 from echo.chat_message
               where channel_id = 'a8000000-0000-4000-8000-0000000000c1'::uuid),
  '0191: the fixture really has a card and a message on this project');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0191 tests run under a non-bypass product role');

-- ─── A MEMBER MAY NOT DELETE ONE ────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
/* `writes_nothing` and not `denied`: a DELETE walled by USING raises nothing,
   it matches zero rows. And this helper refuses to accept a missing GRANT as
   proof — which is the state this migration had to leave, since a grantless
   refusal is true for everybody and says nothing about bob. */
select t.writes_nothing(
  $$delete from echo.project where id = 'a8000000-0000-4000-8000-0000000000a1'$$,
  '0191: a member cannot delete a project');
select t.ok(
  exists (select 1 from echo.project where id = 'a8000000-0000-4000-8000-0000000000a1'::uuid),
  '0191: and the project is still there afterwards');

-- ─── ANOTHER ORG'S OWNER CANNOT EITHER ──────────────────────────────────
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin, org B
select t.writes_nothing(
  $$delete from echo.project where id = 'a8000000-0000-4000-8000-0000000000a1'$$,
  '0191: another org''s owner cannot delete this project');

-- ─── THE ORDINARY PATH: an admin deletes it, WITH work under it ──────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
delete from echo.project where id = 'a8000000-0000-4000-8000-0000000000a1'::uuid;
select t.ok(
  not exists (select 1 from echo.project where id = 'a8000000-0000-4000-8000-0000000000a1'::uuid),
  '0191: an admin deletes a project that has a folder, a room and a card on it');

-- ─── AND THE WORK OUTLIVED IT ───────────────────────────────────────────
reset role;
select t.ok(
  exists (select 1 from echo.task where id = 'a8000000-0000-4000-8000-0000000000d1'::uuid),
  '0191: the card is still on the board');
select t.ok(
  exists (select 1 from echo.task_topic where id = 'a8000000-0000-4000-8000-0000000000b1'::uuid)
  and (select project_id from echo.task_topic
        where id = 'a8000000-0000-4000-8000-0000000000b1'::uuid) is null
  and (select org_id from echo.task_topic
        where id = 'a8000000-0000-4000-8000-0000000000b1'::uuid)
      = '0a000000-0000-4000-8000-00000000000a'::uuid,
  '0191: the folder survives, keeps its org, and loses only its project link');
select t.ok(
  exists (select 1 from echo.chat_channel where id = 'a8000000-0000-4000-8000-0000000000c1'::uuid)
  and (select project_id from echo.chat_channel
        where id = 'a8000000-0000-4000-8000-0000000000c1'::uuid) is null,
  '0191: the room survives and loses only its project link');
select t.ok(
  (select count(*) from echo.chat_message
    where channel_id = 'a8000000-0000-4000-8000-0000000000c1'::uuid) = 1,
  '0191: and every message people wrote in it is still there');

/* the ONE thing that goes with it — membership is a fact about a project and
   means nothing without one */
select t.ok(
  not exists (select 1 from echo.project_member
               where project_id = 'a8000000-0000-4000-8000-0000000000a1'::uuid),
  '0191: the membership goes with the project');

-- ─── the agent still cannot delete anything ─────────────────────────────
select t.ok(
  not has_table_privilege('echo_agent', 'echo.project', 'delete')
  and has_table_privilege('echo_agent', 'echo.project', 'select'),
  '0191: the agent reads projects and can never delete one');
