-- Echo — 0048: one truth table for "was this answer cut off".
--
-- The seam (steward): my stamp said `status <> 'ok'`, the api's live read says
-- `status = 'error'`. Two spellings of one fact, in the design built to avoid
-- exactly that — and they disagree on the state that matters. An ABANDONED run
-- (stuck 'running' because the process died) reads *complete* live and
-- *truncated* once purge stamps it, so the same message tells two stories
-- depending on when you ask.
--
-- ===========================================================================
-- Not a sweeper, and here is why.
--
-- The obvious fix is a job finalising stale 'running' runs to 'error'. It
-- works, and it costs a scheduled process, a second writer on agent_run, a
-- policy question about who that writer is, and a threshold living in the job.
--
-- But the two rules were never really different. They are the same predicate
-- evaluated with different information:
--
--     a run is truncated if it did not finish cleanly
--     and is not still plausibly in flight.
--
-- At stamp time — thirty days after the call was deleted — nothing is in
-- flight, so "not ok" was right there. Live, a run started ten seconds ago
-- might be mid-answer, so "not ok" would be wrong. One predicate, two
-- contexts, and the context is a parameter: how long ago it started.
--
-- So the fix is the one this schema keeps reaching for — write the rule once
-- and have both halves call it (D22, and 0034's "two spellings of one rule,
-- one of them unexercised, is the drift shape"). No job, no second writer, and
-- an abandoned run surfaces honestly in the live read immediately rather than
-- waiting for a purge that may be a month away.
-- ===========================================================================

create function echo.run_stall_window() returns interval
  language sql immutable parallel safe
as $$ select interval '1 hour' $$;

comment on function echo.run_stall_window() is
  'How long a run may sit in ''running'' before it stops being presumed in flight. A staleness threshold, not a timeout — nothing here kills a run.';

create function echo.run_is_truncated(
  p_status     echo.agent_run_status,
  p_started_at timestamptz
) returns boolean
  language sql
  stable
  parallel safe
  set search_path = ''
as $$
  select case
    when p_status = 'ok'    then false
    when p_status = 'error' then true
    -- 'running': in flight, or abandoned. Only the clock can tell.
    else p_started_at < now() - echo.run_stall_window()
  end;
$$;

comment on function echo.run_is_truncated(echo.agent_run_status, timestamptz) is
  'Did this run leave a partial answer? The ONLY definition — the live read and the purge-time stamp both call it, so they cannot drift apart.';

revoke all on function echo.run_is_truncated(echo.agent_run_status, timestamptz) from public;
grant execute on function echo.run_is_truncated(echo.agent_run_status, timestamptz)
  to echo_app, echo_agent;
grant execute on function echo.run_stall_window() to echo_app, echo_agent;

-- The stamp now calls it. Behaviour at purge time is unchanged — a run being
-- deleted with its expired call started at least thirty days ago, so the
-- in-flight branch cannot fire — but it is now literally the same rule the api
-- evaluates, rather than a second one that happens to agree there.
create or replace function echo.tg_agent_run_stamp_messages() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update echo.agent_message m
     set truncated = echo.run_is_truncated(old.status, old.started_at)
   where m.agent_run_id = old.id;
  return old;
end;
$$;
