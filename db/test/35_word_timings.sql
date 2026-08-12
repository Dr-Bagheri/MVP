-- Word-timing coverage: per part, worker-owned, and unable to lie for long.

reset role;
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.ok(
  (select has_word_timestamps from echo.call_part
    where id = 'd1000000-0000-4000-8000-000000000001') = false,
  'a part claims no word timings until something says otherwise');

-- The worker runs as the call's owner (M3), so this is an ordinary owner write.
update echo.transcript_segment
   set words = '[{"w":"سلام","s":0,"e":400},{"w":"قیمت","s":400,"e":900}]'::jsonb
 where id = 'a1000000-0000-4000-8000-000000000001';
update echo.call_part set has_word_timestamps = true
 where id = 'd1000000-0000-4000-8000-000000000001';
select t.ok(
  (select has_word_timestamps from echo.call_part
    where id = 'd1000000-0000-4000-8000-000000000001'),
  'the worker records coverage when it writes the segments');

-- --- the flag cannot outlive the words it summarizes -----------------------
update echo.transcript_segment set words = '[]'::jsonb
 where id = 'a1000000-0000-4000-8000-000000000001';
select t.ok(
  (select has_word_timestamps from echo.call_part
    where id = 'd1000000-0000-4000-8000-000000000001') = false,
  'blanking a line''s words demotes its part — the summary cannot outlive what it summarizes');

-- --- the agent can lose coverage but cannot claim it -----------------------
-- It holds UPDATE on (text, words) and nothing at all on call_part, so a
-- correction may cost a part its coverage; asserting coverage stays the
-- worker's job.
update echo.call_part set has_word_timestamps = true
 where id = 'd1000000-0000-4000-8000-000000000001';
update echo.transcript_segment
   set words = '[{"w":"سلام","s":0,"e":400}]'::jsonb
 where id = 'a1000000-0000-4000-8000-000000000001';

reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.denied(
  $$update echo.call_part set has_word_timestamps = true
     where id = 'd1000000-0000-4000-8000-000000000001'$$,
  'the agent cannot assert word-timing coverage — it holds no grant on call_part at all');

update echo.transcript_segment set words = '[]'::jsonb
 where id = 'a1000000-0000-4000-8000-000000000001';
reset role;
select t.ok(
  (select has_word_timestamps from echo.call_part
    where id = 'd1000000-0000-4000-8000-000000000001') = false,
  'but an agent correction that drops the words does demote the part');

-- --- restoring words does not restore the claim ----------------------------
-- Intended, not an oversight (steward-ratified): demotion is automatic,
-- promotion never is. A correction that puts words back does not re-assert
-- coverage for the part — only re-transcription, which is what actually knows
-- whether EVERY line in the part is timed, may do that. The failure direction
-- is the safe one: the UI degrades to line-level seeking on a part that might
-- have deserved better, rather than promising word seeking it cannot honour.
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.transcript_segment
   set words = '[{"w":"سلام","s":0,"e":400}]'::jsonb
 where id = 'a1000000-0000-4000-8000-000000000001';
reset role;
select t.ok(
  (select has_word_timestamps from echo.call_part
    where id = 'd1000000-0000-4000-8000-000000000001') = false,
  'restoring one line''s words does not re-promote the part — only the writer of the words may claim coverage');

-- --- no stored call-level equivalent, now or ever --------------------------
-- The frontend shipped a real bug from exactly this shape: a call-level flag
-- used as a per-row gate stripped click-a-word from perfectly-timed rows
-- because one OTHER part had degraded. Per part is truth; call level is a
-- derived summary and belongs in the API response, not in a column.
select t.ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'echo' and table_name = 'call'
      and (column_name ilike '%word%' or column_name ilike '%timing%'
           or column_name ilike '%seekable%')
  ),
  'echo.call has no stored word-timing flag, so nothing can gate a row on a call-level answer');
