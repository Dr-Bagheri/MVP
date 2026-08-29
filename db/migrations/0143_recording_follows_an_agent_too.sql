-- 0143 — the same "start a recording when I use this" switch, for agents.
--
-- User directive, 2026-08-29: "add a toggle in all agents that can be on and
-- if it was it automatically start recording and opens the mini recorder".
--
-- Identical shape to 0142's `record_on_workflows`, and deliberately a second
-- column rather than one shared set: an agent handle and a workflow slug are
-- different namespaces, and a single list would make `meetings` ambiguous
-- the day an agent and a template share a name. Two columns cannot collide.
--
-- Per-person for the same reason as 0142 — "start a recording when I use
-- this" describes how somebody works, and two colleagues may reasonably want
-- opposite answers for one shipped agent that neither of them owns.
--
-- The grant comes with the column: a policy governs who may write, and a
-- GRANT decides whether the write is possible at all (0134).

begin;

alter table echo.app_user
  add column if not exists record_on_agents text[] not null default '{}';

comment on column echo.app_user.record_on_agents is
  'M47/0143: agent handles this person wants a recording started for when THEY open that agent in the assistant. Per-person; read by a client that has a microphone, so nothing records without somebody there.';

grant update (record_on_agents) on echo.app_user to echo_app;

do $check$
begin
  if not has_column_privilege('echo_app', 'echo.app_user', 'record_on_agents', 'UPDATE')
     or not has_column_privilege('echo_app', 'echo.app_user', 'record_on_agents', 'SELECT') then
    raise exception 'echo_app cannot read/write record_on_agents — the column shipped without a grant';
  end if;
end
$check$;

commit;
