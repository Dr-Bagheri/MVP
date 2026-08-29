-- 0134 — an agent's workflow set becomes arrangeable, because the GRANT
--        behind its policy was never issued.
--
-- User report, 2026-08-29, with a screenshot: ticking a workflow on the
-- Meeting prep agent answers "Not saved — the list is unchanged".
--
-- ── what was actually happening ─────────────────────────────────────────
-- Reproduced by running the product's own statement as the real caller
-- (info@neurai.pt, owner of "neuari", `rolbypassrls = false` asserted
-- first), inside a rolled-back transaction:
--
--     insert into echo.agent_workflow (agent_id, workflow_id, org_id, enabled)
--     select $1, w.id, w.org_id, true from echo.workflow w where w.id = $2
--     on conflict (agent_id, workflow_id) do update set enabled = true
--
--     → 42501  permission denied for table agent_workflow
--
-- Note WHICH refusal that is. "Permission denied for TABLE" is the GRANT
-- half of the wall, not the policy half — a policy violation says "new row
-- violates row-level security policy". `echo.agent_workflow` carried
-- `echo_app=ar`: SELECT and INSERT, and no UPDATE at all, not even a
-- column-level one.
--
-- `ON CONFLICT DO UPDATE` requires the UPDATE privilege even when nothing
-- conflicts — the check is on the statement, not on the rows it turns out
-- to touch. So the attach path was refused on every call, and the detach
-- path (`update … set enabled = false`) was refused for the same reason.
-- The feature could never have worked: `echo.agent_workflow` holds zero
-- rows on this database, which is the whole history of the table agreeing.
--
-- ── why the policy is untouched ────────────────────────────────────────
-- 0122's policy, widened by 0124, is correct and was never reached. It
-- already says exactly the right thing: an org agent's arrangement is the
-- org admin's, a user agent's is its owner's, and a system agent's is
-- per-org and admin-governed. The wall is RLS *and* grants; this is the
-- second half, missing.
--
-- ── why the grant is column-scoped ─────────────────────────────────────
-- `enabled` is the only column either statement assigns: the attach flips
-- it true, the detach flips it false, and a membership row is never
-- otherwise rewritten (0122: detaching keeps the row so its `created_at`
-- stays a true fact about when the workflow joined the agent). A whole-
-- table UPDATE grant would also let a caller move `agent_id`, `workflow_id`
-- or `org_id` — re-pointing one org's membership row at another agent
-- inside the policy's own using-clause.
--
-- This is the pattern the neighbouring tables already use and is read from
-- them rather than invented: `workflow_mute` grants (muted, updated_at),
-- `workflow_auto_apply` grants (decided_by, decided_at, allowed),
-- `agent_card` grants (enabled). `agent_workflow` was the one that missed.

begin;

grant update (enabled) on echo.agent_workflow to echo_app;

comment on table echo.agent_workflow is
  'M47: which workflows an agent carries, per org. Write is UPDATE(enabled) only — attach and detach are both a flag flip, and the row survives a detach so created_at stays true. 0134 issued that grant; before it, 0122''s policy governed a table echo_app could not write at all.';

commit;
