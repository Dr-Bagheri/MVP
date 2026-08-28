-- 0123 — the membership becomes a flag, and the delete-grant list stays closed.
--
-- 0122 granted echo_app DELETE on agent_workflow, and the negative-space
-- guard (50_identity_search_gateway) went red within the hour — which is the
-- guard doing exactly what it was built for. D3's ruling stands: echo_purge
-- is the only application role that deletes product rows, with call_note's
-- author-delete as the single ruled exception. Widening a closed list for
-- convenience is how a closed list stops meaning anything.
--
-- The shape that needs no delete is already in this schema: workflow_mute
-- keeps its row and flips a flag. Detaching a workflow from an agent is the
-- same kind of statement — "not right now", by someone who may re-attach it
-- tomorrow — and the kept row preserves created_at, which is a fact about
-- when the workflow first joined the agent.

begin;

revoke delete on echo.agent_workflow from echo_app;

alter table echo.agent_workflow
  add column enabled boolean not null default true;

comment on column echo.agent_workflow.enabled is
  'M47: detach = enabled false, never a row delete — the workflow_mute shape, kept so echo_purge stays the only role that deletes product rows (D3).';

commit;
