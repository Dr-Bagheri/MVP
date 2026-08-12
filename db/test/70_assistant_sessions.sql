-- Assistant sessions are private to the person having the conversation —
-- including from the org's admin.
--
-- This is the one place where "admins read everything in their org" does NOT
-- apply, and it is deliberate: an admin's audit surface is echo.agent_run
-- (what the agent did, on which call, with which tools), not the text of a
-- colleague's conversations.

reset role;
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

insert into echo.agent_session (id, org_id, actor_id, title)
values ('51000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002', 'گفتگوی باب');

insert into echo.agent_message (session_id, org_id, seq, role, content)
values ('51000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
        0, 'user', 'خلاصه جلسه دیروز چه بود؟');

-- Counted by id rather than in total: the fixture already gives bob a second
-- session (the one the purge test needs).
select t.ok(
  exists (select 1 from echo.agent_session where id = '51000000-0000-4000-8000-000000000001'),
  'bob has his session');
select t.ok(
  (select count(*) from echo.agent_message
    where session_id = '51000000-0000-4000-8000-000000000001') = 1,
  'and its messages');

-- --- the admin cannot read it ----------------------------------------------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok((select count(*) from echo.agent_session) = 0,
  'an admin cannot see a colleague''s assistant sessions');
select t.ok((select count(*) from echo.agent_message) = 0,
  'nor read a single message of one');
select t.writes_nothing(
  $$update echo.agent_session set title = 'x'
     where id = '51000000-0000-4000-8000-000000000001'$$,
  'nor rename one');

-- But the audit trail an admin IS entitled to remains readable.
select t.ok((select count(*) from echo.agent_run) = 2,
  'the admin still sees the org''s agent runs — that is the audit surface (M10)');

-- --- another member cannot either ------------------------------------------
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok((select count(*) from echo.agent_message) = 0,
  'and neither can another member');

-- --- the agent reads only the conversation it is in ------------------------
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  (select count(*) from echo.agent_message
    where session_id = '51000000-0000-4000-8000-000000000001') = 1,
  'running for bob, the agent can read bob''s conversation');
select t.denied(
  $$insert into echo.agent_message (session_id, org_id, seq, role, content)
    values ('51000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a', 1, 'assistant', 'جعلی')$$,
  'but cannot write the conversation transcript — that is core/''s job, not a tool call');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok((select count(*) from echo.agent_message) = 0,
  'and running for the admin it sees nothing of bob''s conversation');

reset role;
