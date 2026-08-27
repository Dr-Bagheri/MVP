-- M41 P0 — the workflow engine's walls (0104/0105).
--
-- Three promises under test, each at the altitude it is made:
--   W18  a published version is immutable BY A MISSING GRANT — even its
--        author's UPDATE dies at 42501;
--   W16  step outputs are the OWNER's alone — the org owner and a plain
--        admin both read the run's ledger and neither reads the produce;
--   W1   a run belongs to its subject — nobody can mint a run owned by
--        someone else, and cross-org rows are unrepresentable.
-- Plus the small print that carries the executor later: trigger dedup,
-- named-nothing constraints, the standing-decision stamp, and the queue.

reset role;
set local role echo_app;
-- Precondition: a policy test run by a bypassing role passes vacuously
-- (rule 11's instrument precondition).
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  'M41 policy tests run under a non-bypass product role');

-- ─── the catalogue and the program ──────────────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, OWNER

insert into echo.workflow (id, org_id, handle, name, created_by)
values ('94000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        'wf-followups', 'پیگیری جلسه‌ها',
        '01000000-0000-4000-8000-000000000001');

insert into echo.workflow_version (id, workflow_id, org_id, version, graph, published_by)
values ('94000000-0000-4000-8000-000000000011',
        '94000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        1,
        '{"entry":"s1","steps":[{"id":"s1","kind":"search","scope":"transcript","of":"{{trigger.call_id}}"}]}',
        '01000000-0000-4000-8000-000000000001');

select t.ok(
  exists (select 1 from echo.workflow where id = '94000000-0000-4000-8000-000000000001'),
  'the owner authored a workflow and can read it back');

-- created_by is stamped, never supplied as someone else (0029 precedent)
select t.denied(
  $$insert into echo.workflow (org_id, handle, name, created_by)
    values ('0a000000-0000-4000-8000-00000000000a', 'wf-forged', 'x',
            '02000000-0000-4000-8000-000000000002')$$,
  'an author cannot stamp somebody else as the workflow''s creator');

-- W18: immutability is a missing grant. The AUTHOR is refused too — this
-- is the whole point, so it is the author we probe with.
select t.denied(
  $$update echo.workflow_version set max_autonomy = 'act'
     where id = '94000000-0000-4000-8000-000000000011'$$,
  'W18: no app role can UPDATE a published version — not even its author');
select t.denied(
  $$delete from echo.workflow_version
     where id = '94000000-0000-4000-8000-000000000011'$$,
  'W18: no app role can DELETE a published version');

-- the member's view: catalogue yes, program no
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, member
select t.ok(
  exists (select 1 from echo.workflow where handle = 'wf-followups'),
  'a member reads the catalogue entry (name, not program)');
select t.ok(
  not exists (select 1 from echo.workflow_version
               where workflow_id = '94000000-0000-4000-8000-000000000001'),
  'a member cannot read the program — instructions never cross to members');
select t.denied(
  $$insert into echo.workflow (org_id, handle, name, created_by)
    values ('0a000000-0000-4000-8000-00000000000a', 'wf-member', 'x',
            '02000000-0000-4000-8000-000000000002')$$,
  'a member cannot author a workflow — the wall, not just the route');

-- ─── the run: owned by its subject ──────────────────────────────────────
insert into echo.workflow_run
  (id, org_id, owner_id, workflow_id, workflow_version_id, trigger_kind)
values ('94000000-0000-4000-8000-000000000021',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '94000000-0000-4000-8000-000000000001',
        '94000000-0000-4000-8000-000000000011',
        'manual');

select t.denied(
  $$insert into echo.workflow_run
      (org_id, owner_id, workflow_id, workflow_version_id, trigger_kind)
    values ('0a000000-0000-4000-8000-00000000000a',
            '03000000-0000-4000-8000-000000000003',
            '94000000-0000-4000-8000-000000000001',
            '94000000-0000-4000-8000-000000000011', 'manual')$$,
  'W1: nobody mints a run owned by somebody else');

-- rule 12 in constraints: a waiting run names its nothing; a terminal
-- state has an end
select t.denied(
  $$update echo.workflow_run set status = 'waiting'
     where id = '94000000-0000-4000-8000-000000000021'$$,
  'a run cannot wait without naming what it waits on');
select t.denied(
  $$update echo.workflow_run set status = 'done'
     where id = '94000000-0000-4000-8000-000000000021'$$,
  'a run cannot be done without an ended_at');

-- W26: the same fact cannot double-run while live
insert into echo.workflow_run
  (id, org_id, owner_id, workflow_id, workflow_version_id, trigger_kind, trigger_ref)
values ('94000000-0000-4000-8000-000000000022',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '94000000-0000-4000-8000-000000000001',
        '94000000-0000-4000-8000-000000000011',
        'event', 'call-94');
select t.denied(
  $$insert into echo.workflow_run
      (org_id, owner_id, workflow_id, workflow_version_id, trigger_kind, trigger_ref)
    values ('0a000000-0000-4000-8000-00000000000a',
            '02000000-0000-4000-8000-000000000002',
            '94000000-0000-4000-8000-000000000001',
            '94000000-0000-4000-8000-000000000011', 'event', 'call-94')$$,
  'W26: a redelivered event cannot double-run the same fact');

-- ─── the ledger and the produce ─────────────────────────────────────────
insert into echo.workflow_step_run
  (id, org_id, owner_id, run_id, step_id, status, ended_at)
values ('94000000-0000-4000-8000-000000000031',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '94000000-0000-4000-8000-000000000021', 's1', 'done', now());

insert into echo.workflow_step_output (step_run_id, org_id, owner_id, output)
values ('94000000-0000-4000-8000-000000000031',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '{"results":["r1"]}');

select t.ok(
  exists (select 1 from echo.workflow_step_output
           where step_run_id = '94000000-0000-4000-8000-000000000031'),
  'the run''s owner reads their own step output');

-- W26 floor: the same step attempt cannot exist twice
select t.denied(
  $$insert into echo.workflow_step_run (org_id, owner_id, run_id, step_id, iteration)
    values ('0a000000-0000-4000-8000-00000000000a',
            '02000000-0000-4000-8000-000000000002',
            '94000000-0000-4000-8000-000000000021', 's1', 0)$$,
  'W26: the same (run, step, iteration) cannot exist twice');

-- a fellow MEMBER sees none of it
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  not exists (select 1 from echo.workflow_run
               where id = '94000000-0000-4000-8000-000000000021'),
  'a fellow member cannot see somebody''s run at all');

-- a plain ADMIN reads the ledger and NOT the produce (W16). dave is the
-- ordinary-path admin — the tier the M11 lesson says to walk.
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, admin
select t.ok(
  exists (select 1 from echo.workflow_run
           where id = '94000000-0000-4000-8000-000000000021'),
  'an admin reads a member''s run row — the ledger');
select t.ok(
  exists (select 1 from echo.workflow_step_run
           where run_id = '94000000-0000-4000-8000-000000000021'),
  'an admin reads a member''s step metadata — statuses, timings, codes');
select t.ok(
  not exists (select 1 from echo.workflow_step_output
               where step_run_id = '94000000-0000-4000-8000-000000000031'),
  'W16: an admin cannot read a member''s step OUTPUT');
-- and no back door through UPDATE: an admin cannot rewrite a member's run
select t.writes_nothing(
  $$update echo.workflow_run set failure_code = 'forged'
     where id = '94000000-0000-4000-8000-000000000021'$$,
  'an admin cannot rewrite a member''s run (cancel is a P3 named door)');

-- the org OWNER is not an exception to W16 either
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner
select t.ok(
  not exists (select 1 from echo.workflow_step_output
               where step_run_id = '94000000-0000-4000-8000-000000000031'),
  'W16: the org owner cannot read a member''s step output either');

-- ─── mute, standing decisions, schedules ────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
insert into echo.workflow_mute (workflow_id, owner_id, org_id)
values ('94000000-0000-4000-8000-000000000001',
        '02000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a');

select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  not exists (select 1 from echo.workflow_mute
               where owner_id = '02000000-0000-4000-8000-000000000002'),
  'W24: a mute is the subject''s own business — invisible to peers');

-- W17: the standing decision names its human, and the name is not
-- supplyable
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, admin
insert into echo.workflow_auto_apply (org_id, proposal_kind, decided_by)
values ('0a000000-0000-4000-8000-00000000000a', 'add_tags',
        '06000000-0000-4000-8000-000000000006');
select t.denied(
  $$insert into echo.workflow_auto_apply (org_id, proposal_kind, decided_by)
    values ('0a000000-0000-4000-8000-00000000000a', 'set_title',
            '01000000-0000-4000-8000-000000000001')$$,
  'W17: the standing decision cannot be stamped with somebody else''s name');

-- turning a standing decision OFF is an UPDATE that names its human —
-- never a delete (0106: rows are kept so reversal stays visible)
select t.denied(
  $$delete from echo.workflow_auto_apply where proposal_kind = 'add_tags'$$,
  '0106: a standing decision cannot be deleted, only reversed');
update echo.workflow_auto_apply
   set allowed = false, decided_by = '06000000-0000-4000-8000-000000000006', decided_at = now()
 where proposal_kind = 'add_tags';
select t.ok(
  exists (select 1 from echo.workflow_auto_apply
           where proposal_kind = 'add_tags' and allowed = false),
  'W17: turning auto-apply off is a decision on the record, not an absence');
select t.denied(
  $$update echo.workflow_auto_apply
       set allowed = true, decided_by = '01000000-0000-4000-8000-000000000001'
     where proposal_kind = 'add_tags'$$,
  'W17: a reversal cannot be stamped with somebody else''s name either');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  exists (select 1 from echo.workflow_auto_apply where proposal_kind = 'add_tags'),
  'members can KNOW what auto-applies in their org');
-- and the mute is flag-not-delete too
select t.denied(
  $$delete from echo.workflow_mute
     where owner_id = '02000000-0000-4000-8000-000000000002'$$,
  '0106: even the mute''s own owner cannot delete the row — unmute is a flag');
update echo.workflow_mute set muted = false
 where owner_id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  exists (select 1 from echo.workflow_mute
           where owner_id = '02000000-0000-4000-8000-000000000002' and muted = false),
  'W24: an unmute stays visible instead of unhappening');
select t.denied(
  $$insert into echo.workflow_auto_apply (org_id, proposal_kind, decided_by)
    values ('0a000000-0000-4000-8000-00000000000a', 'set_title',
            '02000000-0000-4000-8000-000000000002')$$,
  'a member cannot enable auto-apply');

-- an admin schedules FOR a member; the run authority stays the member's
-- (the owner_id on the schedule row IS the future run's owner)
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave
insert into echo.workflow_schedule
  (org_id, owner_id, workflow_id, cadence, next_due)
values ('0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        '94000000-0000-4000-8000-000000000001', 'weekly', now() + interval '1 day');
select t.ok(
  exists (select 1 from echo.workflow_schedule
           where owner_id = '02000000-0000-4000-8000-000000000002'),
  'an admin manages a member''s schedule — delegating timing, never authority');
select t.denied(
  $$delete from echo.workflow_schedule
     where owner_id = '02000000-0000-4000-8000-000000000002'$$,
  '0106: schedules are disabled, never deleted — no DELETE exists to reach for');

-- ─── the executor's door (0107): the caller's own run, nothing else ───
-- bob owns run …21: through the door he reads the program his run is
-- executing — the one moment the program stops being a secret FROM him
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  (select graph->>'entry' from echo.workflow_graph_for_run(
     '94000000-0000-4000-8000-000000000021')) = 's1',
  '0107: the run''s owner reads their own run''s program through the door');
-- carol owns nothing here: the door answers empty, indistinguishable from
-- no-such-run (deliberate — the door must not be an existence oracle)
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  not exists (select 1 from echo.workflow_graph_for_run(
     '94000000-0000-4000-8000-000000000021')),
  '0107: the door answers empty for a run the caller does not own');
-- and an ADMIN gets nothing through the door either — their read is the
-- version policy, not a side entrance widened past its one safe shape
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, admin
select t.ok(
  not exists (select 1 from echo.workflow_graph_for_run(
     '94000000-0000-4000-8000-000000000021')),
  '0107: the door is owner-only — an admin''s program read is the policy');

-- ─── the agent role touches none of this ────────────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select 1 from echo.workflow_version$$,
  'echo_agent has no grant to programs');
select t.denied(
  $$select 1 from echo.workflow_step_output$$,
  'echo_agent has no grant to step outputs');
select t.denied(
  $$select 1 from echo.workflow_run$$,
  'echo_agent has no grant to the run table at all');
reset role;
set local role echo_app;
-- back to an ADMIN eye for the closing checks: the migrated-shape scan
-- reads workflow_version, which a member's eye cannot see — and a check
-- run below its subject's wall passes vacuously (rule 11's counting
-- corollary, pre-empted).
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

-- ─── the queue exists and is granted (guarded like 90) ──────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'ok  pgmq absent — echo_workflow_step not asserted here';
    return;
  end if;
  perform t.ok(
    exists (select 1 from pgmq.list_queues() where queue_name = 'echo_workflow_step'),
    'the echo_workflow_step queue exists (W11: one message, one step)');
  perform t.ok(
    has_table_privilege('echo_app', 'pgmq.q_echo_workflow_step', 'insert'),
    '0090''s default privileges granted the new queue on arrival');
end;
$$;

-- ─── W15: migrated templates carry the pinned graph shape ───────────────
-- Guarded: an org with no authored templates migrates nothing, and that is
-- a fine state, not a failure.
do $$
declare
  bad int;
begin
  select count(*) into bad
    from echo.workflow w
    join echo.workflow_version v on v.id = w.current_version_id
   where exists (select 1 from echo.workflow_template t
                  where t.org_id = w.org_id and t.slug = w.handle)
     and (v.graph->>'entry') is distinct from 's1';
  perform t.ok(bad = 0,
    'W15: every migrated template''s version carries the pinned graph shape');
end;
$$;

reset role;
