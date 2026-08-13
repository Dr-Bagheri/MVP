-- Echo — 0028: the human half of the audit trail, named honestly, and the
-- approval line that makes a double-confirm structurally impossible.
--
-- Origin: "record proposal approvals in agent_run.steps" met 0011's "a
-- finished agent run is closed" and lost. That is the invariant working. An
-- agent run records what the AGENT did; a human's decision to allow it is not
-- something the agent did, and writing it into a closed run would have meant
-- reopening runs for every approval — trading a replayability invariant for a
-- storage convenience.
--
-- So approvals live on the human-action surface, whose properties were always
-- right — append-only by grant and by trigger, any active member inserts their
-- own line, admin-only read — and whose NAME was always too narrow. A member
-- approving a correction on their own call is not performing an admin action.
-- A name that lies about its scope invites exactly one bug: someone reads
-- `admin_action`, concludes members have no audit surface, and builds a second
-- one.

alter table echo.admin_action rename to human_action;

-- Policies, grants and the immutability trigger follow the table; only the
-- names lag, so bring them along rather than leaving a trail of the old one.
alter index echo.admin_action_org_idx    rename to human_action_org_idx;
alter index echo.admin_action_target_idx rename to human_action_target_idx;
alter policy admin_action_read   on echo.human_action rename to human_action_read;
alter policy admin_action_insert on echo.human_action rename to human_action_insert;
alter trigger admin_action_immutable on echo.human_action rename to human_action_immutable;

comment on table echo.human_action is
  'The human half of the audit trail; echo.agent_run is the agent half. Append-only: no role holds DELETE or UPDATE on it.';

-- ---------------------------------------------------------------------------
-- The approval line.
--
-- M4: the agent proposes before writing anything it inferred rather than was
-- told. The approval is the human's record of allowing it, so it carries the
-- run it belongs to, the proposal it answers, and — stamped, never supplied —
-- who allowed it.
--
-- agent_run_id is ON DELETE SET NULL for the reason 0018 established: the
-- purge job deletes call-linked runs, and a foreign key with no action would
-- stop the purge dead on a call somebody had approved something on. The
-- approval outlives the run, with its link cut and its proposal identity
-- intact — the audit log outlives what it describes.
-- ---------------------------------------------------------------------------

alter table echo.human_action
  add column agent_run_id uuid references echo.agent_run(id) on delete set null,
  add column proposal_id  uuid;

-- An approval must say which proposal it answers. It need not still know the
-- run: that link is cut by the purge, and losing it must not invalidate the
-- record of the decision.
alter table echo.human_action
  add constraint human_action_approval_shape
  check (action <> 'proposal_approved' or proposal_id is not null);

-- ---------------------------------------------------------------------------
-- Replay refusal, as a constraint rather than a state machine.
--
-- A second confirm of the same proposal is one INSERT and one 23505. There is
-- no "decided" flag to read, no window between checking and writing, and
-- nothing for two concurrent confirms to race over — the second loses at the
-- index. The api maps the violation to 409 and that is the whole mechanism.
-- ---------------------------------------------------------------------------

create unique index human_action_proposal_once
  on echo.human_action (proposal_id)
  where action = 'proposal_approved';

comment on index echo.human_action_proposal_once is
  'One approval per proposal. A double-confirm is a 23505, not a race — the api maps it to 409.';

-- The actor is stamped, not supplied, exactly as deletion and acceptance are:
-- an audit line that lets its writer choose whose name is on it is not an
-- audit line. The insert policy already requires actor_id = actor_id(), which
-- refuses a forged line; this makes the honest case impossible to get wrong.
create function echo.tg_human_action_stamp() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.actor_id := coalesce(echo.actor_id(), new.actor_id);
  new.created_at := now();
  return new;
end;
$$;

create trigger human_action_stamp
  before insert on echo.human_action
  for each row execute function echo.tg_human_action_stamp();
