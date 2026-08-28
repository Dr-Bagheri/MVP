-- db/0122 — an agent carries workflows, and only its governor arranges them.
--
-- The load-bearing pair: a MEMBER arranges their own user-level agent and
-- cannot arrange an org-level one; an ADMIN arranges the org's. The write
-- policy restates 0065's agent write wall through the join, and this file
-- is what holds the two walls to one answer.

reset role;

-- fixtures at owner altitude: one org agent, one user agent (bob's), one workflow
insert into echo.assistant_agent (id, level, org_id, user_id, handle, name, instructions)
values ('98000000-0000-4000-8000-0000000000a1', 'org',
        '0a000000-0000-4000-8000-00000000000a', null, 'agent-98-org', 'دستیار سازمان', 'x'),
       ('98000000-0000-4000-8000-0000000000a2', 'user',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002', 'agent-98-bob', 'دستیار باب', 'x');

insert into echo.workflow (id, org_id, handle, name, created_by)
values ('98000000-0000-4000-8000-0000000000f1',
        '0a000000-0000-4000-8000-00000000000a',
        'wf-98-fixture', 'گردش‌کار آزمون',
        '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0122 policy tests run under a non-bypass product role');

-- ─── a member and their own agent ───────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob (member)

insert into echo.agent_workflow (agent_id, workflow_id, org_id)
values ('98000000-0000-4000-8000-0000000000a2',
        '98000000-0000-4000-8000-0000000000f1',
        '0a000000-0000-4000-8000-00000000000a');

select t.ok(
  exists (select 1 from echo.agent_workflow
           where agent_id = '98000000-0000-4000-8000-0000000000a2'),
  '0122: a member arranges their OWN agent''s workflows');

-- the org agent refuses the same member (with-check raises on insert)
select t.denied(
  $$insert into echo.agent_workflow (agent_id, workflow_id, org_id)
    values ('98000000-0000-4000-8000-0000000000a1',
            '98000000-0000-4000-8000-0000000000f1',
            '0a000000-0000-4000-8000-00000000000a')$$,
  '0122: a member cannot arrange the ORG agent');

-- ─── the admin, on the org agent — the ordinary admin path ──────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice (admin)

insert into echo.agent_workflow (agent_id, workflow_id, org_id)
values ('98000000-0000-4000-8000-0000000000a1',
        '98000000-0000-4000-8000-0000000000f1',
        '0a000000-0000-4000-8000-00000000000a');
select t.ok(
  exists (select 1 from echo.agent_workflow
           where agent_id = '98000000-0000-4000-8000-0000000000a1'),
  '0122: an admin arranges the org agent');

-- and the admin cannot arrange BOB'S user agent — governing the org is not
-- steering a colleague's private assistant
-- an update outside the using-clause FILTERS to zero rows, it does not raise
-- (detach is a flag flip — 0123 keeps the delete-grant list closed at D3's
-- single entry, and this file would go red if a DELETE grant returned)
select t.writes_nothing(
  $$update echo.agent_workflow set enabled = false
     where agent_id = '98000000-0000-4000-8000-0000000000a2'$$,
  '0122: an admin cannot rearrange a member''s private agent');

-- reads follow the agent: bob sees both memberships (org agent is visible
-- to every member; his own is his)
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  (select count(*) from echo.agent_workflow
    where agent_id in ('98000000-0000-4000-8000-0000000000a1',
                       '98000000-0000-4000-8000-0000000000a2')) = 2,
  '0122: memberships read wherever the agent itself reads');

-- ─── the agent role holds NO door here ──────────────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select * from echo.agent_workflow$$,
  '0122: echo_agent cannot even read the arrangement — an agent reading which workflows steer it is a prompt writing itself');

reset role;

-- sweep the fixture (suite runs fixture-scoped against the shared dev db)
delete from echo.agent_workflow
 where agent_id in ('98000000-0000-4000-8000-0000000000a1',
                    '98000000-0000-4000-8000-0000000000a2');
delete from echo.workflow_version where workflow_id = '98000000-0000-4000-8000-0000000000f1';
delete from echo.workflow where id = '98000000-0000-4000-8000-0000000000f1';
delete from echo.assistant_agent
 where id in ('98000000-0000-4000-8000-0000000000a1',
              '98000000-0000-4000-8000-0000000000a2');
