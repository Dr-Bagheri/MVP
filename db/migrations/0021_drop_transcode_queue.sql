-- Echo — 0021: retire echo_transcode.
--
-- 0019 reshaped the per-part plane onto a single queue but left this one
-- standing, because the worker was consuming it as a stopgap and a migration
-- does not pull a queue out from under a running consumer. Backend 2 has now
-- confirmed the switch: core/src/worker/queue.ts consumes
-- Q_PROCESS_PART = "echo_process_part", nothing references echo_transcode,
-- and PART_QUEUES is a single entry. So the per-part plane is now exactly one
-- queue, as M7-as-amended describes.
--
-- What rides echo_process_part, recorded here because the queue's existence is
-- this package's to guarantee and one field of the payload is load-bearing for
-- the security model rather than for convenience:
--
--     { "callId": "<uuid>", "ownerId": "<uuid>", "partId": "<uuid>" }
--
-- ownerId is how M3's "pipeline jobs run as the call's owner, never as a
-- service account" survives contact with a queue. The worker resolves identity
-- from the payload, re-reads the call as that owner, and fails closed if it is
-- not visible — there is no privileged lookup path that would let a job
-- proceed under an identity that does not own the work. The enqueuer therefore
-- has to write the real owner at enqueue time, while a genuine caller is
-- present. Per-call messages (echo_link_speakers, echo_summarize) carry the
-- same shape without partId.

do $$
declare
  pending bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'pgmq is not installed on this server — nothing to retire.';
    return;
  end if;

  if not exists (select 1 from pgmq.list_queues() where queue_name = 'echo_transcode') then
    return;
  end if;

  -- Same discipline as 0019, now ratified as the house style for this
  -- package: a queue that should be empty and is not is information, and a
  -- migration is the wrong place to discard it.
  select queue_length into pending from pgmq.metrics('echo_transcode');
  if coalesce(pending, 0) > 0 then
    raise exception
      'queue echo_transcode holds % message(s); 0021 will not discard queued work — drain or archive it, then re-run',
      pending;
  end if;

  perform pgmq.drop_queue('echo_transcode');
end;
$$;
