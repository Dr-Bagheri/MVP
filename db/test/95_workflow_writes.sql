-- M41 P3+P4 — the write path's walls and the trigger doors (0108).

reset role;
set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  'P3 policy tests run under a non-bypass product role');

-- ─── scaffolding: a workflow, a version, a waiting run, a parked step ───
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, OWNER
insert into echo.workflow (id, org_id, handle, name, created_by, trigger_event)
values ('95000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        'wf-writes', 'نوشتن‌ها', '01000000-0000-4000-8000-000000000001',
        'call.summarized');
select t.denied(
  $$update echo.workflow set trigger_event = 'call.invented'
     where id = '95000000-0000-4000-8000-000000000001'$$,
  'trigger_event is a closed set — an invented fact cannot become a trigger');

insert into echo.workflow_version (id, workflow_id, org_id, version, graph, published_by)
values ('95000000-0000-4000-8000-000000000011',
        '95000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a', 1,
        '{"entry":"s1","steps":[{"id":"s1","kind":"wait","on":"decision"}]}',
        '01000000-0000-4000-8000-000000000001');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, member
insert into echo.workflow_run
  (id, org_id, owner_id, workflow_id, workflow_version_id, trigger_kind,
   status, waiting_on, wait_deadline)
values ('95000000-0000-4000-8000-000000000021',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '95000000-0000-4000-8000-000000000001',
        '95000000-0000-4000-8000-000000000011',
        'manual', 'waiting', 'decision', now() + interval '7 days');
-- the parked step (its ledger row stays running while the run waits)
insert into echo.workflow_step_run (id, org_id, owner_id, run_id, step_id, iteration)
values ('95000000-0000-4000-8000-000000000031',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '95000000-0000-4000-8000-000000000021', 's1', 0);

-- ─── the decision: one per proposal, final, stamped ─────────────────────
-- call_id is LOAD-BEARING for workflow decisions: the read policy follows
-- the call, so a NULL-call decision is invisible to its own decider (this
-- file's first red — absent-because-invisible). v1 workflow proposal kinds
-- are all call-scoped, and core requires the call on the propose step.
insert into echo.proposal_decision (proposal_id, org_id, call_id, kind, decision, decided_by)
values ('95000000-0000-4000-8000-000000000031',
        '0a000000-0000-4000-8000-00000000000a',
        'c1000000-0000-4000-8000-000000000001',
        'add_tags', 'approve', '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select via_standing from echo.proposal_decision
    where proposal_id = '95000000-0000-4000-8000-000000000031') = false,
  '0108: a live hand''s decision is via_standing = false by default');
select t.denied(
  $$insert into echo.proposal_decision (proposal_id, org_id, call_id, kind, decision, decided_by)
    values ('95000000-0000-4000-8000-000000000031',
            '0a000000-0000-4000-8000-00000000000a',
            'c1000000-0000-4000-8000-000000000001',
            'add_tags', 'reject', '02000000-0000-4000-8000-000000000002')$$,
  'the second decision on one proposal is one INSERT and one 23505 — the replay wall');

-- ─── the wait sweep door: metadata, correct verdicts ────────────────────
select t.ok(
  exists (select 1 from echo.due_workflow_waits()
           where run_id = '95000000-0000-4000-8000-000000000021'
             and step_id = 's1' and verdict = 'resume'),
  '0108: a decision-satisfied wait surfaces as resume, naming its parked step');

-- an EXPIRED wait: same shape, deadline past, no decision
insert into echo.workflow_run
  (id, org_id, owner_id, workflow_id, workflow_version_id, trigger_kind,
   status, waiting_on, wait_deadline)
values ('95000000-0000-4000-8000-000000000022',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '95000000-0000-4000-8000-000000000001',
        '95000000-0000-4000-8000-000000000011',
        'manual', 'waiting', 'decision', now() - interval '1 hour');
select t.ok(
  (select verdict from echo.due_workflow_waits()
    where run_id = '95000000-0000-4000-8000-000000000022') = 'expired',
  '0108: a question nobody answered is an answer — the wait expires by verdict');

-- ─── the schedule CAS: exactly once per due moment ──────────────────────
insert into echo.workflow_schedule
  (id, org_id, owner_id, workflow_id, cadence, next_due)
values ('95000000-0000-4000-8000-000000000041',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '95000000-0000-4000-8000-000000000001',
        'daily', now() - interval '1 minute');
select t.ok(
  exists (select 1 from echo.due_workflow_schedules()
           where id = '95000000-0000-4000-8000-000000000041'),
  '0108: a due schedule surfaces through the door');
do $$
declare
  first boolean;
  second boolean;
begin
  -- 0111: the claim takes NO echoed token — the 0108 two-arg version was
  -- green here (plpgsql kept full precision) and dead on the wire (the
  -- worker's millisecond round-trip never equalled the stored microseconds).
  -- This exercises the shape the CALLER actually uses.
  select echo.claim_workflow_fire('95000000-0000-4000-8000-000000000041') into first;
  select echo.claim_workflow_fire('95000000-0000-4000-8000-000000000041') into second;
  perform t.ok(first is true and second is null,
    '0111: the due-predicate IS the CAS — the second claim matches nothing');
  perform t.ok(
    (select next_due from echo.workflow_schedule
      where id = '95000000-0000-4000-8000-000000000041') > now(),
    '0108: a revived schedule floors at now instead of replaying every missed firing');
end;
$$;

-- ─── the agent role's two columns on echo.call ──────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
update echo.call set tags = array['گردش‌کار']
 where id = 'c1000000-0000-4000-8000-000000000001';
select t.ok(
  (select tags from echo.call where id = 'c1000000-0000-4000-8000-000000000001')
    = array['گردش‌کار'],
  '0108: the agent role applies tags to the RUN OWNER''s own call');
update echo.call set title = 'عنوان تازه'
 where id = 'c1000000-0000-4000-8000-000000000001';
select t.ok(
  (select title from echo.call where id = 'c1000000-0000-4000-8000-000000000001')
    = 'عنوان تازه',
  '0108: the agent role sets the title the human approved');
-- borrowed authority never widens: another owner's call is 0 rows
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.writes_nothing(
  $$update echo.call set tags = array['نفوذ']
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '0108: the agent as carol cannot touch bob''s call — owner-only, structurally');
-- and the grant is exactly two columns
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$update echo.call set scope = 'private'
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '0108: the agent holds tags and title, and NOT the sharing scope');
select t.denied(
  $$update echo.call set status = 'failed'
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '0108: the agent cannot touch the lifecycle either');

reset role;
