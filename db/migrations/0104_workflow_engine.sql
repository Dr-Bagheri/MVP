-- 0104 — THE WORKFLOW ENGINE (M41; design of record:
-- docs/WORKFLOWS-AND-AGENTS.md v2, W1–W33 ratified by the user 2026-08-27).
--
-- P0 of six phases: the tables, the walls, and the queue. No executor yet —
-- the definer doors (due_workflow_schedules, due_workflow_waits,
-- claim_workflow_fire) deliberately do NOT land here, because a granted
-- function with no caller is rule 13½'s defect and the granted-vs-called
-- instrument would rightly flag it. Each door lands with its consumer
-- (P1/P4).
--
-- ============================ THE SHAPE ================================
--   workflow            the org's catalogue entry (name, handle, enabled)
--   workflow_version    an IMMUTABLE published program: graph + agent
--                       instruction snapshots + budget + max_autonomy
--   workflow_run        one execution, owned by the SUBJECT of the work
--   workflow_step_run   the ledger: one row per step attempt (metadata)
--   workflow_step_output  what the model produced — OWNER-ONLY (W16)
--   workflow_mute       the subject silences an org workflow for themselves
--   workflow_auto_apply the org's STANDING human decision per proposal kind
--   workflow_schedule   agent_rule generalized: cadence → runs
--
-- ====================== THE THREE LOAD-BEARING WALLS ===================
-- 1. W18 — a published version is immutable BY A MISSING GRANT. No app
--    role holds UPDATE or DELETE on workflow_version. Publish = insert;
--    edit = new version. "A decision enforced at a layer the write can be
--    routed around is a preference, not a rule" (D27) — so this one lives
--    where nothing routes around it.
-- 2. W16 — step outputs live in their OWN table behind an owner-only
--    policy. Run metadata (statuses, timings, costs, failure codes) is
--    owner+admin; the produce is derived from content and follows the
--    content walls. Column grants cannot vary by row, so the split is
--    structural — the tool_calls-codes-only pattern, one table further.
-- 3. W1 — every run row carries (owner_id, org_id) under a composite FK:
--    a cross-org run is unrepresentable, not merely refused (rule 11's
--    author-side corollary: structure, not predicates).
--
-- ======================= WHO READS THE GRAPH ===========================
-- workflow_version SELECT policy is ADMIN-ONLY, deliberately stricter than
-- the catalogue row: a graph carries step instructions and agent
-- instruction snapshots, and M30's posture is that instructions never
-- cross to members. Members read the CATALOGUE (workflow) to run things,
-- and their RUN's ledger to see what happened. The one future reader this
-- excludes is the P1 executor running AS a member-owner — that read
-- arrives WITH the executor (a run-scoped door or policy, enumerated with
-- its reason), not in advance of it.

begin;

-- ─── the catalogue ──────────────────────────────────────────────────────
create table echo.workflow (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references echo.org(id),
  handle              text not null check (handle ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name                text not null check (length(btrim(name)) > 0),
  description         text not null default '',
  icon                text not null default 'workflow',
  enabled             boolean not null default true,
  -- FK added below, after workflow_version exists
  current_version_id  uuid,
  created_by          uuid not null,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- the author is a real member of THIS org — and created_by is not
  -- supplyable as someone else (policy WITH CHECK re-asserts actor)
  constraint workflow_author_same_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  constraint workflow_handle_once unique (org_id, handle),
  -- target for workflow_version's composite FK
  constraint workflow_id_org_once unique (id, org_id)
);

create trigger workflow_set_updated_at
  before update on echo.workflow
  for each row execute function echo.tg_set_updated_at();

comment on table echo.workflow is
  'M41 catalogue entry. Members read it to run workflows; the program itself lives in workflow_version behind the admin wall.';

-- ─── the immutable program ──────────────────────────────────────────────
create table echo.workflow_version (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null,
  org_id        uuid not null,
  version       int  not null check (version > 0),
  -- the graph is validated by core at publish (the closed step vocabulary,
  -- typed edges, apply-behind-propose reachability). The database asserts
  -- shape and bound only: 256KB is a program, more is a payload.
  graph         jsonb not null check (jsonb_typeof(graph) = 'object'),
  -- W19: handle → snapshotted agent instructions. The version is the
  -- COMPLETE program, musicians' parts included — editing an agent affects
  -- future publishes, never a published version's meaning.
  agents        jsonb not null default '{}' check (jsonb_typeof(agents) = 'object'),
  max_autonomy  text not null default 'assist'
                check (max_autonomy in ('watch', 'assist', 'act')),
  budget        jsonb not null default '{}' check (jsonb_typeof(budget) = 'object'),
  published_by  uuid not null,
  published_at  timestamptz not null default now(),
  constraint workflow_version_once unique (workflow_id, version),
  constraint workflow_version_bounded check (pg_column_size(graph) <= 262144),
  constraint workflow_version_same_org
    foreign key (workflow_id, org_id) references echo.workflow (id, org_id),
  constraint workflow_version_publisher_same_org
    foreign key (published_by, org_id) references echo.app_user (id, org_id)
);

comment on table echo.workflow_version is
  'M41/W18: immutable once inserted — no app role holds UPDATE or DELETE. A run''s ledger is only meaningful while the program it ran stays readable.';

alter table echo.workflow
  add constraint workflow_current_version_fk
  foreign key (current_version_id) references echo.workflow_version(id);

-- ─── the run ────────────────────────────────────────────────────────────
create table echo.workflow_run (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references echo.org(id),
  -- W1: the SUBJECT of the work, never the workflow's author
  owner_id             uuid not null,
  workflow_id          uuid not null,
  workflow_version_id  uuid not null references echo.workflow_version(id),
  trigger_kind         text not null
                       check (trigger_kind in ('manual', 'event', 'schedule', 'signal')),
  trigger_ref          text check (trigger_ref is null or char_length(trigger_ref) <= 200),
  status               text not null default 'running' check (status in
                       ('running', 'waiting', 'done', 'failed', 'refused', 'cancelled', 'expired')),
  waiting_on           text check (waiting_on in ('decision', 'until', 'signal')),
  wait_until           timestamptz,
  wait_deadline        timestamptz,
  budget_spent         jsonb not null default '{}' check (jsonb_typeof(budget_spent) = 'object'),
  -- codes only, never content (the no-content-logs invariant, in a column)
  failure_code         text check (failure_code is null or char_length(failure_code) <= 60),
  started_at           timestamptz not null default now(),
  ended_at             timestamptz,
  constraint run_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  constraint run_workflow_same_org
    foreign key (workflow_id, org_id) references echo.workflow (id, org_id),
  -- rule 12: "waiting" must NAME its nothing; a terminal state has an end
  constraint run_waiting_named   check (status <> 'waiting' or waiting_on is not null),
  constraint run_ended_when_over check ((status in ('running', 'waiting')) = (ended_at is null))
);

-- W26: one LIVE run per fact — a redelivered event cannot double-run.
-- Partial on live statuses so a re-run after failure stays possible.
create unique index workflow_run_trigger_once
  on echo.workflow_run (workflow_id, owner_id, trigger_kind, trigger_ref)
  where trigger_ref is not null and status in ('running', 'waiting');

create index workflow_run_owner_idx
  on echo.workflow_run (owner_id, started_at desc);
create index workflow_run_org_idx
  on echo.workflow_run (org_id, started_at desc);

comment on table echo.workflow_run is
  'M41/W1: one execution, owned by the subject of the work. Metadata readable by owner+admins; the produce is workflow_step_output''s and the owner''s alone.';

-- ─── the ledger ─────────────────────────────────────────────────────────
create table echo.workflow_step_run (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  owner_id      uuid not null,
  run_id        uuid not null references echo.workflow_run(id) on delete cascade,
  step_id       text not null check (char_length(step_id) between 1 and 60),
  iteration     int  not null default 0 check (iteration >= 0),
  status        text not null default 'running' check (status in
                ('running', 'done', 'failed', 'skipped', 'refused')),
  -- the model call nests (W8); the link dies with a purged run, so cost is
  -- MATERIALIZED at completion (the 0046–0051 precedent, applied on
  -- arrival rather than retrofitted)
  agent_run_id  uuid references echo.agent_run(id) on delete set null,
  model_cost    jsonb check (model_cost is null or jsonb_typeof(model_cost) = 'object'),
  -- W9: REFERENCES, never content — ids of what the step read
  input_ref     jsonb not null default '{}' check (jsonb_typeof(input_ref) = 'object'),
  failure_code  text check (failure_code is null or char_length(failure_code) <= 60),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  -- W26: the idempotency floor — the same step attempt cannot exist twice;
  -- the worst redelivery outcome is wasted work, never a doubled effect
  constraint step_once unique (run_id, step_id, iteration),
  constraint step_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id)
);

create index workflow_step_run_run_idx on echo.workflow_step_run (run_id, started_at);

-- ─── the produce (W16: its own table, its own wall) ─────────────────────
create table echo.workflow_step_output (
  step_run_id  uuid primary key references echo.workflow_step_run(id) on delete cascade,
  org_id       uuid not null,
  owner_id     uuid not null,
  output       jsonb not null,
  constraint output_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id)
);

comment on table echo.workflow_step_output is
  'M41/W16: what the model produced — derived from content, so it follows the content walls. OWNER-ONLY; admins read the ledger, never the produce.';

-- ─── the subject's mute (W24) ───────────────────────────────────────────
create table echo.workflow_mute (
  workflow_id  uuid not null,
  owner_id     uuid not null,
  org_id       uuid not null,
  created_at   timestamptz not null default now(),
  primary key (workflow_id, owner_id),
  constraint mute_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  constraint mute_workflow_same_org
    foreign key (workflow_id, org_id) references echo.workflow (id, org_id)
);

comment on table echo.workflow_mute is
  'W24: the org enables a workflow; the subject can silence it for themselves. Org authority over org process, subject authority over their own noise.';

-- ─── the standing human decision (W17, shipped OFF by absence) ──────────
create table echo.workflow_auto_apply (
  org_id         uuid not null references echo.org(id),
  proposal_kind  text not null check (char_length(proposal_kind) between 3 and 60),
  enabled_by     uuid not null,
  enabled_at     timestamptz not null default now(),
  primary key (org_id, proposal_kind),
  constraint auto_apply_enabler_same_org
    foreign key (enabled_by, org_id) references echo.app_user (id, org_id)
);

comment on table echo.workflow_auto_apply is
  'W13/W17: auto-apply is a STANDING HUMAN DECISION — the row names the person and the moment. Absent = every write waits for a live human. The apply path stamps auto decisions with decided_by = enabled_by, so the ledger always points at a person.';

-- ─── schedules (agent_rule, generalized; doors arrive with P4) ──────────
create table echo.workflow_schedule (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  owner_id       uuid not null,
  workflow_id    uuid not null,
  cadence        text not null check (cadence in ('daily', 'weekly', 'monthly')),
  at_minute      int  not null default 480 check (at_minute between 0 and 1439),
  weekday        int  check (weekday between 0 and 6),
  next_due       timestamptz not null,
  last_fired_at  timestamptz,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint schedule_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  constraint schedule_workflow_same_org
    foreign key (workflow_id, org_id) references echo.workflow (id, org_id)
);

create index workflow_schedule_due_idx
  on echo.workflow_schedule (next_due) where enabled;

-- ─── RLS ────────────────────────────────────────────────────────────────
alter table echo.workflow             enable row level security;
alter table echo.workflow             force row level security;
alter table echo.workflow_version     enable row level security;
alter table echo.workflow_version     force row level security;
alter table echo.workflow_run         enable row level security;
alter table echo.workflow_run         force row level security;
alter table echo.workflow_step_run    enable row level security;
alter table echo.workflow_step_run    force row level security;
alter table echo.workflow_step_output enable row level security;
alter table echo.workflow_step_output force row level security;
alter table echo.workflow_mute        enable row level security;
alter table echo.workflow_mute        force row level security;
alter table echo.workflow_auto_apply  enable row level security;
alter table echo.workflow_auto_apply  force row level security;
alter table echo.workflow_schedule    enable row level security;
alter table echo.workflow_schedule    force row level security;

-- catalogue: any active member reads; admins write. created_by is stamped,
-- not supplied (the 0029 "a fact must not be supplyable" precedent).
create policy workflow_read on echo.workflow for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy workflow_insert on echo.workflow for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_is_admin() and created_by = echo.actor_id());
create policy workflow_update on echo.workflow for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active() and echo.actor_is_admin());

-- the program: ADMIN read (instructions never cross to members — header),
-- admin insert with the publisher stamped. No update/delete policy AND no
-- update/delete grant: two layers, deliberately.
create policy workflow_version_read on echo.workflow_version for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active() and echo.actor_is_admin());
create policy workflow_version_insert on echo.workflow_version for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_is_admin() and published_by = echo.actor_id());

-- runs: the owner sees theirs; admins see the org's (metadata — outputs
-- are the next table's business). Writes are the OWNER's: a run is
-- created and advanced as the subject, including by the P1 executor.
create policy workflow_run_read on echo.workflow_run for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (owner_id = echo.actor_id() or echo.actor_is_admin()));
create policy workflow_run_insert on echo.workflow_run for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());
create policy workflow_run_update on echo.workflow_run for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());
-- NOTE (W-matrix): admin CANCEL of a member's run is a P3 named operation
-- with its own reason — not a blanket admin UPDATE here, which would let
-- an admin rewrite budget_spent and failure_code on rows they don't own.

create policy workflow_step_run_read on echo.workflow_step_run for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (owner_id = echo.actor_id() or echo.actor_is_admin()));
create policy workflow_step_run_insert on echo.workflow_step_run for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());
create policy workflow_step_run_update on echo.workflow_step_run for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());

-- W16: the produce. OWNER ONLY, all verbs offered (select+insert; outputs
-- are written once — no update grant below).
create policy workflow_step_output_own on echo.workflow_step_output for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());

create policy workflow_mute_own on echo.workflow_mute for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());

-- standing decisions: everyone may KNOW what auto-applies; only admins
-- decide, and the decision names its decider (not supplyable).
create policy workflow_auto_apply_read on echo.workflow_auto_apply for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy workflow_auto_apply_insert on echo.workflow_auto_apply for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_is_admin() and enabled_by = echo.actor_id());
create policy workflow_auto_apply_delete on echo.workflow_auto_apply for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active() and echo.actor_is_admin());

-- schedules: the owner's, and admins may manage them for others
-- (workflows.manage's "schedules for others" — the run still executes as
-- the schedule's OWNER, so this delegates timing, never authority).
create policy workflow_schedule_all on echo.workflow_schedule for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (owner_id = echo.actor_id() or echo.actor_is_admin()))
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and (owner_id = echo.actor_id() or echo.actor_is_admin()));

-- ─── grants ─────────────────────────────────────────────────────────────
-- echo_app: the product role. NOTE what is absent: UPDATE/DELETE on
-- workflow_version (W18), UPDATE on workflow_step_output (written once),
-- DELETE everywhere except the two revocable-decision tables. echo_agent:
-- NOTHING — the runner reads as the owner on echo_app; the apply path uses
-- the existing proposal machinery. echo_purge gains these tables when the
-- purge job learns them (13½: a grant with no consumer is a defect).
grant select, insert, update           on echo.workflow             to echo_app;
grant select, insert                   on echo.workflow_version     to echo_app;
grant select, insert, update           on echo.workflow_run         to echo_app;
grant select, insert, update           on echo.workflow_step_run    to echo_app;
grant select, insert                   on echo.workflow_step_output to echo_app;
grant select, insert, delete           on echo.workflow_mute        to echo_app;
grant select, insert, delete           on echo.workflow_auto_apply  to echo_app;
grant select, insert, update, delete   on echo.workflow_schedule    to echo_app;

-- ─── the queue ──────────────────────────────────────────────────────────
-- One message advances exactly one step (W11). Guarded like 0090: pgmq
-- ships with Supabase, not stock Postgres. 0090's default privileges mean
-- the queue's tables arrive granted; 90_queues asserts it anyway.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'pgmq absent on this server — echo_workflow_step not created here';
    return;
  end if;
  if not exists (
    select 1 from pgmq.list_queues() where queue_name = 'echo_workflow_step'
  ) then
    perform pgmq.create('echo_workflow_step');
  end if;
end;
$$;

commit;
