-- Deletion is soft; the purge is a separate role with a separate window (M11).

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
