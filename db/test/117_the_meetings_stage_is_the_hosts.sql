-- db/0206 — the meeting's stage: shared with everyone, driven by the host.
--
-- A migration's self-checks run ONCE, on the day it is applied; they cannot
-- see a trigger dropped and recreated two migrations later, which is the edit
-- they exist for (0189's lesson, and the reason this file exists at all).
--
-- The matrix:
--   · a colleague READS the board — that is the whole point of it being shared;
--   · a colleague cannot WRITE it;
--   · the host can;
--   · the version is the DATABASE's — stamped on a board write, still on any
--     other write, and never taken from the caller;
--   · presenting is the same wall;
--   · and no actor at all is SILENT, because that is the purge.

reset role;

insert into echo.meeting (id, org_id, title, scheduled_at, mode, created_by)
values ('b1170000-0000-4000-8000-000000000117',
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ تختهٔ مشترک', '2099-04-01T09:00:00Z', 'online',
        '01000000-0000-4000-8000-000000000001');

/* the meeting's own document, so "present this one" is a real write with a
   real row behind it rather than a null replacing a null */
insert into echo.meeting_attachment
  (id, meeting_id, org_id, name, content_type, size_bytes, storage_path, created_by)
values ('a1170000-0000-4000-8000-000000000117',
        'b1170000-0000-4000-8000-000000000117',
        '0a000000-0000-4000-8000-00000000000a',
        'deck.pdf', 'application/pdf', 1024,
        'b1170000-0000-4000-8000-000000000117/deck.pdf',
        '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0206 stage tests run under a non-bypass product role');

-- ─── bob, a colleague on the meeting ─────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.ok(
  (select board from echo.meeting
    where id = 'b1170000-0000-4000-8000-000000000117') = '[]'::jsonb,
  '0206: a colleague READS the board — an empty one is still shared');

-- THE WALL. `t.denied` is the right instrument here and not `writes_nothing`:
-- the trigger RAISES, where a policy would merely match no rows.
select t.denied(
  $$update echo.meeting set board = '[{"tool":"pen"}]'::jsonb
     where id = 'b1170000-0000-4000-8000-000000000117'$$,
  '0206: a colleague cannot draw on the host''s board');

/*
 * A REAL document, because a no-op is not a change.
 *
 * The first version of this assertion set `presenting_attachment_id = null`
 * on a meeting where it was already null: `new is distinct from old` is FALSE
 * there, the trigger never fires, and the statement is allowed — which the
 * suite reported as "the wall let it through". It was right, and the wall was
 * fine; the test was asking about a write that does not exist. 0186 wrote the
 * same sentence down about a policy.
 */
select t.denied(
  $$update echo.meeting
       set presenting_attachment_id = 'a1170000-0000-4000-8000-000000000117'
     where id = 'b1170000-0000-4000-8000-000000000117'$$,
  '0206: …and cannot change what is being presented either');

-- the colleague may still do what 0145 gave them: the PLAN is shared
update echo.meeting set scheduled_at = '2099-04-02T09:00:00Z'
 where id = 'b1170000-0000-4000-8000-000000000117';
select t.ok(
  (select scheduled_at = '2099-04-02T09:00:00Z'::timestamptz from echo.meeting
    where id = 'b1170000-0000-4000-8000-000000000117'),
  '0206 control: the stage narrowed, the PLAN did not — a colleague still reschedules');

-- ─── alice, the host ─────────────────────────────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

update echo.meeting set board = '[{"tool":"pen"},{"tool":"rect"}]'::jsonb
 where id = 'b1170000-0000-4000-8000-000000000117';
select t.ok(
  (select jsonb_array_length(board) from echo.meeting
    where id = 'b1170000-0000-4000-8000-000000000117') = 2,
  '0206: the host draws');

select t.ok(
  (select board_version from echo.meeting
    where id = 'b1170000-0000-4000-8000-000000000117') = 1,
  '0206: and the version is stamped by the database, not sent by the caller');

-- A CALLER CANNOT HOLD THE VERSION STILL. Without this the poll could be
-- silenced by a client that kept sending the number it started with, and
-- every viewer would sit looking at a board that had moved on.
update echo.meeting
   set board = '[{"tool":"pen"}]'::jsonb, board_version = 0
 where id = 'b1170000-0000-4000-8000-000000000117';
select t.ok(
  (select board_version from echo.meeting
    where id = 'b1170000-0000-4000-8000-000000000117') = 2,
  '0206: a supplied version is overwritten — the counter is the database''s');

-- and a write that is NOT the board leaves it alone, or every reschedule
-- would read as a new stroke to everybody polling
update echo.meeting set title = 'جلسهٔ تختهٔ مشترک (۲)'
 where id = 'b1170000-0000-4000-8000-000000000117';
select t.ok(
  (select board_version from echo.meeting
    where id = 'b1170000-0000-4000-8000-000000000117') = 2,
  '0206: a title change is not a stroke');

select t.ok(
  (select count(*) from echo.meeting
    where id = 'b1170000-0000-4000-8000-000000000117'
      and presenting_attachment_id is null) = 1,
  '0206: …and the colleague''s attempt changed nothing');

update echo.meeting
   set presenting_attachment_id = 'a1170000-0000-4000-8000-000000000117'
 where id = 'b1170000-0000-4000-8000-000000000117';
select t.ok(
  (select presenting_attachment_id = 'a1170000-0000-4000-8000-000000000117'
     from echo.meeting where id = 'b1170000-0000-4000-8000-000000000117'),
  '0206: the host shows a document — the other half of the same wall');

-- ─── the purge's own silence ─────────────────────────────────────────────
-- No actor means no person, which means the purge or a definer door. A raise
-- there is a purge that does not run, on the one path where failing is worst.
--
-- AT OWNER ALTITUDE, which is where that write actually happens. Under
-- echo_app with no actor the row is not reachable at all — meeting_update
-- asks for an active actor — so the statement matches zero rows and proves
-- nothing about the trigger. A silence that cannot be distinguished from a
-- policy refusing the row is not a reading.
reset role;
select set_config('echo.actor_id', '', true);
update echo.meeting set board = '[]'::jsonb
 where id = 'b1170000-0000-4000-8000-000000000117';
select t.ok(
  (select jsonb_array_length(board) from echo.meeting
    where id = 'b1170000-0000-4000-8000-000000000117') = 0,
  '0206: with no actor set the trigger is SILENT — the purge must never raise');

reset role;
