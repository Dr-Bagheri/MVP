-- The work plane holds exactly the queues that have consumers (M7 as amended).
--
-- This is an inventory check, not a behaviour check — pgmq's own semantics are
-- its business. What we assert is that db/ has not left a queue standing that
-- nothing reads, because that is the failure the reshape existed to remove.
--
-- Guarded rather than assumed: pgmq ships with Supabase and not with a stock
-- Postgres, and the suite has to stay runnable against either. Where it is
-- absent the check reports itself as skipped rather than passing quietly.

do $$
declare
  found    text[];
  expected text[] := array[
    -- per-call: genuinely one step per message
    'echo_link_speakers',
    -- per-part: ONE message walks the whole ml/ ladder
    'echo_process_part',
    'echo_summarize'
  ];
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'ok  pgmq absent on this server — queue inventory not asserted here';
    return;
  end if;

  execute $q$
    select coalesce(array_agg(queue_name::text order by queue_name), '{}')
    from pgmq.list_queues()
    where queue_name like 'echo\_%'
  $q$ into found;

  perform t.ok(
    found = expected,
    format('the work plane is exactly %s', array_to_string(expected, ', '))
  );

  -- Stated separately from the inventory so the failure message names the
  -- actual mistake if someone re-adds one.
  perform t.ok(
    not (found && array['echo_vad', 'echo_transcribe', 'echo_diarize', 'echo_transcode']),
    'no queue exists for a rung that ml/ performs inside /process'
  );
end;
$$;

-- The agent is invoked by the DAG; it does not drive it.
reset role;
set local role echo_agent;
select t.denied($$select * from pgmq.list_queues()$$,
  'the agent cannot even enumerate the work plane');
reset role;
