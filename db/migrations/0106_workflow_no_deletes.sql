-- 0106 — the workflow tables rejoin the no-DELETE invariant.
--
-- Caught by the suite's own negative-space check within minutes of 0104
-- landing (50_identity_search_gateway: "core/'s own role holds no DELETE on
-- any product table — only echo_purge does"). 0104 granted DELETE to
-- echo_app on workflow_mute, workflow_auto_apply and workflow_schedule for
-- "revocable decisions", and that was the wrong shape twice over:
--
--  1. it broke a standing wall — the product role deleting ANY row is a
--     class the whole schema forbids, and an exception "just for
--     preferences" is how the class gets a second member;
--  2. the house pattern for revocable decisions already exists and is
--     BETTER: 0101's role_capability keeps rows and flips a flag, "so that
--     turning something back on is visible in the audit trail". A deleted
--     row is a decision that unhappened; a flipped row is a decision that
--     was reversed, by someone, at a time.
--
-- So: flags, not deletes. workflow_auto_apply's columns also rename to
-- decided_by/decided_at — "enabled_by" becomes a lie the first time the row
-- records a disable, and W17's whole point is that the row names the human
-- whose standing decision it carries, in either direction. (0104 landed
-- hours ago and nothing consumes these columns yet — the rename is free
-- now and a wire break later.)

begin;

-- ─── the invariant, restored ────────────────────────────────────────────
revoke delete on echo.workflow_mute       from echo_app;
revoke delete on echo.workflow_auto_apply from echo_app;
revoke delete on echo.workflow_schedule   from echo_app;

-- ─── mute: a flag, not a vanishing row ──────────────────────────────────
alter table echo.workflow_mute
  add column muted      boolean     not null default true,
  add column updated_at timestamptz not null default now();

grant update (muted, updated_at) on echo.workflow_mute to echo_app;

comment on table echo.workflow_mute is
  'W24: the org enables a workflow; the subject silences it for themselves. muted=false is an unmute that stayed visible — rows are never deleted (the 0101 pattern).';

-- ─── the standing decision: both directions, one named human ────────────
alter table echo.workflow_auto_apply rename column enabled_by to decided_by;
alter table echo.workflow_auto_apply rename column enabled_at to decided_at;
alter table echo.workflow_auto_apply
  add column allowed boolean not null default true;

-- the constraint name still says "enabler"; re-speak it in current terms
alter table echo.workflow_auto_apply
  rename constraint auto_apply_enabler_same_org to auto_apply_decider_same_org;

-- turning a standing decision off is an UPDATE by an admin, stamped with
-- the human who made THIS decision — decided_by must move with every flip,
-- and must be the actor (the 0029 not-supplyable rule, again)
drop policy workflow_auto_apply_delete on echo.workflow_auto_apply;
create policy workflow_auto_apply_update on echo.workflow_auto_apply for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_is_admin() and decided_by = echo.actor_id());

grant update (allowed, decided_by, decided_at) on echo.workflow_auto_apply to echo_app;

-- the insert policy's stamped-name column renamed with the column
drop policy workflow_auto_apply_insert on echo.workflow_auto_apply;
create policy workflow_auto_apply_insert on echo.workflow_auto_apply for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_is_admin() and decided_by = echo.actor_id());

comment on table echo.workflow_auto_apply is
  'W13/W17: auto-apply is a STANDING HUMAN DECISION — the row names the person and the moment, in EITHER direction (allowed true/false). Absent or allowed=false = every write waits for a live human. Rows are never deleted.';

-- ─── schedules: enabled=false IS the removal ────────────────────────────
comment on table echo.workflow_schedule is
  'M41 cadence → runs. Removing a schedule is enabled=false — visible, reversible, and no DELETE exists to reach for. The run executes as the schedule''s OWNER regardless of who manages the row.';

commit;
