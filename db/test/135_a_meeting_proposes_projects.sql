-- db/0234 — a meeting's items are five kinds, and one of them is new.
--
-- 0160's set was decision · action · question · risk · entity. The user's
-- 2026-09-19 ruling on the review tabs re-cut it: `project` joins (a project
-- the meeting proposed, made real on the board by an admin), `entity` leaves.
-- 0234's own self-checks read the catalogue and refuse an entity row; what a
-- migration cannot do is mint rows in a real organisation, so the POSITIVE
-- half — every permitted kind is accepted, on the ordinary path, by the role
-- the screen uses — lives here, on the suite's own fixture. A file that only
-- asserted refusals would pass against a table nobody can write (rule 7: the
-- ordinary path is the product).
--
--   alice  owner,  org A   01…01
--   bob    member, org A   02…02
--   erin   owner,  org B   05…05  — another organisation
--
-- 0160's wall is re-asserted over the new kind, because a widened check is
-- exactly the edit that gets made without re-reading the policies beside it:
-- the agent may CLAIM a project (source = 'ai', insert) and may not touch it
-- afterwards (no UPDATE grant — `t.denied`, since a GRANT refuses before any
-- row is considered, unlike a policy, which matches zero rows and succeeds).

reset role;

insert into echo.meeting (id, org_id, title, scheduled_at, created_by, mode)
values ('13500000-0000-4000-8000-000000000001'::uuid,
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ ۰۲۳۴', now(), '02000000-0000-4000-8000-000000000002', 'in_person');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0234 tests run under a non-bypass product role');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

-- ─── EVERY KIND IN THE SET IS ACCEPTED, as a person's own line ──────────
insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, created_by)
values
  ('13500000-0000-4000-8000-0000000000a1', '13500000-0000-4000-8000-000000000001', echo.actor_org_id(), 'decision', 'قرارداد امضا می‌شود', 'user', echo.actor_id()),
  ('13500000-0000-4000-8000-0000000000a2', '13500000-0000-4000-8000-000000000001', echo.actor_org_id(), 'action',   'گزارش تا شنبه',       'user', echo.actor_id()),
  ('13500000-0000-4000-8000-0000000000a3', '13500000-0000-4000-8000-000000000001', echo.actor_org_id(), 'project',  'پروژهٔ دیتابیس صوتی', 'user', echo.actor_id()),
  ('13500000-0000-4000-8000-0000000000a4', '13500000-0000-4000-8000-000000000001', echo.actor_org_id(), 'question', 'بودجه از کجا؟',       'user', echo.actor_id()),
  ('13500000-0000-4000-8000-0000000000a5', '13500000-0000-4000-8000-000000000001', echo.actor_org_id(), 'risk',     'ممکن است دیر شود',    'user', echo.actor_id());

select t.ok(
  (select count(*) from echo.meeting_item
    where meeting_id = '13500000-0000-4000-8000-000000000001'
      and kind in ('decision','action','project','question','risk')) = 5,
  '0234: decision, action, project, question and risk are all accepted');

/* the row that IS the new kind, read back by name rather than by count — a
   count of five is satisfied by five decisions */
select t.ok(
  (select kind = 'project' and not done from echo.meeting_item
     where id = '13500000-0000-4000-8000-0000000000a3'),
  '0234: a proposed project is a row of its own kind, not yet made real');

-- ─── A PROJECT IS TICKED LIKE A TASK, once an admin has made it real ─────
update echo.meeting_item set done = true
 where id = '13500000-0000-4000-8000-0000000000a3';
select t.ok(
  (select done from echo.meeting_item where id = '13500000-0000-4000-8000-0000000000a3'),
  '0234: a project item can be ticked — the review tab treats it as the task tab does');

-- ─── THE TWO KINDS THAT ARE NOT IN THE SET ───────────────────────────────
select t.raises(
  $$insert into echo.meeting_item (meeting_id, org_id, kind, body, source, created_by)
    values ('13500000-0000-4000-8000-000000000001', echo.actor_org_id(),
            'entity', 'موجودیت', 'user', echo.actor_id())$$,
  '23514', '0234: entity is no longer a kind a meeting produces');

select t.raises(
  $$insert into echo.meeting_item (meeting_id, org_id, kind, body, source, created_by)
    values ('13500000-0000-4000-8000-000000000001', echo.actor_org_id(),
            'wish', 'ای کاش', 'user', echo.actor_id())$$,
  '23514', '0234: an invented kind is refused — the set is closed, not widened');

-- ─── 0160'S WALL, OVER THE NEW KIND: the agent claims, a person agrees ────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, created_by)
values ('13500000-0000-4000-8000-0000000000b1', '13500000-0000-4000-8000-000000000001',
        echo.actor_org_id(), 'project', 'پروژهٔ استخراج‌شده از رونوشت', 'ai', echo.actor_id());
select t.ok(
  (select source = 'ai' and kind = 'project' from echo.meeting_item
     where id = '13500000-0000-4000-8000-0000000000b1'),
  '0234: the extraction writes a proposed project as an ai row');

select t.denied(
  $$update echo.meeting_item set done = true
     where id = '13500000-0000-4000-8000-0000000000b1'$$,
  '0234: the agent cannot mark its own proposed project as made — only a person can');

select t.denied(
  $$delete from echo.meeting_item where id = '13500000-0000-4000-8000-0000000000b1'$$,
  '0234: the agent cannot withdraw a claim either');

-- ─── ANOTHER ORGANISATION READS NONE OF IT ───────────────────────────────
reset role;
set local role echo_app;
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin, org B
select t.ok(
  (select count(*) from echo.meeting_item
    where meeting_id = '13500000-0000-4000-8000-000000000001') = 0,
  '0234: a proposed project is visible exactly where its meeting is — and nowhere else');

reset role;
