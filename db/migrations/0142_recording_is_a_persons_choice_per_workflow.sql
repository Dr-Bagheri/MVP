-- 0142 — "start a recording when I run this workflow" moves to the person,
--        and 0141's column is dropped.
--
-- ── 0141 put it in the wrong place, found before it shipped ─────────────
-- The switch went onto `echo.workflow`, the org's own engine workflows. It
-- would have been inert: an engine workflow runs from a TRIGGER, in the
-- worker, and nothing on a person's screen ever starts one. The flag had no
-- reader — a producer with no consumer, which is the defect this repo has
-- spent the week removing, written by the person removing it.
--
-- Where a workflow actually runs with a microphone present is the
-- assistant, and what the assistant runs is a TEMPLATE
-- (`resolveWorkflow` reads `echo.workflow_template`). So the flag has to be
-- reachable from a template slug.
--
-- ── but it cannot live on the template either ──────────────────────────
-- `echo.workflow_template` has no `org_id`: it is platform configuration,
-- one row shared by every organization on the deployment. A boolean there
-- would be one customer switching on recording for all of them. That is not
-- a scoping detail to fix later; it is the reason the column cannot go
-- there at all.
--
-- ── so it belongs to the PERSON, which is also what it means ───────────
-- "Start a recording when I run this" is a statement about how somebody
-- works, not about the workflow. Two people can reasonably want opposite
-- answers for the same template, and neither is configuring the other.
--
-- It is the same shape `auto_draft_replies` and `auto_meeting_prep` already
-- have on this table — per-person switches for per-person behaviour — with
-- a set of slugs instead of one boolean, because the choice is per
-- workflow.
--
-- Slugs rather than ids: a template is identified by its slug everywhere a
-- person meets it (the URL, the picker, the assistant's `workflow`
-- parameter), and an id here would need a join to answer a question the
-- surface asks by name.

begin;

drop view if exists echo.workflow_manage;   -- none today; defensive
alter table echo.workflow drop column if exists starts_recording;

alter table echo.app_user
  add column if not exists record_on_workflows text[] not null default '{}';

comment on column echo.app_user.record_on_workflows is
  'M41/0142: template slugs this person wants a recording started for when THEY run the workflow from their own surface. Per-person because that is what the choice is — two people may want opposite answers for one template. Read by a client that has a microphone; a scheduled run records nothing, because nobody is there.';

-- the grant, because a policy governs who may write and a GRANT decides
-- whether the write is possible at all (0134, learned the hard way)
grant update (record_on_workflows) on echo.app_user to echo_app;

do $check$
begin
  if not has_column_privilege('echo_app', 'echo.app_user', 'record_on_workflows', 'UPDATE') then
    raise exception 'echo_app cannot UPDATE record_on_workflows — the column shipped without a grant';
  end if;
  if not has_column_privilege('echo_app', 'echo.app_user', 'record_on_workflows', 'SELECT') then
    raise exception 'echo_app cannot SELECT record_on_workflows';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'echo' and table_name = 'workflow'
       and column_name = 'starts_recording'
  ) then
    raise exception '0141 column survived the drop';
  end if;
end
$check$;

commit;
