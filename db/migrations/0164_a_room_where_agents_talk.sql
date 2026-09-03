-- 0164 — a room where agents talk, to you and to each other
--
-- User directive, 2026-09-03: "i dont want them to come to the AI assistant
-- like a window or options anymore, remove these; instead when they [are]
-- called they need to feel alive and chat separate from the ai assistant
-- itself, and they can talk to each other, the agents together, and work
-- things out ... we are building something like buzz but much more capable."
--
-- WHY THIS IS NOT `agent_session`. The assistant's conversation (0016) has
-- exactly two voices — a person and the assistant — encoded in
-- `agent_message_role` and relied on everywhere that reads a thread. A room
-- has N voices, two of which may be machines answering each other, and the
-- interesting message is one agent replying to another with neither addressed
-- to the person. Widening the assistant's enum to carry that would make every
-- existing reader handle a case it has no idea what to do with, and would put
-- the agents back inside the assistant — the exact thing being undone.
--
-- So: its own tables, and the assistant's are untouched.
--
-- ── THE WALL, and it is the whole reason this is a migration ─────────────
--
-- `author_kind` is pinned by the WRITING ROLE, exactly as `meeting_item.source`
-- is (0160) and `mail_draft` is (0114):
--
--   echo_app   may write author_kind = 'user'  and never 'agent'
--   echo_agent may write author_kind = 'agent' and never 'user'
--
-- So "رؤیا said this" is a fact about which database role inserted the row,
-- not a flag somebody set. A screen that renders an agent's name beside a
-- message is only worth having if the caller could not have chosen it — and a
-- room whose whole point is machines talking is exactly where a forged
-- attribution would matter most.
--
-- echo_agent gets INSERT and nothing else. It cannot edit or remove a message,
-- its own or a person's: the authority runs one way, which is the same
-- sentence 0160 wrote about meeting items and the reason mail drafts wait for
-- a hand.
--
-- ── WHO IS IN THE ROOM ───────────────────────────────────────────────────
-- Membership is a row rather than a column, because "which agents are in this
-- conversation" changes mid-conversation — inviting a second agent to look at
-- something is the product — and because a text[] cannot carry when somebody
-- joined. It cascades with the room: a membership without its room is not
-- history, it is litter (0122's sentence).
--
-- ── TURN, and why the COUNT lives here ───────────────────────────────────
-- Agents answering each other is a loop that has to stop. `turn` is the
-- position in the exchange and `reply_to_id` is what a message answers, so the
-- depth of an agent→agent chain is a FACT IN THE DATA rather than a counter
-- held in a worker's memory: a run that dies mid-exchange cannot lose count
-- and start again from zero, and a person reading the room can see how far a
-- conversation ran on its own. The ceiling itself is core's (it knows what a
-- model costs); what the schema owes is a number nobody has to reconstruct.

begin;

create table echo.agent_room (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  owner_id    uuid not null,
  title       text not null check (length(trim(title)) between 1 and 200),
  /* the subject a room is about, when it came from one — a meeting, a call,
     a task. Nullable and deliberately NOT a foreign key to any one of them:
     a room about a meeting and a room about nothing are the same shape, and
     three nullable FKs would be three ways to say "this is what we are
     discussing". core resolves it; the room only records it. */
  subject_kind text check (subject_kind in ('meeting', 'call', 'task')),
  subject_id   uuid,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint agent_room_owner_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  /* both halves or neither: a subject_id with no kind is a pointer into an
     unnamed table, and a kind with no id is a claim with nothing behind it */
  constraint agent_room_subject_whole
    check ((subject_kind is null) = (subject_id is null))
);

/* the composite target every child hangs off — a plain FK plus an org column
   lets a child claim another organisation's room, and rule 11 says reach for
   a constraint rather than a policy predicate that runs as the caller */
alter table echo.agent_room add constraint agent_room_id_org_key unique (id, org_id);

create index agent_room_owner_idx on echo.agent_room (org_id, owner_id, updated_at desc)
  where archived_at is null;

comment on table echo.agent_room is
  '0164: a conversation with more than two voices — a person and the agents they called in. Separate from echo.agent_session (the assistant''s own thread, which has exactly two) because a room''s interesting message is one agent answering another.';

create table echo.agent_room_member (
  room_id    uuid not null,
  agent_id   uuid not null references echo.assistant_agent(id) on delete cascade,
  org_id     uuid not null references echo.org(id),
  joined_at  timestamptz not null default now(),
  primary key (room_id, agent_id),
  constraint agent_room_member_same_org
    foreign key (room_id, org_id) references echo.agent_room (id, org_id) on delete cascade
);

comment on table echo.agent_room_member is
  '0164: which agents are in a room. A row and not a column on the room, because agents are invited mid-conversation and a text[] cannot carry when.';

create table echo.agent_room_message (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null,
  org_id      uuid not null references echo.org(id),
  /* WHO SPOKE, and the pair is exclusive: exactly one author column is set,
     and which one is decided by the role that inserted the row (see the
     policies). A message with both or neither is not a message anyone can
     attribute. */
  author_kind text not null check (author_kind in ('user', 'agent')),
  author_user_id  uuid,
  author_agent_id uuid references echo.assistant_agent(id),
  body        text not null check (length(body) between 1 and 20000),
  /* the exchange's own position, and what this answers. See the header: the
     depth of an agent-to-agent chain is a fact in the data. */
  turn        integer not null default 0 check (turn >= 0),
  reply_to_id uuid references echo.agent_room_message(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint agent_room_message_same_org
    foreign key (room_id, org_id) references echo.agent_room (id, org_id) on delete cascade,
  constraint agent_room_message_author_user_org
    foreign key (author_user_id, org_id) references echo.app_user (id, org_id),
  constraint agent_room_message_author_matches_kind check (
    (author_kind = 'user'  and author_user_id  is not null and author_agent_id is null) or
    (author_kind = 'agent' and author_agent_id is not null and author_user_id  is null)
  )
);

create index agent_room_message_room_idx
  on echo.agent_room_message (room_id, created_at);

comment on table echo.agent_room_message is
  '0164: one turn in a room. author_kind is pinned by the writing ROLE — echo_app writes ''user'' and can never write ''agent'', echo_agent the reverse — so a name beside a message is a fact about the database rather than a flag a caller chose.';

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table echo.agent_room         enable row level security;
alter table echo.agent_room         force  row level security;
alter table echo.agent_room_member  enable row level security;
alter table echo.agent_room_member  force  row level security;
alter table echo.agent_room_message enable row level security;
alter table echo.agent_room_message force  row level security;

/* A ROOM IS ITS OWNER'S. Not org-shared: the agents in it are reading that
   person's records under that person's authority (the agent borrows the
   caller's authority and never more), so a colleague reading the room would
   be reading answers drawn from records they may not be able to see. Sharing,
   if it is ever wanted, is a deliberate act with a row of its own — the
   assistant's own share flag is the precedent, and it arrived later for the
   same reason. */
create policy agent_room_read on echo.agent_room
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id());
create policy agent_room_insert on echo.agent_room
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());
create policy agent_room_update on echo.agent_room
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and owner_id = echo.actor_id());

/* the agent reads the room it is answering in — it cannot see rooms it is not
   a member of, which is what stops one room's context leaking into another */
create policy agent_room_agent_read on echo.agent_room
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id()
         and exists (select 1 from echo.agent_room_member m where m.room_id = id));

create policy agent_room_member_rw on echo.agent_room_member
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy agent_room_member_agent_read on echo.agent_room_member
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy agent_room_message_read on echo.agent_room_message
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
/* THE PIN, app side: this role writes a PERSON's turn and cannot write a
   machine's, and the author is the actor rather than anybody they name */
create policy agent_room_message_insert on echo.agent_room_message
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and author_kind = 'user' and author_user_id = echo.actor_id());

create policy agent_room_message_agent_read on echo.agent_room_message
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
/* THE PIN, agent side: 'agent' and never 'user'. INSERT only — no update, no
   delete policy exists and no grant is given, so an agent cannot revise or
   remove a turn, its own or a person's. */
create policy agent_room_message_agent_insert on echo.agent_room_message
  for insert to echo_agent
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and author_kind = 'agent');

grant select, insert, update on echo.agent_room         to echo_app;
grant select, insert, delete on echo.agent_room_member  to echo_app;
grant select, insert         on echo.agent_room_message to echo_app;
grant select                 on echo.agent_room         to echo_agent;
grant select                 on echo.agent_room_member  to echo_agent;
grant select, insert         on echo.agent_room_message to echo_agent;

-- ── self-checks ──────────────────────────────────────────────────────────
do $$
declare
  v_org  uuid;
  v_p    uuid := gen_random_uuid();
  v_ag   uuid;
  v_room uuid;
begin
  insert into echo.org (name, locale) values ('probe-0164', 'fa') returning id into v_org;
  insert into auth.users (id, email) values (v_p, 'probe-0164@example.test')
    on conflict (id) do nothing;
  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (v_p, v_org, 'probe-0164@example.test', 'probe', 'owner', 'active');
  select id into v_ag from echo.assistant_agent where handle = 'roya';
  if v_ag is null then
    raise exception 'CHECK FAILED: 0163 should have seeded roya before this runs';
  end if;

  perform set_config('echo.actor_id', v_p::text, true);
  insert into echo.agent_room (org_id, owner_id, title)
    values (v_org, v_p, 'probe room') returning id into v_room;
  insert into echo.agent_room_member (room_id, agent_id, org_id)
    values (v_room, v_ag, v_org);

  -- an author must be exactly one of the two, and the constraint says so
  begin
    insert into echo.agent_room_message (room_id, org_id, author_kind, author_user_id, author_agent_id, body)
    values (v_room, v_org, 'user', v_p, v_ag, 'both authors');
    raise exception 'CHECK FAILED: a message claimed both a person and an agent';
  exception when check_violation then null;
  end;
  begin
    insert into echo.agent_room_message (room_id, org_id, author_kind, body)
    values (v_room, v_org, 'agent', 'no author at all');
    raise exception 'CHECK FAILED: a message claimed an agent and named none';
  exception when check_violation then null;
  end;

  -- a subject is both halves or neither
  begin
    insert into echo.agent_room (org_id, owner_id, title, subject_kind)
      values (v_org, v_p, 'half a subject', 'meeting');
    raise exception 'CHECK FAILED: a room named a subject kind with no id';
  exception when check_violation then null;
  end;

  -- the ordinary path is the product: a person speaks, and an agent answers
  insert into echo.agent_room_message (room_id, org_id, author_kind, author_user_id, body, turn)
    values (v_room, v_org, 'user', v_p, 'سلام', 0);
  insert into echo.agent_room_message (room_id, org_id, author_kind, author_agent_id, body, turn)
    values (v_room, v_org, 'agent', v_ag, 'سلام، در خدمتم.', 1);
  if (select count(*) from echo.agent_room_message where room_id = v_room) <> 2 then
    raise exception 'CHECK FAILED: the ordinary exchange did not land';
  end if;

  -- THE WALL, stated as grants rather than inferred from policies
  if has_table_privilege('echo_agent', 'echo.agent_room_message', 'update')
     or has_table_privilege('echo_agent', 'echo.agent_room_message', 'delete') then
    raise exception 'CHECK FAILED: the agent can revise or remove a turn';
  end if;
  if has_table_privilege('echo_agent', 'echo.agent_room', 'insert')
     or has_table_privilege('echo_agent', 'echo.agent_room_member', 'insert') then
    raise exception 'CHECK FAILED: the agent can open a room or invite itself';
  end if;

  raise notice '0164 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;

commit;
