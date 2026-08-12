-- Echo — 0007: agents are configuration, and every run leaves a record.
--
-- M4: a skill is data — prompt + model + tool list — so what the agent knows
-- how to do changes without a deploy. Three levels, most specific wins:
-- system (shipped, the summarizer is one) < org (an admin sets it) < user.

create table echo.skill (
  id          uuid primary key default gen_random_uuid(),
  level       echo.skill_level not null,
  org_id      uuid references echo.org(id),
  user_id     uuid references echo.app_user(id),

  slug        text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),  -- invoked as /slug
  name        text not null check (length(btrim(name)) > 0),
  description text not null default '',
  prompt      text not null,
  -- NULL = use the caller's chosen model (M5: no default model is imposed).
  model       text,
  tools       jsonb not null default '[]',
  enabled     boolean not null default true,

  created_by  uuid references echo.app_user(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint skill_tools_is_array check (jsonb_typeof(tools) = 'array'),
  -- Each level owns exactly the columns that make sense for it.
  constraint skill_level_shape check (
    (level = 'system' and org_id is null     and user_id is null)
 or (level = 'org'    and org_id is not null and user_id is null)
 or (level = 'user'   and org_id is not null and user_id is not null)
  ),
  constraint skill_user_same_org
    foreign key (user_id, org_id) references echo.app_user (id, org_id)
);

create unique index skill_system_slug_key on echo.skill (slug)          where level = 'system';
create unique index skill_org_slug_key    on echo.skill (org_id, slug)  where level = 'org';
create unique index skill_user_slug_key   on echo.skill (user_id, slug) where level = 'user';
create index skill_org_idx on echo.skill (org_id) where enabled;

create trigger skill_set_updated_at
  before update on echo.skill
  for each row execute function echo.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- agent_run — invariant 5: agent runs are replayable, and invariant 3's audit
-- trail. One row per execution of the one agent runtime (M4), whether that
-- run was a user talking to the assistant or the pipeline's summarizer.
--
-- actor_id is never a service account: the summarizer runs as the call's
-- owner, the assistant as the asker (M3).
-- ---------------------------------------------------------------------------

create table echo.agent_run (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  actor_id    uuid not null references echo.app_user(id),
  call_id     uuid references echo.call(id),
  skill_id    uuid references echo.skill(id),

  kind        echo.agent_run_kind   not null,
  status      echo.agent_run_status not null default 'running',
  model       text not null,

  -- What went in: system prompt, tool list, the messages. Content enters
  -- quoted (M4) and is stored as it was sent, so a run can be replayed.
  request     jsonb not null default '{}',
  -- Every tool call and result, in order — the tool wrapper writes here.
  steps       jsonb not null default '[]',

  tokens_in   integer check (tokens_in  is null or tokens_in  >= 0),
  tokens_out  integer check (tokens_out is null or tokens_out >= 0),
  error       text,

  started_at  timestamptz not null default now(),
  finished_at timestamptz,

  constraint agent_run_actor_same_org
    foreign key (actor_id, org_id) references echo.app_user (id, org_id),
  constraint agent_run_call_same_org
    foreign key (call_id, org_id) references echo.call (id, org_id),
  constraint agent_run_steps_is_array check (jsonb_typeof(steps) = 'array'),
  constraint agent_run_finished_consistent
    check ((status = 'running') = (finished_at is null))
);

create index agent_run_org_actor_idx on echo.agent_run (org_id, actor_id, started_at desc);
create index agent_run_call_idx      on echo.agent_run (call_id) where call_id is not null;
create index agent_run_open_idx      on echo.agent_run (started_at) where status = 'running';

comment on table echo.agent_run is
  'Replayable record of one agent execution (invariant 5). Append-only: 0011 blocks rewriting what a run already did.';
