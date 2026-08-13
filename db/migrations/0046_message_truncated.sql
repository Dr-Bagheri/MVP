-- Echo — 0046: keep "this answer was cut off" readable after the run is gone.
--
-- An assistant turn whose run failed mid-stream leaves a real partial answer in
-- the thread. The api marks it by joining to agent_run.status — derived on
-- purpose, so there is no second copy to drift.
--
-- The seam (found by the api session): the purge deletes call-linked agent_runs
-- and CANNOT delete agent_messages, so on purge the run dies, the message
-- survives, agent_run_id goes NULL, and the join yields nothing. The api's safe
-- default then declines to claim truncation — correctly, on the information it
-- has — and a turn that WAS cut off reads as complete, months later, in a
-- product whose entire value is not having to re-listen to the call.
--
-- Two individually-correct rules meeting at a seam: safe-null, and purge.
--
-- ===========================================================================
-- Why a BEFORE DELETE trigger on agent_run, and not the two shapes proposed.
--
-- Stamping from a trigger on agent_message when agent_run_id goes non-null →
-- null cannot work: that update is the foreign key's ON DELETE SET NULL
-- action, which fires AFTER the run row is gone, so the status it needs to
-- read is already deleted within that transaction. The fact becomes
-- unreadable exactly one step before the trigger that wants it.
--
-- Stamping in the purge job would work and puts the rule in application code —
-- a second home for it, and one that must remember. The database is where the
-- fact stops being readable, so the database is where it gets written down.
--
-- BEFORE DELETE on echo.agent_run is the last moment the status is still
-- there, and it fires for whoever does the deleting.
-- ===========================================================================

alter table echo.agent_message
  add column truncated boolean;

comment on column echo.agent_message.truncated is
  'NULL while the run still exists — derive it from agent_run.status. Materialized by trigger when the run is deleted, because that is when the fact stops being readable.';

create function echo.tg_agent_run_stamp_messages() returns trigger
  language plpgsql
  security definer          -- echo_purge holds no write on agent_message, by design
  set search_path = ''
as $$
begin
  -- Both outcomes are stamped, not just failure. If only errors were recorded,
  -- a NULL after purge would mean both "the run was fine" and "nothing wrote
  -- here", and those must not be the same value on a marker whose whole job is
  -- distinguishing a complete answer from a cut-off one.
  update echo.agent_message m
     set truncated = (old.status = 'error')
   where m.agent_run_id = old.id;
  return old;
end;
$$;

create trigger agent_run_stamp_messages
  before delete on echo.agent_run
  for each row execute function echo.tg_agent_run_stamp_messages();

-- Deliberately NO write grant for echo_app, despite the request.
--
-- The api asked to hold the write, and its own stated goal argues against it:
-- "never two writable copies of one fact". With the trigger as sole writer,
-- NULL means "the run is live, go and derive it" and a boolean means "the run
-- is gone, this is what it said" — and no application path can assert either.
-- The read is `coalesce(m.truncated, r.status = 'error')` exactly as designed;
-- only the write side is narrower than asked for.
