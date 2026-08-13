-- Echo — 0049: drop the stall window. The message's existence is the evidence.
--
-- 0048 made "was this cut off" time-aware: a 'running' run counted as in
-- flight until it passed a stall window. That solved a problem the api session
-- then showed does not exist for messages, with an argument better than mine:
--
--   runtime.run()  → await runs.finish(runId, {status})   ← terminal write
--                  → resolves
--   route onTurn   → sessions.append(...)                 ← message written here
--
-- The message row is appended only after the run has already reached 'ok' or
-- 'error'. So a message can never point at a genuinely in-flight run — and if
-- one does, the process died between those two writes, which is truncation and
-- should read as such immediately rather than after a clock runs out.
--
-- The information my function was inferring from elapsed time is already
-- carried, exactly, by the existence of the message asking the question. A
-- threshold that reconstructs by guessing what the data already states is
-- worse than no threshold: it can be wrong, and it has to be tuned.
--
-- So the rule is `status <> 'ok'` in both halves, with no clock. That is what
-- 0047 stamped before I complicated it, and the api's live read now matches it
-- exactly.
--
-- run_stall_window() goes with it. An unused helper that looks canonical is a
-- trap for the next author (0034), and this one would look like the official
-- answer to "when is a run stale" while nothing consulted it.

create function echo.run_is_truncated(p_status echo.agent_run_status) returns boolean
  language sql
  immutable
  parallel safe
as $$ select p_status <> 'ok' $$;

comment on function echo.run_is_truncated(echo.agent_run_status) is
  'Did this run leave a partial answer? Anything but a clean finish did. The ONLY definition — the live read and the purge-time stamp both call it.';

revoke all on function echo.run_is_truncated(echo.agent_run_status) from public;
grant execute on function echo.run_is_truncated(echo.agent_run_status) to echo_app, echo_agent;

create or replace function echo.tg_agent_run_stamp_messages() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update echo.agent_message m
     set truncated = echo.run_is_truncated(old.status)
   where m.agent_run_id = old.id;
  return old;
end;
$$;

drop function echo.run_is_truncated(echo.agent_run_status, timestamptz);
drop function echo.run_stall_window();
