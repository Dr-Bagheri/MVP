-- Echo — 0050: put the clock back, for the reason I did not have when I
-- removed it.
--
-- The history, plainly, because three migrations on one predicate deserves an
-- explanation rather than a tidy narrative:
--
--   0047  status <> 'ok'                      — stamp only
--   0048  + started_at, with a stall window   — to reconcile with the live read
--   0049  removed the clock                   — the api showed a message is
--                                               only appended AFTER its run
--                                               finishes, so elapsed time was
--                                               inferring a fact the data
--                                               already stated
--   0050  the clock returns                   — this file
--
-- What changed is not my judgement of the same facts. The api session then
-- observed something neither of us had said out loud: the two-argument form
-- **frees the read from depending on the append ordering at all**.
--
-- With `status <> 'ok'` alone, correctness rests on an invariant maintained in
-- core/ — that no message is written before its run resolves. Today that holds
-- and a test pins it. But if it ever changes, a live streaming answer reads as
-- "cut off" on someone's screen, and the schema has no way to notice. With the
-- start time, that same scenario reads correctly: a run that began seconds ago
-- is in flight whatever the append order happens to be.
--
-- This schema's whole posture is not to depend on another package's discipline
-- where structure can carry the answer instead. My 0049 reasoning — "a
-- threshold that guesses what the data already asserts" — was only true while
-- that discipline held, which is exactly the assumption worth removing.
--
-- The cost is bounded and invisible: an abandoned run reads as in-flight for
-- up to an hour. The cost of being tight instead is marking a live answer
-- truncated, which is a lie a person sees. Asymmetric, so err long — the api's
-- measurements (slowest real run 17s, p95 15.5s) put an hour at ~200× the
-- worst observed turn, with the honest caveat that long agentic turns are not
-- yet represented in that data.

create function echo.run_stall_window() returns interval
  language sql immutable parallel safe
as $$ select interval '1 hour' $$;

comment on function echo.run_stall_window() is
  'How long a run may sit in ''running'' before it stops being presumed in flight. A staleness threshold, not a timeout — nothing here kills a run. Generous on purpose: reading a live answer as truncated is a visible lie, reading an abandoned one as in flight is invisible.';

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
    -- 'running': in flight, or abandoned. The start time decides, so the
    -- answer does not depend on when core/ happens to write the message.
    else p_started_at < now() - echo.run_stall_window()
  end;
$$;

comment on function echo.run_is_truncated(echo.agent_run_status, timestamptz) is
  'Did this run leave a partial answer? The definition both the live read and the purge-time stamp call. Independent of whether a message is written before or after its run resolves.';

revoke all on function echo.run_is_truncated(echo.agent_run_status, timestamptz) from public;
grant execute on function echo.run_is_truncated(echo.agent_run_status, timestamptz)
  to echo_app, echo_agent;
grant execute on function echo.run_stall_window() to echo_app, echo_agent;

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

-- The one-argument form stays for now, deliberately: the api is calling it
-- this minute, and a migration does not pull a function out from under a
-- running consumer (the echo_transcode discipline). It goes in a follow-up
-- once they confirm the switch, so there is one definition again.
