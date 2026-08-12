-- Echo — 0017: the work plane (M7). One queue per DAG step, one step per
-- message.
--
-- pgmq is an extension, and whether it exists is a property of the server,
-- not of our code: it ships with Supabase, and not with a stock Postgres. So
-- this migration creates the queues where it can and says so where it cannot
-- — the schema and the security tests must remain runnable against any
-- Postgres (steward's constraint), and queues are not part of the wall.
--
-- core/worker owns what goes INTO these queues; this file only guarantees
-- they exist and that echo_app — and only echo_app — can work them.

do $$
declare
  q text;
  queues text[] := array[
    -- per part
    'echo_transcode', 'echo_vad', 'echo_transcribe', 'echo_diarize',
    -- per call, once its parts are done
    'echo_link_speakers', 'echo_summarize'
  ];
begin
  if not exists (select 1 from pg_available_extensions where name = 'pgmq') then
    raise notice
      'pgmq is not available on this server — queues skipped. Expected on a stock Postgres; on Supabase, enable the pgmq extension.';
    return;
  end if;

  create extension if not exists pgmq;

  foreach q in array queues loop
    -- pgmq.create is itself idempotent-ish, but it raises if the queue is
    -- already there, so ask first: migrations get re-run against databases
    -- that are further along than the ledger thinks.
    if not exists (select 1 from pgmq.list_queues() where queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;

  -- The worker is the only thing that touches the work plane. The agent has
  -- no business queueing work: it is invoked by the DAG, it does not drive it.
  execute 'grant usage on schema pgmq to echo_app';
  execute 'grant select, insert, update, delete on all tables in schema pgmq to echo_app';
  execute 'grant execute on all functions in schema pgmq to echo_app';
end;
$$;
