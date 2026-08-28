-- 0122 — an agent becomes something a person assembles (M47).
--
-- User directive (2026-08-28, with Sana's agent editor as the reference):
-- an agent has a persona, knowledge, WORKFLOWS it carries, and visibility —
-- and when it is picked in the assistant, what it carries comes up with it.
--
-- ── agent_workflow: a membership row, not a record of events ─────────────
-- The same class as workflow_mute and call_note, and it takes their grant
-- shape: select/insert/delete on echo_app, no update (a membership is
-- present or absent; there is nothing to edit on it). Editing an agent's
-- set mirrors the agent's own write wall: user-level agents by their owner,
-- org-level agents by admins — the policies below restate 0065's pair
-- through the agent row, so the wall cannot drift from the thing it guards.
--
-- ── web: the agent's own search-the-web switch ───────────────────────────
-- The ask path already carries `web` per request (OpenRouter's :online on
-- the same model); this column is the agent-level default for it. A column
-- and not a tools[] entry, because tools name CALLABLE functions and web is
-- a property of the model call — one list holding both is how a vocabulary
-- grows a lie.

begin;

alter table echo.assistant_agent
  add column web boolean not null default false;

comment on column echo.assistant_agent.web is
  'M47: whether asks through this agent may search the web (:online on the same model). Off by default — an agent that searches the web unbidden spends someone''s money on a guess.';

create table echo.agent_workflow (
  agent_id     uuid not null references echo.assistant_agent(id) on delete cascade,
  workflow_id  uuid not null references echo.workflow(id) on delete cascade,
  org_id       uuid not null references echo.org(id),
  created_at   timestamptz not null default now(),
  primary key (agent_id, workflow_id)
);

comment on table echo.agent_workflow is
  'M47: which workflows an agent carries. A membership row — cascades away with either side, because a membership without its member is not history, it is litter.';

alter table echo.agent_workflow enable row level security;
alter table echo.agent_workflow force row level security;

-- read: whoever can read the agent (same shape as assistant_agent_read,
-- restated through the join so the two walls answer alike)
create policy agent_workflow_read on echo.agent_workflow for select to echo_app
  using (
    org_id = echo.actor_org_id()
    and exists (
      select 1 from echo.assistant_agent a
       where a.id = agent_id
         and echo.actor_is_active()
         and (a.level = 'system'
              or (a.org_id = echo.actor_org_id()
                  and (a.level = 'org' or a.user_id = echo.actor_id())))
    )
  );

-- write: whoever may write the agent — the EXISTS runs as the caller, so it
-- intersects with assistant_agent's own write policies; here that
-- intersection is exactly the rule wanted (the caller must be able to see
-- the agent as one they govern), not a hidden subtraction
create policy agent_workflow_write on echo.agent_workflow for all to echo_app
  using (
    org_id = echo.actor_org_id()
    and exists (
      select 1 from echo.assistant_agent a
       where a.id = agent_id
         and ((a.level = 'org' and a.org_id = echo.actor_org_id() and echo.actor_is_admin())
              or (a.level = 'user' and a.user_id = echo.actor_id() and echo.actor_is_active()))
    )
  )
  with check (
    org_id = echo.actor_org_id()
    and exists (
      select 1 from echo.assistant_agent a
       where a.id = agent_id
         and ((a.level = 'org' and a.org_id = echo.actor_org_id() and echo.actor_is_admin())
              or (a.level = 'user' and a.user_id = echo.actor_id() and echo.actor_is_active()))
    )
  );

grant select, insert, delete on echo.agent_workflow to echo_app;

commit;
