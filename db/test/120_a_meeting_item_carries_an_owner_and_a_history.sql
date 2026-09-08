-- db/0211 — a meeting item carries an owner, a deadline and a history.
--
-- 0160 made a meeting's decisions and action items ROWS, with `source` pinned
-- by the writing role. 0211 gave them the four things the 2026-09-08 directive
-- needed and they lacked: the colleague who owes an action as an ACCOUNT, the
-- day it is owed, the item that supersedes an earlier one, and a status.
--
-- What this file asserts is the pair 0160 got right and 0211 must not have
-- broken — an agent may CLAIM and only a person may agree — plus the four new
-- columns' own rules.
--
--   alice  owner,  org A   01…01
--   bob    member, org A   02…02  — owns the meeting's call
--   erin   owner,  org B   05…05  — another organisation
--
-- Every refusal is paired with the write that must SUCCEED, because a table
-- nobody can write passes every refusal in this file and is completely wrong.

reset role;

insert into echo.meeting (id, org_id, title, scheduled_at, created_by, mode)
values ('11000000-0000-4000-8000-0000000009b1'::uuid,
        '0a000000-0000-4000-8000-00000000000a',
        'جلسهٔ ۰۲۱۱', now(), '02000000-0000-4000-8000-000000000002', 'in_person');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0211 tests run under a non-bypass product role');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

-- ─── A PERSON WRITES A DECISION WITH AN OWNER AND A DAY ─────────────────
insert into echo.meeting_item
  (id, meeting_id, org_id, kind, body, source, owner, owner_id, due_on, created_by)
values ('12000000-0000-4000-8000-0000000009c1'::uuid,
        '11000000-0000-4000-8000-0000000009b1',
        echo.actor_org_id(), 'action', 'گزارش تا شنبه آماده می‌شود', 'user',
        'باب', '02000000-0000-4000-8000-000000000002', date '2026-09-12',
        echo.actor_id());

select t.ok(
  (select owner_id = '02000000-0000-4000-8000-000000000002'
      and due_on = date '2026-09-12' and status = 'standing'
     from echo.meeting_item where id = '12000000-0000-4000-8000-0000000009c1'),
  '0211: an action carries the account who owes it, the day, and starts standing');

/* the NAME stays beside the account, and that is deliberate: an owner the
   roster could not match is still something the meeting heard */
select t.ok(
  (select owner = 'باب' from echo.meeting_item
     where id = '12000000-0000-4000-8000-0000000009c1'),
  '0211: the spoken name survives beside the resolved account');

-- ─── THE OWNER MUST BE IN THIS ORGANISATION ────────────────────────────
select t.raises(
  $$update echo.meeting_item set owner_id = '05000000-0000-4000-8000-000000000005'
     where id = '12000000-0000-4000-8000-0000000009c1'$$,
  '23503', '0211: somebody from another organisation cannot owe an action');

-- ─── THE STATUS SET, both directions ───────────────────────────────────
select t.raises(
  $$update echo.meeting_item set status = 'cancelled'
     where id = '12000000-0000-4000-8000-0000000009c1'$$,
  '23514', '0211: an unknown status is refused');

update echo.meeting_item set status = 'reversed'
 where id = '12000000-0000-4000-8000-0000000009c1';
select t.ok(
  (select status = 'reversed' from echo.meeting_item
     where id = '12000000-0000-4000-8000-0000000009c1'),
  '0211: a permitted status is accepted');
update echo.meeting_item set status = 'standing'
 where id = '12000000-0000-4000-8000-0000000009c1';

-- ─── A LATER ITEM SUPERSEDES AN EARLIER ONE ────────────────────────────
insert into echo.meeting_item
  (id, meeting_id, org_id, kind, body, source, supersedes_id, created_by)
values ('12000000-0000-4000-8000-0000000009c2'::uuid,
        '11000000-0000-4000-8000-0000000009b1',
        echo.actor_org_id(), 'action', 'گزارش تا دوشنبه آماده می‌شود', 'user',
        '12000000-0000-4000-8000-0000000009c1', echo.actor_id());
update echo.meeting_item set status = 'superseded'
 where id = '12000000-0000-4000-8000-0000000009c1';

select t.ok(
  (select count(*) = 1 from echo.meeting_item
    where supersedes_id = '12000000-0000-4000-8000-0000000009c1'),
  '0211: the later item points back at what it replaced');
select t.ok(
  (select status = 'superseded' from echo.meeting_item
     where id = '12000000-0000-4000-8000-0000000009c1'),
  '0211: and the replaced one stays, marked — a ledger, not an overwrite');

-- ─── 0160'S WALL IS INTACT: THE AGENT CLAIMS, A PERSON AGREES ──────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

insert into echo.meeting_item
  (id, meeting_id, org_id, kind, body, source, owner_id, due_on, created_by)
values ('12000000-0000-4000-8000-0000000009c3'::uuid,
        '11000000-0000-4000-8000-0000000009b1',
        echo.actor_org_id(), 'decision', 'استخراج‌شده از رونوشت', 'ai',
        '02000000-0000-4000-8000-000000000002', date '2026-09-20', echo.actor_id());
select t.ok(
  (select source = 'ai' and owner_id is not null and due_on is not null
     from echo.meeting_item where id = '12000000-0000-4000-8000-0000000009c3'),
  '0211: the extraction writes an ai row WITH the new fields');

/* THE PAIR 0160 EXISTS FOR, re-asserted against the new columns: an agent
   that could set `status` could decide on the organisation's behalf that an
   earlier decision no longer stands.
   
   `t.denied`, not an assertion on the record — and the difference is worth
   knowing. An update walled by a POLICY is not refused, it matches zero rows
   and succeeds (0186's note, which is why that file asserts the record). This
   one is walled by the GRANT: echo_agent holds INSERT and nothing else, so
   the statement raises `permission denied` before any row is considered. The
   first draft of this test asserted the record and aborted the transaction
   instead, which is the wall being STRONGER than the assertion expected. */
select t.denied(
  $$update echo.meeting_item set status = 'reversed'
     where id = '12000000-0000-4000-8000-0000000009c1'$$,
  '0211: an agent cannot mark a person''s decision reversed');

reset role;
select t.ok(
  (select status = 'superseded' from echo.meeting_item
     where id = '12000000-0000-4000-8000-0000000009c1'),
  '0211: and the row it tried to change is untouched');

select t.ok(
  not has_table_privilege('echo_agent', 'echo.meeting_item', 'UPDATE'),
  '0211: echo_agent holds no UPDATE on the ledger');
select t.ok(
  not has_table_privilege('echo_agent', 'echo.meeting_item', 'DELETE'),
  '0211: nor a DELETE');
select t.ok(
  has_table_privilege('echo_app', 'echo.meeting_item', 'UPDATE'),
  '0211: and a person''s role does — the discriminating half');

-- ─── 0209'S TABLE IS GONE, AND THE PURGE NO LONGER NAMES IT ────────────
--
-- Standing, not only a self-check: a later migration recreating either would
-- be a second ledger arriving quietly, which is the whole thing 0211 undid.
select t.ok(
  to_regclass('echo.decision_log') is null,
  '0211: there is no second decisions table');
select t.ok(
  position('decision_log' in (
    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.proname = 'platform_purge_org')) = 0,
  '0211: and the purge does not delete from a table that does not exist');

-- ─── the fixture leaves nothing behind ─────────────────────────────────
delete from echo.meeting_item where meeting_id = '11000000-0000-4000-8000-0000000009b1';
delete from echo.meeting where id = '11000000-0000-4000-8000-0000000009b1';
