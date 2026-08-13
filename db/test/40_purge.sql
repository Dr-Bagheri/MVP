-- Deletion is soft; the purge is a separate role with a separate window (M11).

-- --- one definition of "cut off", used live and at stamp time --------------
-- The live read and the purge-time stamp call the same function, so they
-- cannot drift into disagreeing about the same run. No clock: a message is
-- only appended after its run has finished, so a message pointing at a
-- 'running' run means the process died between those two writes.
select t.ok(not echo.run_is_truncated('ok', now() - interval '40 days'),
  'a run that finished cleanly is never truncated, however long ago');
select t.ok(echo.run_is_truncated('error', now()),
  'a failed run left a partial answer immediately');
select t.ok(echo.run_is_truncated('running', now() - interval '40 days'),
  'and so did one still running long after it should have finished');

-- The case the start time exists for: correctness that does not depend on
-- core/ writing the message after the run resolves. If that order ever
-- changes, this is what stops a live streaming answer reading as "cut off".
--
-- It has to be CONSTRUCTED. Every run in any real database is minutes or
-- months old, so a status-only rule and this one agree on all of them — the
-- distinguishing case is a run under an hour old, which exists for about an
-- hour and never when anyone is looking. Verified against live data alone, the
-- two rules look equivalent and this function looks like churn.
select t.ok(not echo.run_is_truncated('running', now()),
  'a run that began moments ago is in flight — whatever order its message was written in');

-- And only one rule exists, so nobody can call a shorter form that is correct
-- in testing and wrong for exactly that window.
select t.ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'echo' and p.proname = 'run_is_truncated') = 1,
  'there is exactly one definition of "was this answer cut off"');

-- --- the application cannot physically delete anything ---------------------
reset role;
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.denied($$delete from echo.call$$,
  'core/ holds no DELETE on calls — deletion in this product is soft');
select t.denied($$delete from echo.transcript_segment$$,
  'nor on transcripts');
select t.denied($$delete from echo.admin_action$$,
  'and the audit log cannot be tidied up by anyone');

-- --- the purge role sees only what is already past its window --------------
-- It carries no identity at all: it is maintenance, not a product path, and
-- its policies are written against the window rather than against an actor.
reset role;
set local role echo_purge;

select t.ok((select count(*) from echo.call) = 1,
  'the purge job sees exactly one call: the one deleted 40 days ago');
select t.ok(
  (select id from echo.call) = 'c4000000-0000-4000-8000-000000000004',
  'and it is the expired one, not the one deleted yesterday');

-- --- a call still inside its window is untouchable -------------------------
select t.writes_nothing(
  $$delete from echo.call where id = 'c5000000-0000-4000-8000-000000000005'$$,
  'a call deleted yesterday survives the purge job, even asked for by id');
select t.writes_nothing(
  $$delete from echo.transcript_segment
     where call_id = 'c5000000-0000-4000-8000-000000000005'$$,
  'and so do its transcripts');

-- --- an expired call goes completely: audio, transcript, derived ----------
delete from echo.summary            where call_id = 'c4000000-0000-4000-8000-000000000004';
delete from echo.agent_run          where call_id = 'c4000000-0000-4000-8000-000000000004';
delete from echo.transcript_segment where call_id = 'c4000000-0000-4000-8000-000000000004';
delete from echo.call_speaker       where call_id = 'c4000000-0000-4000-8000-000000000004';
delete from echo.call_part          where call_id = 'c4000000-0000-4000-8000-000000000004';
delete from echo.call               where id      = 'c4000000-0000-4000-8000-000000000004';

select t.ok((select count(*) from echo.call) = 0,
  'the expired call is physically gone');

reset role;
select t.ok(
  (select count(*) from echo.transcript_segment
    where call_id = 'c4000000-0000-4000-8000-000000000004') = 0,
  'its transcript went with it');
select t.ok(
  (select count(*) from echo.summary
    where call_id = 'c4000000-0000-4000-8000-000000000004') = 0,
  'and every derived artifact — transcript, summary and agent runs purge together (M11)');
select t.ok(
  (select count(*) from echo.call where id = 'c5000000-0000-4000-8000-000000000005') = 1,
  'while the call still inside its window is untouched');

-- The purge above ran with an assistant message pointing at one of the runs it
-- deleted. Before 0018 that combination stopped the purge dead on a foreign
-- key, and the call would have outlived its window — so the fact that we got
-- here at all is the assertion.
select t.ok(
  (select count(*) from echo.agent_message
    where id = '53000000-0000-4000-8000-000000000003') = 1,
  'a conversation about a purged call survives the purge');
select t.ok(
  (select agent_run_id from echo.agent_message
    where id = '53000000-0000-4000-8000-000000000003') is null,
  'but its link to the purged run is cut, not dangling');

-- Whether that turn was cut off mid-stream has to survive the run it was
-- derived from. The api reads coalesce(m.truncated, r.status = 'error'): NULL
-- while the run lives, materialized the moment it is deleted. Without this a
-- truncated answer would read as complete once its call was purged.
select t.ok(
  (select truncated from echo.agent_message
    where id = '53000000-0000-4000-8000-000000000003') is not null,
  'and the truncation marker was materialized before the run went, not lost with it');
select t.ok(
  (select truncated from echo.agent_message
    where id = '53000000-0000-4000-8000-000000000003') = false,
  'recording what the run actually said — that one finished ok, so the answer is complete');

-- The case the marker exists for: a run that died mid-stream. Without the
-- stamp this message would read as a complete answer once its call was purged,
-- and someone could act on half a summary months later.
select t.ok(
  (select truncated from echo.agent_message
    where id = '54000000-0000-4000-8000-000000000004') = true,
  'and a turn that WAS cut off still says so after the run that proved it is gone');

-- The state that is neither a clean finish nor an error: a run still 'running'
-- when its call expired. Its answer is partial too, and the first version of
-- this stamp called it complete.
select t.ok(
  (select truncated from echo.agent_message
    where id = '55000000-0000-4000-8000-000000000005') = true,
  'a run that never finished leaves a partial answer as surely as one that failed');
