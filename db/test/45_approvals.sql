-- A person's decision about an agent proposal.
--
-- The agent proposes before writing anything it inferred rather than was told
-- (M4). `agent_run` records what the agent did; this is a different event that
-- references it — which is why it cannot live in a closed run (0011), and why
-- it is its own noun rather than a kind of admin action.

reset role;
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

-- ===========================================================================
-- What the next four sections assert, and what they do NOT.
--
-- They assert a SCHEMA capability: within one connection, the decision row and
-- the product write share a fate in both directions. That property is real and
-- worth pinning — it is what makes the decision row usable as the authority
-- for a write at all.
--
-- It is NOT a claim about the product path. In core/ the decision inserts on
-- echo_app and the approved write applies on echo_agent, and different roles
-- are different connections, so there is no transaction spanning them. The
-- product guarantee is **decision-first ordering** (M4 as corrected): the
-- primary key refuses a replay before anything applies, and the residual —
-- decision recorded, write failed — is visible and reconcilable rather than
-- silent.
--
-- The two roles are not an accident to be optimised away. Applying the write
-- as echo_app WOULD restore atomicity, and would also let an approved proposal
-- touch columns the agent can never touch — echo_app may write a segment's
-- confidence and provenance; echo_agent may write only its text and words. The
-- ordering guarantee is the price of keeping an approved write confined to the
-- agent's grants, which is the wall doing its job. Do not "fix" it by moving
-- the write.
-- ===========================================================================

-- --- the confirm: decision row and product write, one transaction ----------
savepoint first_confirm;

update echo.transcript_segment set text = 'گزارش هفتگی تیم فروش — تأییدشده'
 where id = 'a3000000-0000-4000-8000-000000000003';

insert into echo.proposal_decision
  (proposal_id, org_id, run_id, call_id, kind, decision, decided_by)
values ('61000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        '11000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000002',
        'transcript_correction', 'approve',
        '01000000-0000-4000-8000-000000000001');  -- deliberately WRONG: alice

-- Stamped, not supplied. A row naming someone else is corrected rather than
-- rejected: the insert policy already refuses a forged decider, so rejecting
-- would only make an honest caller's mistake fatal while doing nothing extra
-- against a dishonest one.
select t.ok(
  (select decided_by from echo.proposal_decision
    where proposal_id = '61000000-0000-4000-8000-000000000001')
    = '02000000-0000-4000-8000-000000000002',
  'the decision names whoever actually decided, not whoever the caller said');
select t.ok(
  (select decision = 'approve' and kind = 'transcript_correction'
     from echo.proposal_decision
    where proposal_id = '61000000-0000-4000-8000-000000000001'),
  'and records what was proposed and what was said about it');

-- --- the second decision loses at the key, not at a state machine ----------
savepoint second_confirm;

update echo.transcript_segment set text = 'تأیید دوباره'
 where id = 'a3000000-0000-4000-8000-000000000003';

select t.denied(
  $$insert into echo.proposal_decision
      (proposal_id, org_id, call_id, kind, decision, decided_by)
    values ('61000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a',
            'c2000000-0000-4000-8000-000000000002',
            'transcript_correction','approve',
            '02000000-0000-4000-8000-000000000002')$$,
  'a second decision on the same proposal is refused by the primary key');

-- A reject is refused too: one decision per proposal, final either way.
select t.denied(
  $$insert into echo.proposal_decision
      (proposal_id, org_id, call_id, kind, decision, decided_by)
    values ('61000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a',
            'c2000000-0000-4000-8000-000000000002',
            'transcript_correction','reject',
            '02000000-0000-4000-8000-000000000002')$$,
  'and cannot be changed by deciding the other way — a fresh proposal needs a fresh id');

-- In core/ the failure aborts the transaction on its own; the savepoint stands
-- in for that boundary here.
rollback to savepoint second_confirm;

select t.ok(
  (select text from echo.transcript_segment
    where id = 'a3000000-0000-4000-8000-000000000003')
    = 'گزارش هفتگی تیم فروش — تأییدشده',
  'and the write it would have authorised rolls back with it');

-- --- the mirror: a decision cannot survive a failed write ------------------
savepoint failing_write;
insert into echo.proposal_decision
  (proposal_id, org_id, call_id, kind, decision, decided_by)
values ('62000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a',
        'c2000000-0000-4000-8000-000000000002',
        'transcript_correction', 'approve',
        '02000000-0000-4000-8000-000000000002');
select t.denied(
  $$update echo.transcript_segment set start_ms = 5
     where id = 'a3000000-0000-4000-8000-000000000003'$$,
  'the product write fails — a correction cannot move a line');
rollback to savepoint failing_write;

select t.ok(
  (select count(*) from echo.proposal_decision
    where proposal_id = '62000000-0000-4000-8000-000000000002') = 0,
  'and the decision goes with it — "write happened, audit didn''t" is unreachable, and so is its mirror');

-- --- a rejection is a decision, and writes nothing else --------------------
insert into echo.proposal_decision
  (proposal_id, org_id, call_id, kind, decision, decided_by)
values ('63000000-0000-4000-8000-000000000003',
        '0a000000-0000-4000-8000-00000000000a',
        'c2000000-0000-4000-8000-000000000002',
        'summary_replace', 'reject',
        '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select decision from echo.proposal_decision
    where proposal_id = '63000000-0000-4000-8000-000000000003') = 'reject',
  'a refusal is recorded as fully as an approval — silence would answer "was this ever put to anyone?" wrongly');

-- --- immutable, and visible to whoever can open the call -------------------
select t.denied(
  $$update echo.proposal_decision set decision = 'approve'
     where proposal_id = '63000000-0000-4000-8000-000000000003'$$,
  'a decision cannot be revised after the fact');

select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok((select count(*) from echo.proposal_decision) = 2,
  'carol can see decisions on the org-scoped call she can open');

select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.ok((select count(*) from echo.proposal_decision) = 0,
  'and the other org sees none of them');

-- --- the agent proposes; it does not decide, and does not read the verdict --
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied($$select * from echo.proposal_decision$$,
  'the agent cannot read whether it was refused — that would make a human decision into a prompt');
select t.denied(
  $$insert into echo.proposal_decision
      (proposal_id, org_id, kind, decision, decided_by)
    values ('64000000-0000-4000-8000-000000000004',
            '0a000000-0000-4000-8000-00000000000a',
            'transcript_correction','approve',
            '02000000-0000-4000-8000-000000000002')$$,
  'and certainly cannot approve its own proposal');

reset role;
