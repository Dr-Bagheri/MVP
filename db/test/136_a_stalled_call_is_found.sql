-- db/0235 — the stall recovery's two doors, against a real database.
--
-- The whole point of this file is the half no fake can hold: `stalled_calls`
-- asks pgmq whether anything is working on a call, and a stub queue answers
-- whatever its author believed. Every row below is seeded here so the
-- question has an answer that did not come from the same place as the code.
--
-- WHAT A PLAUSIBLE IMPLEMENTATION GETS WRONG, and what each case pins:
--
--   · a call with a message still in its queue is BEING WORKED ON — a part
--     may legitimately run for an hour on the long-file lane, and re-driving
--     it means paying the provider twice for the same audio
--   · a call that has only just stopped moving may be inside the millisecond
--     window between a status write and its enqueue (steps.ts keeps those
--     two statements apart on purpose)
--   · `ready` and `failed` calls are not stalled, they are finished
--   · an owner who is not active cannot be resolved, so the row must not be
--     offered at all — invariant 2 allows no write on their behalf
--   · the claim is a compare-and-set, or two workers both re-drive one call
--   · neither door is PUBLIC's, and neither is the agent's
--
-- EVERY CALL IS BORN AT THE AGE IT NEEDS. `call_set_updated_at` is a BEFORE
-- UPDATE trigger that writes `now()` unconditionally, so a row cannot be
-- aged by updating it — the first draft of this file tried, and its own
-- first assertion failed. An INSERT carries the trigger past, so the
-- fixtures state their age once and nothing here ever re-ages a row.
--
--   alice  01…  owner,  org A      dan  04…  PENDING, org A
--   bob    02…  member, org A      erin 05…  org B
--   org A  0a…a   org B  0b…b

reset role;

select t.ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'echo' and table_name = 'call'
             and column_name = 'recovery_at'),
  '0235: echo.call.recovery_at exists');

-- ── the rows ────────────────────────────────────────────────────────────
-- a1  stalled, nothing recorded         (0 parts)          → returned
-- a2  stalled, one part with no words   (1 usable, 1 bare) → returned
-- a3  stalled, but a message is live    (1 usable)         → NOT returned
-- a4  finished a moment ago             (1 usable)         → NOT returned
-- a5  stalled, owner is PENDING                            → NOT returned
-- a6  stalled, its part produced words  (1 usable, 0 bare) → returned
-- a7  ready, and old                                       → NOT returned
insert into echo.call (id, org_id, owner_id, title, scope, status, updated_at) values
  ('ca000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'هیچ صدایی ضبط نشد', 'private', 'processing',
   now() - interval '1 hour'),
  ('ca000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'یک بخش بی‌متن', 'private', 'processing',
   now() - interval '1 hour'),
  ('ca000000-0000-4000-8000-0000000000a3', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'در صف است', 'private', 'processing',
   now() - interval '1 hour'),
  ('ca000000-0000-4000-8000-0000000000a4', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'همین الان تمام شد', 'private', 'processing',
   now()),
  ('ca000000-0000-4000-8000-0000000000a5', '0a000000-0000-4000-8000-00000000000a',
   '04000000-0000-4000-8000-000000000004', 'مالکِ غیرفعال', 'private', 'processing',
   now() - interval '1 hour'),
  ('ca000000-0000-4000-8000-0000000000a6', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'متن کامل است', 'private', 'summarizing',
   now() - interval '1 hour'),
  ('ca000000-0000-4000-8000-0000000000a7', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'تمام و آماده', 'private', 'ready',
   now() - interval '2 hours');

insert into echo.call_part (id, call_id, org_id, idx, offset_ms, duration_ms,
                            storage_bucket, storage_path, status) values
  ('da000000-0000-4000-8000-0000000000a2', 'ca000000-0000-4000-8000-0000000000a2',
   '0a000000-0000-4000-8000-00000000000a', 0, 0, 60000, 'call-audio', 'a2/0.webm', 'uploaded'),
  ('da000000-0000-4000-8000-0000000000a3', 'ca000000-0000-4000-8000-0000000000a3',
   '0a000000-0000-4000-8000-00000000000a', 0, 0, 60000, 'call-audio', 'a3/0.webm', 'uploaded'),
  ('da000000-0000-4000-8000-0000000000a4', 'ca000000-0000-4000-8000-0000000000a4',
   '0a000000-0000-4000-8000-00000000000a', 0, 0, 60000, 'call-audio', 'a4/0.webm', 'uploaded'),
  ('da000000-0000-4000-8000-0000000000a5', 'ca000000-0000-4000-8000-0000000000a5',
   '0a000000-0000-4000-8000-00000000000a', 0, 0, 60000, 'call-audio', 'a5/0.webm', 'uploaded'),
  ('da000000-0000-4000-8000-0000000000a6', 'ca000000-0000-4000-8000-0000000000a6',
   '0a000000-0000-4000-8000-00000000000a', 0, 0, 60000, 'call-audio', 'a6/0.webm', 'diarized');

-- a6's part produced words; a2's did not. That is the whole difference
-- between "re-run the parts" and "re-enter at link_speakers".
insert into echo.transcript_segment
  (call_id, part_id, org_id, seq, start_ms, end_ms, text)
values ('ca000000-0000-4000-8000-0000000000a6', 'da000000-0000-4000-8000-0000000000a6',
        '0a000000-0000-4000-8000-00000000000a', 1, 0, 1000, 'سلام');

-- a3 is the one the pipeline still owns: a real message in a real queue
select pgmq.send('echo_process_part',
  jsonb_build_object('callId', 'ca000000-0000-4000-8000-0000000000a3',
                     'ownerId', '02000000-0000-4000-8000-000000000002',
                     'partId', 'da000000-0000-4000-8000-0000000000a3'));

-- ── the discovery ───────────────────────────────────────────────────────
select t.ok(
  (select count(*) from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a1') = 1,
  '0235: a call that stopped moving with nothing in flight is returned');

select t.ok(
  (select count(*) from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a2') = 1,
  '0235: a call whose part never produced a transcript is returned');

select t.ok(
  (select count(*) from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a6') = 1,
  '0235: a call stuck at summarizing with a complete transcript is returned');

-- THE DISCRIMINATING HALF. Without it every check above passes for a door
-- that never looks at the queues at all — and that door re-transcribes work
-- already in flight.
select t.ok(
  (select count(*) from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a3') = 0,
  '0235: a call with a live queue message is NOT stalled — something is working on it');

select t.ok(
  (select count(*) from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a4') = 0,
  '0235: a call that stopped moving a moment ago is inside the enqueue gap, not stalled');

select t.ok(
  (select count(*) from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a5') = 0,
  '0235: a call whose owner is not active is never offered — nothing may be written as them');

select t.ok(
  (select count(*) from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a7') = 0,
  '0235: a ready call is finished, not stalled');

-- ── the counts the recovery plans from ──────────────────────────────────
select t.ok(
  (select usable_parts = 0 and bare_parts = 0 and not has_summary
     from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a1'),
  '0235: the empty take reports no usable parts — the recovery will fail it, not summarize it');

select t.ok(
  (select usable_parts = 1 and bare_parts = 1
     from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a2'),
  '0235: a part with no transcript counts as usable AND bare');

select t.ok(
  (select usable_parts = 1 and bare_parts = 0
     from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a6'),
  '0235: a part that produced words is no longer bare');

select t.ok(
  (select status = 'summarizing' from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a6'),
  '0235: the row carries the status it stalled at');

-- a part written off as a gap is not usable: nothing to re-run there
update echo.call_part set missing = true
 where id = 'da000000-0000-4000-8000-0000000000a2';
select t.ok(
  (select usable_parts = 0 and bare_parts = 0
     from echo.stalled_calls(15, 50)
    where call_id = 'ca000000-0000-4000-8000-0000000000a2'),
  '0235: a part written off as a gap is not usable — retrying it would retry the loss');

-- ── the claim is a compare-and-set ──────────────────────────────────────
select t.ok(
  echo.claim_call_recovery('ca000000-0000-4000-8000-0000000000a1', 15) is true,
  '0235: the first claim wins');

select t.ok(
  echo.claim_call_recovery('ca000000-0000-4000-8000-0000000000a1', 15) is not true,
  '0235: the second claim inside the cooldown loses — two workers cannot both re-drive one call');

select t.ok(
  (select recovery_at is not null from echo.call
    where id = 'ca000000-0000-4000-8000-0000000000a1'),
  '0235: the claim is recorded on the row, so a person can see that the recovery acted');

-- a finished call cannot be claimed at all
select t.ok(
  echo.claim_call_recovery('ca000000-0000-4000-8000-0000000000a7', 15) is not true,
  '0235: a ready call cannot be claimed for recovery');

-- ── the walls ───────────────────────────────────────────────────────────
select t.ok(
  not has_function_privilege('echo_agent', 'echo.stalled_calls(integer, integer)', 'execute')
  and not has_function_privilege('echo_agent', 'echo.claim_call_recovery(uuid, integer)', 'execute'),
  '0235: the agent cannot reach either door');

select t.ok(
  has_function_privilege('echo_app', 'echo.stalled_calls(integer, integer)', 'execute')
  and has_function_privilege('echo_app', 'echo.claim_call_recovery(uuid, integer)', 'execute'),
  '0235: the worker''s role can');

set role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

select t.denied(
  'select * from echo.stalled_calls(15, 5)',
  '0235: a member cannot enumerate the platform''s stalled calls');

/*
 * NOT `t.writes_nothing` — it counts the rows the statement RETURNS, and
 * `select fn()` always returns exactly one (holding the function's answer),
 * so it reports "1 row(s) were written" about a door that wrote nothing.
 * The first draft of this file used it and failed for that reason. A
 * function door is asserted on its ANSWER and on the row it did not touch.
 */
select t.ok(
  echo.claim_call_recovery('ca000000-0000-4000-8000-0000000000a2', 15) is not true,
  '0235: a member''s claim is refused, not even for one of their own calls');

select t.ok(
  (select recovery_at is null from echo.call
    where id = 'ca000000-0000-4000-8000-0000000000a2'),
  '0235: and the refused claim left the row alone');

-- THE CONTROL for both refusals: with no identity — the scheduler's own
-- call — the very same statements answer. Without this, a door that refuses
-- everybody would pass both lines above.
select set_config('echo.actor_id', '', true);
select t.ok(
  (select count(*) from echo.stalled_calls(15, 50)) >= 1,
  '0235: the scheduler (no identity) reads the list');
select t.ok(
  echo.claim_call_recovery('ca000000-0000-4000-8000-0000000000a2', 15) is true,
  '0235: the scheduler claims');

reset role;
