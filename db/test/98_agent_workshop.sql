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

-- ─── a SYSTEM agent's arrangement is per-org, admin-governed (0124) ─────
-- the agent is shared across every org; which workflows it carries is each
-- org's own row, scoped by org_id on both write and read
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice (admin)
insert into echo.agent_workflow (agent_id, workflow_id, org_id)
select a.id, '98000000-0000-4000-8000-0000000000f1', '0a000000-0000-4000-8000-00000000000a'
  from echo.assistant_agent a where a.level = 'system' and a.handle = 'meetings';
select t.ok(
  exists (select 1 from echo.agent_workflow aw
           join echo.assistant_agent a on a.id = aw.agent_id
          where a.handle = 'meetings'
            and aw.org_id = '0a000000-0000-4000-8000-00000000000a'),
  '0124: an admin arranges the org''s workflows onto a shipped system agent');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob (member)
select t.denied(
  $$insert into echo.agent_workflow (agent_id, workflow_id, org_id)
    select a.id, '98000000-0000-4000-8000-0000000000f1',
           '0a000000-0000-4000-8000-00000000000a'
      from echo.assistant_agent a where a.level = 'system' and a.handle = 'mail'$$,
  '0124: a member cannot arrange a system agent — same wall as the org agent');

-- ─── the ATTACH/DETACH the product actually issues (0134) ──────────────
-- Why this block exists, and why the two above it did not catch the defect
-- it now covers: they write `insert … values`, which needs only INSERT. The
-- product writes `insert … on conflict (agent_id, workflow_id) do update set
-- enabled = true`, which needs UPDATE — Postgres checks that privilege on
-- the STATEMENT, whether or not a row conflicts. `echo.agent_workflow`
-- carried no UPDATE grant at all, so every attach and every detach was
-- refused with 42501 while these tests stayed green.
--
-- A test that writes its own statement instead of the producer's is two
-- correct sides and an unowned boundary. So the SQL below is copied from
-- core/src/agent/agent-store.ts and must stay a copy of it.
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice (admin)

insert into echo.agent_workflow (agent_id, workflow_id, org_id, enabled)
select a.id, w.id, w.org_id, true
  from echo.assistant_agent a, echo.workflow w
 where a.level = 'system' and a.handle = 'meetings'
   and w.id = '98000000-0000-4000-8000-0000000000f1'
on conflict (agent_id, workflow_id) do update set enabled = true;

select t.ok(
  exists (select 1 from echo.agent_workflow aw
           join echo.assistant_agent a on a.id = aw.agent_id
          where a.handle = 'meetings' and aw.enabled),
  '0134: the attach the PRODUCT issues (on conflict do update) is granted');

-- the same statement twice: a re-attach must revive the kept row rather than
-- raise, which is the entire reason it is written as an upsert
insert into echo.agent_workflow (agent_id, workflow_id, org_id, enabled)
select a.id, w.id, w.org_id, true
  from echo.assistant_agent a, echo.workflow w
 where a.level = 'system' and a.handle = 'meetings'
   and w.id = '98000000-0000-4000-8000-0000000000f1'
on conflict (agent_id, workflow_id) do update set enabled = true;

update echo.agent_workflow set enabled = false
 where workflow_id = '98000000-0000-4000-8000-0000000000f1'
   and agent_id in (select id from echo.assistant_agent
                     where level = 'system' and handle = 'meetings');

select t.ok(
  exists (select 1 from echo.agent_workflow aw
           join echo.assistant_agent a on a.id = aw.agent_id
          where a.handle = 'meetings' and not aw.enabled),
  '0134: the detach the PRODUCT issues is granted, and keeps the row');

-- the wall did not widen with the grant: the column list is `enabled` alone,
-- so re-pointing a membership row at another agent is still refused
select t.denied(
  $$update echo.agent_workflow set agent_id = '98000000-0000-4000-8000-0000000000a2'
     where workflow_id = '98000000-0000-4000-8000-0000000000f1'$$,
  '0134: the grant is UPDATE(enabled) — a membership cannot be re-pointed');

-- and the ordinary refusal still refuses, now for the RIGHT reason (before
-- 0134 this passed because nobody could write the table at all)
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob (member)
-- SCOPED TO THE SYSTEM AGENT. The first draft matched on workflow_id alone
-- and went red claiming a member had breached the wall — but the fixture
-- also gives bob a membership row on his OWN agent for the same workflow,
-- and flipping that one is exactly his right. The red was my where-clause,
-- not the policy; a security finding that turns out to be a bad test is the
-- expensive kind to relay.
select t.writes_nothing(
  $$update echo.agent_workflow set enabled = true
     where workflow_id = '98000000-0000-4000-8000-0000000000f1'
       and agent_id in (select id from echo.assistant_agent
                         where level = 'system' and handle = 'meetings')$$,
  '0134: a member cannot flip a system agent''s arrangement');
reset role;
set local role echo_app;

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
                    '98000000-0000-4000-8000-0000000000a2')
    or workflow_id = '98000000-0000-4000-8000-0000000000f1';
delete from echo.workflow_version where workflow_id = '98000000-0000-4000-8000-0000000000f1';
delete from echo.workflow where id = '98000000-0000-4000-8000-0000000000f1';
delete from echo.assistant_agent
 where id in ('98000000-0000-4000-8000-0000000000a1',
              '98000000-0000-4000-8000-0000000000a2');
