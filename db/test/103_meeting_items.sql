-- db/0160 — the decisions, action items, questions, risks and entities a
-- person keeps, and the ones the assistant may add.
--
-- The load-bearing assertion is in the last block: echo_agent can ADD an
-- item and can neither edit nor remove one. That is the whole reason the
-- table exists as rows rather than as slices of a summary's prose, and if
-- the grant is ever widened this file is where "the AI cannot rewrite what
-- you wrote" stops being true.
--
-- The second-most important is the pair in the first block: echo_app may
-- write 'user' and may NOT write 'ai'. A badge on screen that says who wrote
-- a line is only worth rendering if the caller could not have chosen it.

reset role;

insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by)
values ('a3000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        'جلسه بازبینی', now(), 'in_person',
        '02000000-0000-4000-8000-000000000002');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0160 policy tests run under a non-bypass product role');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

-- ─── a person writes their own item ─────────────────────────────────────
insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, created_by)
values ('a3000000-0000-4000-8000-00000000000a',
        'a3000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        'action', 'قرارداد تا پنج‌شنبه امضا شود', 'user',
        '02000000-0000-4000-8000-000000000002');

select t.ok(
  (select count(*) from echo.meeting_item
    where meeting_id = 'a3000000-0000-4000-8000-000000000001') = 1,
  '0160: a member adds an action item to a meeting they can see');

-- THE ORDINARY PATH IS THE PRODUCT (rule 7): edit, tick, remove — all three,
-- because a surface with an edit button and no proof it works is a screen.
update echo.meeting_item set body = 'قرارداد تا جمعه امضا شود', done = true
 where id = 'a3000000-0000-4000-8000-00000000000a';
select t.ok(
  (select done and body like '%جمعه%' from echo.meeting_item
    where id = 'a3000000-0000-4000-8000-00000000000a'),
  '0160: a member edits and ticks their own item');

-- ─── source is not the caller's to choose ───────────────────────────────
select t.denied(
  $$insert into echo.meeting_item (meeting_id, org_id, kind, body, source, created_by)
    values ('a3000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a',
            'risk', 'ادعای ساختگی', 'ai',
            '02000000-0000-4000-8000-000000000002')$$,
  '0160: the app role cannot write an item badged as the assistant''s');

-- ─── a colleague in another organisation reads none of it ───────────────
-- through the MEETING's own policies, which is why the read policy is a
-- read of echo.meeting rather than an org check of its own
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true); -- other org
select t.ok(
  (select count(*) from echo.meeting_item) = 0,
  '0160: a member of another organisation sees no items, because they see no meeting');

-- ─── THE WALL: the agent adds and never rewrites ────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, created_by)
values ('a3000000-0000-4000-8000-00000000000b',
        'a3000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        'risk', 'تأخیر تأمین‌کننده', 'ai',
        '02000000-0000-4000-8000-000000000002');

select t.ok(
  (select source from echo.meeting_item
    where id = 'a3000000-0000-4000-8000-00000000000b') = 'ai',
  '0160: the assistant adds a risk it heard, badged as its own');

select t.denied(
  $$insert into echo.meeting_item (meeting_id, org_id, kind, body, source, created_by)
    values ('a3000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a',
            'decision', 'ادعای انسانی', 'user',
            '02000000-0000-4000-8000-000000000002')$$,
  '0160: the assistant cannot write an item badged as a person''s');

select t.ok(
  not has_table_privilege('echo_agent', 'echo.meeting_item', 'update'),
  '0160 THE WALL: the assistant cannot EDIT a meeting item');
select t.ok(
  not has_table_privilege('echo_agent', 'echo.meeting_item', 'delete'),
  '0160 THE WALL: the assistant cannot REMOVE a meeting item');

-- ─── and the person can remove it again ─────────────────────────────────
reset role;
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
delete from echo.meeting_item where id = 'a3000000-0000-4000-8000-00000000000b';
select t.ok(
  (select count(*) from echo.meeting_item
    where meeting_id = 'a3000000-0000-4000-8000-000000000001') = 1,
  '0160: a person removes an item the assistant added — the authority runs one way');

reset role;
