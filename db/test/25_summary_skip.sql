-- A skipped summary is not a failed call (M5 amendment), and the excuse for
-- one cannot outlive the summary's absence.
--
-- Runs against c1, which the fixture leaves ready, owned by bob, and without a
-- summary — the exact state the summarize step's terminal rung produces.

reset role;
set local role echo_app;

-- --- who may write the excuse follows the 0077 hierarchy -------------------
-- The old reading here ("a non-owner may not write it") predates 0077: an
-- outranking role may now write every column the record's owner could, the
-- skip reason included. The worker stays the ordinary author (M5); the
-- wall's question is rank, not job title.
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
update echo.call set summary_skipped_reason = 'ثبت مدیر: مدلی در دسترس نبود'
 where id = 'c1000000-0000-4000-8000-000000000001';
select t.ok(
  (select summary_skipped_reason from echo.call
    where id = 'c1000000-0000-4000-8000-000000000001') = 'ثبت مدیر: مدلی در دسترس نبود',
  'the org owner may record a skip reason on a member''s call — 0077 superseded the owner-only reading');
update echo.call set summary_skipped_reason = null
 where id = 'c1000000-0000-4000-8000-000000000001';

-- --- the owner records it, and the call stays ready ------------------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.call set summary_skipped_reason = 'هیچ مدلی در دسترس نبود'
 where id = 'c1000000-0000-4000-8000-000000000001';

select t.ok(
  (select summary_skipped_reason from echo.call
    where id = 'c1000000-0000-4000-8000-000000000001') = 'هیچ مدلی در دسترس نبود',
  'the worker records why no summary was written');
select t.ok(
  (select status = 'ready' and failure_reason is null from echo.call
    where id = 'c1000000-0000-4000-8000-000000000001'),
  'and the call is ready with no failure — a skipped summary is not a failure');

-- --- a summary landing clears the excuse, without the worker remembering ---
insert into echo.summary (call_id, org_id, body, model, created_by)
values ('c1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
        'خلاصه‌ای که بعداً نوشته شد', 'test/model',
        '02000000-0000-4000-8000-000000000002');

select t.ok(
  (select summary_skipped_reason is null and current_summary_id is not null
     from echo.call where id = 'c1000000-0000-4000-8000-000000000001'),
  'a summary arriving clears the skip reason and moves the pointer, in one trigger');

-- --- and the two states cannot be claimed at once --------------------------
select t.denied(
  $$update echo.call set summary_skipped_reason = 'دوباره رد شد'
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'a call that has a summary cannot also claim its summary was skipped');

-- Retry is the honest path: a later version supersedes, it does not reopen the
-- excuse. (Versions survive; the pointer moves — 0008.)
insert into echo.summary (call_id, org_id, body, model, created_by)
values ('c1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
        'نسخه دوم', 'test/model', '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select count(*) from echo.summary
    where call_id = 'c1000000-0000-4000-8000-000000000001') = 2,
  'retrying after a skip adds a version rather than rewriting one');

-- --- and failure_reason means failure (0024) -------------------------------
select t.denied(
  $$update echo.call set failure_reason = 'مدلی در دسترس نبود'
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'a ready call cannot carry a failure reason — that is what summary_skipped_reason is for');

update echo.call set status = 'failed', failure_reason = 'رونویسی شکست خورد'
 where id = 'c1000000-0000-4000-8000-000000000001';
select t.ok(
  (select status = 'failed' and failure_reason = 'رونویسی شکست خورد'
     from echo.call where id = 'c1000000-0000-4000-8000-000000000001'),
  'a genuinely failed call carries its reason');

-- M7: a failed call is visibly failed AND resumable. Resuming must not have to
-- remember to clear the reason — and must not be rejected for not remembering.
update echo.call set status = 'processing'
 where id = 'c1000000-0000-4000-8000-000000000001';
select t.ok(
  (select failure_reason is null from echo.call
    where id = 'c1000000-0000-4000-8000-000000000001'),
  'resuming a failed call drops the reason with it, so recovery is not an error');

reset role;
