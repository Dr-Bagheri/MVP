-- Echo — 0016: assistant persistence. "Sessions persist" (SPEC).
--
-- Kept apart from echo.agent_run on purpose. A run is the audit record of one
-- execution (invariant 5) and an admin can read the org's runs; a session is
-- a person's conversation with the assistant, and nobody else reads it — not
-- even an admin. Conflating them would have quietly made every private
-- conversation an admin surface.

create type echo.agent_message_role as enum ('user', 'assistant', 'tool');

create table echo.agent_session (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references echo.org(id),
  actor_id        uuid not null references echo.app_user(id),

  title           text not null default '',
  -- Which page the pane was opened on, and any calls the user mentioned to
  -- add as context. Identifiers only — never call content.
  context         jsonb not null default '{}',

  last_message_at timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint agent_session_id_org_key unique (id, org_id),
  constraint agent_session_actor_same_org
    foreign key (actor_id, org_id) references echo.app_user (id, org_id)
);

create index agent_session_actor_idx
  on echo.agent_session (actor_id, coalesce(last_message_at, created_at) desc)
  where archived_at is null;

create trigger agent_session_set_updated_at
  before update on echo.agent_session
  for each row execute function echo.tg_set_updated_at();

create table echo.agent_message (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references echo.agent_session(id),
  org_id       uuid not null references echo.org(id),

  seq          integer not null check (seq >= 0),
  role         echo.agent_message_role not null,
  content      text not null default '',
  -- Tool calls as they were shown streaming, and the run they belong to.
  tool_calls   jsonb not null default '[]',
  agent_run_id uuid references echo.agent_run(id),

  created_at   timestamptz not null default now(),

  constraint agent_message_session_seq_key unique (session_id, seq),
  constraint agent_message_same_org
    foreign key (session_id, org_id) references echo.agent_session (id, org_id),
  constraint agent_message_tool_calls_is_array check (jsonb_typeof(tool_calls) = 'array')
);

create index agent_message_session_idx on echo.agent_message (session_id, seq);

-- A session belongs to one person, and that is the whole access rule.
create function echo.owns_agent_session(target_session uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from echo.agent_session s
    where s.id = target_session
      and s.actor_id = echo.actor_id()
      and echo.actor_is_active()
  );
$$;

alter table echo.agent_session enable row level security;
alter table echo.agent_session force  row level security;
alter table echo.agent_message enable row level security;
alter table echo.agent_message force  row level security;

create policy agent_session_own on echo.agent_session for all to echo_app, echo_agent
  using      (actor_id = echo.actor_id() and echo.actor_is_active())
  with check (actor_id = echo.actor_id() and echo.actor_is_active()
              and org_id = echo.actor_org_id());

create policy agent_message_own on echo.agent_message for select to echo_app, echo_agent
  using (echo.owns_agent_session(session_id));
create policy agent_message_write on echo.agent_message for insert to echo_app
  with check (echo.owns_agent_session(session_id) and org_id = echo.actor_org_id());

grant select, insert, update on echo.agent_session to echo_app;
grant select, insert         on echo.agent_message to echo_app;

-- The agent may read the conversation it is part of; writing the transcript
-- of that conversation is core/'s job, not a tool call.
grant select on echo.agent_session, echo.agent_message to echo_agent;

comment on table echo.agent_session is
  'A person''s conversation with the assistant. Private to that person — admins read agent_run, not this.';
