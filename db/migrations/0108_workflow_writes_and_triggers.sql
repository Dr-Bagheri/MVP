-- 0108 — M41 P3+P4: the write path's walls, and the trigger machinery.
--
-- ── The apply grants (P3) ───────────────────────────────────────────────
-- The workflow proposal kinds v1 are add_tags and set_title, both on
-- echo.call — and echo_agent holds NOTHING on that table's columns today
-- (0014 granted transcript/speaker/summary writes for the SPEC's three
-- proposal kinds). M4's rule: a CONFIRMED write runs on the agent role —
-- approval widens content, never the grant — so the agent role gains
-- exactly the two columns, with an OWNER-ONLY update policy: the agent
-- borrows the caller's authority and never more, and a workflow's apply
-- acts on the run owner's own call.
--
-- ── via_standing (W17, amended at the wall) ─────────────────────────────
-- The design doc said an auto-applied decision is "stamped decided_by =
-- the human who enabled the standing rule". The wall disagrees, and the
-- wall wins: 0029's stamp trigger forces decided_by := actor_id() —
-- STAMPED, NOT SUPPLIED — and relaxing that to let the executor write an
-- admin's name would open the exact forgery surface the stamp exists to
-- close. So the decision row records the RUN'S OWNER (whose authority the
-- run borrows) plus via_standing = true, and the HUMAN who authorized it
-- is named by the standing rule row itself (workflow_auto_apply.decided_by)
-- — one hop away, on an admin-only-writable row, with no way to fake it.
--
-- ── The doors (P3 sweep + P4 schedules; D8: enumerated, with reasons) ───
-- All three are cross-owner metadata operations the worker performs
-- between jobs; none returns content. The runs themselves always execute
-- under the owner's identity via the queue.

begin;

-- ─── P4: the event trigger lives on the workflow row ────────────────────
alter table echo.workflow
  add column trigger_event text
    check (trigger_event is null or trigger_event in ('call.summarized'));

comment on column echo.workflow.trigger_event is
  'M41 L1: when set (and the workflow is enabled+published), the pipeline enqueues a run for this fact, owned by the CALL''S owner (W1). Null = manual/signal/schedule only.';

-- ─── P3: the agent role''s two columns on echo.call ──────────────────────
grant update (tags, title) on echo.call to echo_agent;

create policy call_agent_apply on echo.call for update to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());

-- ─── W17's marker on the decision row (additive; stamp untouched) ───────
alter table echo.proposal_decision
  add column via_standing boolean not null default false;

comment on column echo.proposal_decision.via_standing is
  'M41/W17: true when the decision was minted by a standing auto-apply rule rather than a live hand. decided_by is then the RUN owner (stamped, as always); the authorizing HUMAN is workflow_auto_apply.decided_by — one hop, no forgery surface.';

-- ─── the doors ──────────────────────────────────────────────────────────

/*
 * Which waiting runs need attention? Two verdicts:
 *   resume  — a decision has arrived for one of the run's proposals (the
 *             push path enqueued this already; the sweep is the belt for a
 *             crash in the gap — "a residual is a visible reconcilable
 *             line, never a stuck run")
 *   expired — nobody answered before the deadline. "A question nobody
 *             answered is an answer", and the run says so rather than
 *             waiting silently forever.
 * step_id is the PARKED step (its ledger row is still 'running'), which is
 * exactly where the resume message must re-enter. Metadata only.
 */
create or replace function echo.due_workflow_waits()
returns table (run_id uuid, owner_id uuid, org_id uuid, step_id text, verdict text)
language sql
security definer
set search_path = ''
stable
as $$
  select r.id, r.owner_id, r.org_id,
         (select s.step_id from echo.workflow_step_run s
           where s.run_id = r.id and s.status = 'running'
           order by s.started_at desc limit 1),
         case when r.wait_deadline is not null and r.wait_deadline < now()
              then 'expired' else 'resume' end
    from echo.workflow_run r
   where r.status = 'waiting'
     and (
       (r.wait_deadline is not null and r.wait_deadline < now())
       or (r.waiting_on = 'decision' and exists (
             select 1 from echo.workflow_step_run sr
             join echo.proposal_decision pd on pd.proposal_id = sr.id
            where sr.run_id = r.id))
       or (r.waiting_on = 'until' and r.wait_until is not null and r.wait_until < now())
     )
$$;

comment on function echo.due_workflow_waits() is
  'M41 P3 (D8-enumerated): the wait sweep — cross-owner METADATA (ids and a verdict). The push path is fast; this is correct. Runs resume/expire under their owner''s identity via the queue.';

/* which schedules are due — ids and cadence facts, nothing else */
create or replace function echo.due_workflow_schedules()
returns table (id uuid, workflow_id uuid, owner_id uuid, org_id uuid, next_due timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select s.id, s.workflow_id, s.owner_id, s.org_id, s.next_due
    from echo.workflow_schedule s
   where s.enabled and s.next_due <= now()
$$;

comment on function echo.due_workflow_schedules() is
  'M41 P4 (D8-enumerated): due schedules, metadata only. The firing itself is claimed by claim_workflow_fire and executed as the schedule''s owner via the queue.';

/*
 * Compare-and-set: two worker passes cannot double-fire one schedule. The
 * next_due advances by its own cadence FROM ITSELF (alignment survives a
 * late tick), floored at now() so a long-dead schedule fires once on
 * revival rather than replaying every missed occurrence.
 */
create or replace function echo.claim_workflow_fire(p_id uuid, p_expected timestamptz)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.workflow_schedule s
     set last_fired_at = now(),
         next_due = greatest(
           s.next_due + case s.cadence
             when 'daily' then interval '1 day'
             when 'weekly' then interval '7 days'
             else interval '1 month' end,
           now())
   where s.id = p_id and s.next_due = p_expected and s.enabled
  returning true
$$;

comment on function echo.claim_workflow_fire(uuid, timestamptz) is
  'M41 P4 (D8-enumerated): the CAS that makes a schedule fire exactly once per due moment across any number of worker passes.';

revoke all on function echo.due_workflow_waits() from public;
revoke all on function echo.due_workflow_schedules() from public;
revoke all on function echo.claim_workflow_fire(uuid, timestamptz) from public;
grant execute on function echo.due_workflow_waits() to echo_app;
grant execute on function echo.due_workflow_schedules() to echo_app;
grant execute on function echo.claim_workflow_fire(uuid, timestamptz) to echo_app;

commit;
