-- Echo — 0047: a run that never finished is not a complete answer either.
--
-- 0046 stamped `truncated = (old.status = 'error')`, which maps the three run
-- states onto two like this:
--
--   ok       → false   complete          correct
--   error    → true    cut off           correct
--   running  → false   complete          WRONG
--
-- A run still 'running' when its call is purged never finished — the process
-- died, or the row was abandoned — so its message is a partial answer exactly
-- as an errored one is. Stamping it `false` writes down "this answer is
-- complete" about a turn that was cut off, which is precisely the lie the
-- marker exists to prevent, arriving through the one state I did not think
-- about.
--
-- The safe direction is to trust only a clean finish: anything that is not
-- 'ok' is not complete.
--
-- Kept as a boolean rather than widened to an enum, deliberately. "Failed" and
-- "never finished" are a real distinction and they belong to the RUN, which
-- carries them until it is purged along with the call's content. What the
-- message needs to survive that is one fact — whether what the reader is
-- looking at is all of it.

create or replace function echo.tg_agent_run_stamp_messages() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update echo.agent_message m
     set truncated = (old.status <> 'ok')
   where m.agent_run_id = old.id;
  return old;
end;
$$;

comment on column echo.agent_message.truncated is
  'NULL while the run exists — derive from agent_run.status. Materialized when the run is deleted: true unless the run finished cleanly, because a run that errored and one that never finished both leave a partial answer.';
