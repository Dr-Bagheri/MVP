-- Echo — 0019: the work plane, reshaped to match what actually consumes it.
--
-- M7 as amended (2026-08-12, steward + Backend 2): queue transport is not the
-- status ladder. ml/'s /process performs transcode → vad → transcribe →
-- diarize in ONE approved call, so the worker walks a part through all four
-- rungs from a single message. 0017's per-part queues were modelled on the
-- status ladder instead of on the consumers, which left three of them
-- (echo_vad, echo_transcribe, echo_diarize) with no consumer at all.
--
-- A queue nothing reads is worse than a missing one: it looks like a
-- component, it shows up in dashboards, and the first person to debug a stuck
-- pipeline spends an afternoon proving it is empty on purpose. Drop them.
--
-- What does NOT change: echo.part_status keeps every rung. The statuses are
-- the progress positions the UI shows and the artifacts each step checks
-- against; only the transport collapses. "One step per queue message" now
-- holds for the per-call steps, which genuinely are separate messages.
--
-- echo_transcode is deliberately left in place here — the worker is consuming
-- it as a stopgap until this lands, and pulling a queue out from under a
-- running consumer is not something a migration should do on a shared
-- project. It goes in a follow-up once Backend 2 confirms the switch.

do $$
declare
  q       text;
  pending bigint;
  doomed  text[] := array['echo_vad', 'echo_transcribe', 'echo_diarize'];
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice
      'pgmq is not installed on this server — queue reshape skipped. Expected on a stock Postgres; on Supabase, enable the pgmq extension.';
    return;
  end if;

  -- The per-part plane, as one message.
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'echo_process_part') then
    perform pgmq.create('echo_process_part');
  end if;

  foreach q in array doomed loop
    if exists (select 1 from pgmq.list_queues() where queue_name = q) then
      -- These queues should be empty, because nothing was ever written to
      -- them. If that turns out to be wrong, the messages are real work and a
      -- migration is the wrong place to discard them silently.
      execute format('select queue_length from pgmq.metrics(%L)', q) into pending;
      if coalesce(pending, 0) > 0 then
        raise exception
          'queue % holds % message(s); 0019 will not discard queued work — drain or archive it, then re-run',
          q, pending;
      end if;
      perform pgmq.drop_queue(q);
    end if;
  end loop;

  -- Same grants as 0017, re-issued because the new queue's tables did not
  -- exist when those ran. echo_app only: the agent is invoked BY the DAG and
  -- has no business driving it.
  execute 'grant usage on schema pgmq to echo_app';
  execute 'grant select, insert, update, delete on all tables in schema pgmq to echo_app';
  execute 'grant execute on all functions in schema pgmq to echo_app';
end;
$$;
