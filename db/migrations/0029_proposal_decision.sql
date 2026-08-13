-- Echo — 0029: the decision gets its own table, and admin_action gets its name
-- back.
--
-- 0028 moved approvals onto the human-action surface and renamed it, because
-- "a member approving a correction on their own call is not an admin action"
-- made the name a lie. Backend 1 converged on the same ontology with a better
-- mechanism: give decisions their own table, and admin_action's name becomes
-- TRUE again — it holds only genuinely-admin actions. The rename solved a
-- problem that this table stops creating. So 0028's rename is reversed and its
-- approval columns removed; append-only migrations mean undoing is a new file,
-- not an edit, which is the trade we accepted for never disagreeing about our
-- own shape.
--
-- What survives from 0028: the stamped actor. An audit line whose writer picks
-- the name on it is not an audit line, and that was never specific to
-- approvals.

alter table echo.human_action rename to admin_action;
alter index echo.human_action_org_idx    rename to admin_action_org_idx;
alter index echo.human_action_target_idx rename to admin_action_target_idx;
alter policy human_action_read   on echo.admin_action rename to admin_action_read;
alter policy human_action_insert on echo.admin_action rename to admin_action_insert;
alter trigger human_action_immutable on echo.admin_action rename to admin_action_immutable;
alter trigger human_action_stamp     on echo.admin_action rename to admin_action_stamp;

drop index echo.human_action_proposal_once;
alter table echo.admin_action drop constraint human_action_approval_shape;
alter table echo.admin_action drop column agent_run_id;
alter table echo.admin_action drop column proposal_id;

comment on table echo.admin_action is
  'Genuinely-admin actions: deletions, acceptances, role changes. A person''s decision about an agent proposal is echo.proposal_decision.';

-- ---------------------------------------------------------------------------
-- echo.proposal_decision
--
-- M4: the agent proposes before writing anything it inferred rather than was
-- told. `agent_run` records what the AGENT did; a person's decision about that
-- proposal is a different event that references it — which is why it could
-- never live in `agent_run.steps` without reopening a closed run (0011), and
-- why it reads better as its own noun than as a kind of admin action.
--
-- A rejection is a decision worth exactly as much record as an approval: the
-- interesting audit question is "was this ever put to someone, and what did
-- they say", and an approval-only table answers it with silence for every
-- refusal.
-- ---------------------------------------------------------------------------

create type echo.decision as enum ('approve', 'reject');

create table echo.proposal_decision (
  -- The primary key IS the replay refusal. A second decision on the same
  -- proposal is one INSERT and one 23505 — no "decided" flag to read, no
  -- window between reading it and writing, nothing for two concurrent confirms
  -- to race over. The api maps the violation to 409 and that is the entire
  -- mechanism. One decision per proposal, final either way; a fresh proposal
  -- gets a fresh id.
  proposal_id uuid primary key,

  org_id      uuid not null references echo.org(id),
  -- Both links are severable. The purge deletes call-linked agent runs and the
  -- calls themselves (M11), and a plain foreign key here would stop it dead on
  -- any call somebody had decided something on — 0018's lesson, which this
  -- table would otherwise have reintroduced. The decision outlives what it
  -- refers to, with its links cut: it contains no call content, only that
  -- someone was asked and answered.
  run_id      uuid references echo.agent_run(id) on delete set null,
  call_id     uuid,

  -- What was proposed — the agent's three write tools (SPEC): correcting a
  -- transcript line, editing the speaker roster, replacing a summary. Text
  -- rather than an enum: the vocabulary is core/'s, and a fourth kind should
  -- not need a migration to name itself.
  kind        text not null check (length(btrim(kind)) > 0),
  decision    echo.decision not null,

  decided_by  uuid not null references echo.app_user(id),
  decided_at  timestamptz not null default now(),

  -- D9: same-org by construction. ON DELETE SET NULL names only call_id
  -- (PG15+) because org_id is NOT NULL and a whole-row SET NULL would fail.
  constraint proposal_decision_call_same_org
    foreign key (call_id, org_id) references echo.call (id, org_id)
    on delete set null (call_id),
  constraint proposal_decision_decider_same_org
    foreign key (decided_by, org_id) references echo.app_user (id, org_id)
);

create index proposal_decision_call_idx on echo.proposal_decision (call_id)
  where call_id is not null;
create index proposal_decision_run_idx  on echo.proposal_decision (run_id)
  where run_id is not null;
create index proposal_decision_org_idx  on echo.proposal_decision (org_id, decided_at desc);

-- Stamped, not supplied.
create function echo.tg_proposal_decision_stamp() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.decided_by := coalesce(echo.actor_id(), new.decided_by);
  new.decided_at := now();
  return new;
end;
$$;

create trigger proposal_decision_stamp
  before insert on echo.proposal_decision
  for each row execute function echo.tg_proposal_decision_stamp();

-- Append-only, in both layers: the trigger refuses an UPDATE outright, and
-- 0014's pattern means no role is granted one either.
create trigger proposal_decision_immutable
  before update on echo.proposal_decision
  for each row execute function echo.tg_reject_update();

alter table echo.proposal_decision enable row level security;
alter table echo.proposal_decision force  row level security;

-- Only the decider records their own decision.
create policy proposal_decision_decide on echo.proposal_decision for insert to echo_app
  with check (
    org_id = echo.actor_org_id()
    and decided_by = echo.actor_id()
    and echo.actor_is_active()
  );

-- Read follows the call: a decision about a call is part of that call's story,
-- so whoever may open the call may see what was decided on it. Admins see the
-- org's decisions regardless — including those whose call has since been
-- purged, which is the audit case and the only way a link-cut row stays
-- reachable at all.
create policy proposal_decision_read on echo.proposal_decision for select to echo_app
  using (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (echo.actor_is_admin() or (call_id is not null and echo.can_read_call(call_id)))
  );

grant select, insert on echo.proposal_decision to echo_app;

-- Deliberately no grant for echo_agent. The agent proposes; it does not decide,
-- and it does not get to read whether it was refused. If a run needs to know
-- that something was already rejected, core/ tells it — the agent reading the
-- human's verdict directly is the shape that turns a decision into a prompt.

comment on table echo.proposal_decision is
  'A person''s decision on an agent proposal. agent_run records what the agent did; this is a different event that references it.';
