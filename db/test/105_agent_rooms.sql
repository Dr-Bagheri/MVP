-- db/0164 — a room where agents talk, to a person and to each other.
--
-- The load-bearing assertion is the PIN: `author_kind` is decided by the role
-- that writes the row, not by the caller. echo_app can only ever say 'user'
-- and echo_agent can only ever say 'agent', so a name rendered beside a
-- message in a room full of machines is a fact about the database. A screen
-- that attributes speech is only worth having if the speaker could not have
-- chosen the attribution.
--
-- The second is the reach: echo_agent holds INSERT on messages and NOTHING
-- else — no update, no delete, and no way to open a room or invite itself
-- into one. The authority runs one way, which is the same sentence 0160 wrote
-- about meeting items.
--
-- The third is the wall between people: a room is its OWNER'S, because the
-- agents in it read that person's records under that person's authority. A
-- colleague reading the room would be reading answers drawn from records they
-- may not be able to see.

reset role;

-- fixtures at owner altitude: alice's room with رؤیا in it, and bob's own
insert into echo.agent_room (id, org_id, owner_id, title)
values ('a4000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        '01000000-0000-4000-8000-000000000001', 'اتاق آلیس'),
       ('a4000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002', 'اتاق باب');

insert into echo.agent_room_member (room_id, agent_id, org_id)
select 'a4000000-0000-4000-8000-000000000001', a.id,
       '0a000000-0000-4000-8000-00000000000a'
  from echo.assistant_agent a where a.level = 'system' and a.handle = 'roya';

/*
 * ROYA'S ID, CAPTURED AT OWNER ALTITUDE — because `echo_agent` holds no
 * SELECT on echo.assistant_agent (0065 revokes it), so the agent role cannot
 * look an agent up by handle. That is the wall being right, and it is also
 * how the product works: core resolves the agent before it ever drops to the
 * agent connection, and passes the id.
 *
 * The first draft of this file joined assistant_agent inside the agent-side
 * insert and died on "permission denied" — a test writing a statement the
 * producer would never issue.
 */
create temp table probe_agent (id uuid) on commit drop;
insert into probe_agent (id)
select a.id from echo.assistant_agent a where a.level = 'system' and a.handle = 'roya';
/*
 * The grant is not housekeeping — it is what makes the refusals below MEAN
 * anything. Without it the app-side `t.denied` passed on "permission denied
 * for table probe_agent": the right verdict for the wrong reason, which is a
 * refusal test proving nothing at all. A probe whose result you did not
 * predict has not yet told you anything; this one was predicted to fail on
 * the ROW POLICY, and now it does.
 */
grant select on probe_agent to echo_app, echo_agent;

select t.ok(
  (select count(*) from echo.agent_room_member
    where room_id = 'a4000000-0000-4000-8000-000000000001') = 1,
  '0164 fixture: the room has an agent in it — without this every check below is vacuous');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0164 policy tests run under a non-bypass product role');

-- ─── a person speaks in their own room ──────────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
insert into echo.agent_room_message
  (id, room_id, org_id, author_kind, author_user_id, body, turn)
values ('a4000000-0000-4000-8000-00000000000a',
        'a4000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        'user', '01000000-0000-4000-8000-000000000001', 'این را با هم بررسی کنید.', 0);

select t.ok(
  (select count(*) from echo.agent_room_message
    where room_id = 'a4000000-0000-4000-8000-000000000001') = 1,
  '0164: a person speaks in their own room');

-- ─── THE PIN, app side: it cannot speak AS an agent ─────────────────────
select t.denied(
  $$insert into echo.agent_room_message (room_id, org_id, author_kind, author_agent_id, body)
    select 'a4000000-0000-4000-8000-000000000001',
           '0a000000-0000-4000-8000-00000000000a', 'agent', p.id, 'ادعای ساختگی'
      from probe_agent p$$,
  '0164: the app role cannot write a message badged as an agent''s');

-- …nor as somebody else. The author is the ACTOR, not anybody they name.
select t.denied(
  $$insert into echo.agent_room_message (room_id, org_id, author_kind, author_user_id, body)
    values ('a4000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a',
            'user', '02000000-0000-4000-8000-000000000002', 'به‌جای باب')$$,
  '0164: a person cannot put words in a colleague''s mouth');

-- ─── a room is its OWNER'S ──────────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  (select count(*) from echo.agent_room
    where id = 'a4000000-0000-4000-8000-000000000001') = 0,
  '0164: a colleague in the same org cannot see somebody else''s room');
select t.ok(
  (select count(*) from echo.agent_room
    where id = 'a4000000-0000-4000-8000-000000000002') = 1,
  '0164: and can see their own — the permitted twin, without which the check above passes on a broken read');

-- ─── THE WALL: the agent adds a turn and can never revise one ───────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice's room

insert into echo.agent_room_message
  (id, room_id, org_id, author_kind, author_agent_id, body, turn, reply_to_id)
select 'a4000000-0000-4000-8000-00000000000b',
       'a4000000-0000-4000-8000-000000000001',
       '0a000000-0000-4000-8000-00000000000a',
       'agent', p.id, 'نگاه می‌کنم.', 1, 'a4000000-0000-4000-8000-00000000000a'
  from probe_agent p;

select t.ok(
  (select author_kind from echo.agent_room_message
    where id = 'a4000000-0000-4000-8000-00000000000b') = 'agent',
  '0164: the agent answers in the room, badged as its own');

select t.denied(
  $$insert into echo.agent_room_message (room_id, org_id, author_kind, author_user_id, body)
    values ('a4000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a',
            'user', '01000000-0000-4000-8000-000000000001', 'ادعای انسانی')$$,
  '0164: the agent cannot write a message badged as a person''s');

select t.ok(
  not has_table_privilege('echo_agent', 'echo.agent_room_message', 'update'),
  '0164 THE WALL: the agent cannot revise a turn — its own or anyone''s');
select t.ok(
  not has_table_privilege('echo_agent', 'echo.agent_room_message', 'delete'),
  '0164 THE WALL: the agent cannot remove a turn');
select t.ok(
  not has_table_privilege('echo_agent', 'echo.agent_room', 'insert')
  and not has_table_privilege('echo_agent', 'echo.agent_room_member', 'insert'),
  '0164 THE WALL: the agent cannot open a room or invite itself into one');

-- ─── the exchange is countable from the DATA ────────────────────────────
-- `turn` and `reply_to_id` are here so the depth of an agent-to-agent chain
-- survives a worker dying mid-exchange: a counter in memory starts again at
-- zero, and a room that quietly restarts its own loop is how a bounded
-- conversation stops being bounded.
reset role;
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select max(turn) from echo.agent_room_message
    where room_id = 'a4000000-0000-4000-8000-000000000001') = 1,
  '0164: how far the exchange ran is a fact in the room, not in a process');
select t.ok(
  (select reply_to_id from echo.agent_room_message
    where id = 'a4000000-0000-4000-8000-00000000000b')
    = 'a4000000-0000-4000-8000-00000000000a',
  '0164: and what a turn answers is recorded, so a chain can be read back');

-- ─── a person may take an agent OUT, and may not unsay anything ─────────
delete from echo.agent_room_member
 where room_id = 'a4000000-0000-4000-8000-000000000001';
select t.ok(
  (select count(*) from echo.agent_room_member
    where room_id = 'a4000000-0000-4000-8000-000000000001') = 0,
  '0164: a person can ask an agent to step out of the room');
select t.ok(
  not has_table_privilege('echo_app', 'echo.agent_room_message', 'delete')
  and not has_table_privilege('echo_app', 'echo.agent_room_message', 'update'),
  '0164: what was said in a room stays said — nobody edits or removes a turn');

reset role;
