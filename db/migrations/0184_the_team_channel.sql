-- 0184 — the team channel
--
-- User directive, 2026-09-04: "add a chat room section in the menu for all
-- members to join and a place that they can talk to each other, create a new
-- page for it … so everyone can be added and chat there even the agents."
--
-- ── WHY THIS IS NOT THE ROOM 0166 DELETED ─────────────────────────────────
--
-- db/0164 built `agent_room` / `agent_room_member` / `agent_room_message` and
-- db/0166 dropped all three the next day, on the user's own directive: "the
-- whole platform should be their room." The recorded reasoning was that a
-- room for talking to AGENTS is a second inbox — somebody who wants رؤیا's
-- help is already in a conversation with the assistant, on the page the
-- question is about.
--
-- That argument does not forbid this table; it CONSTRAINS it. What justifies
-- a channel is the thing the assistant thread structurally cannot do:
-- `echo.owns_agent_session` binds a session to ONE person, so two colleagues
-- cannot talk to each other there at all. This is a room for the humans, and
-- the agents are guests in it.
--
-- The constraint it inherits, and the ruling that comes with this migration:
-- **in a channel, the router's `default` rung is SILENCE.** An agent answers
-- when it is named and never otherwise. With three colleagues in the room an
-- ambient trigger means three answers to every message, and the feature is
-- unusable by its second day.
--
-- ── THE ORDERING AXIS ─────────────────────────────────────────────────────
--
-- `seq bigint generated always as identity`, not `created_at`. Our ids are
-- random uuids and carry no order, and two messages can share a timestamp to
-- the microsecond — Discord abandoned created_at as a cursor for exactly that
-- reason. Every unread question in this schema is a comparison against `seq`,
-- which is why there is no unread COUNT anywhere: a count is a number that
-- must be maintained, and a maintained count is the second writable copy this
-- repo keeps refusing.
--
-- ── WHO WROTE IT IS A FACT ABOUT THE DATABASE ROLE ────────────────────────
--
-- Carried forward verbatim from 0164, which got this right: `author_kind` is
-- pinned by the WRITING ROLE. `echo_app` may write 'user' and never 'agent';
-- `echo_agent` may write 'agent' and never 'user'. So "رؤیا said this" is a
-- fact about which role inserted the row rather than a flag somebody set, and
-- an agent impersonating a colleague is unrepresentable rather than forbidden.
-- `echo_agent` gets INSERT and nothing else — it cannot edit or remove a
-- message, its own or a person's.
--
-- ── WHAT IS DELIBERATELY ABSENT, AND WHERE TO PUT IT ──────────────────────
--
-- · PRIVATE CHANNELS. Every active member reads every channel, which is the
--   directive's own words ("for all members to join"). Membership here is the
--   sidebar and the read cursor, never the wall. Privacy arrives as a
--   `visibility` column plus a policy that reads it — and note it cannot be
--   an EXISTS into the membership table (D9/rule 11: a subquery in a policy
--   runs as the caller and silently intersects with that table's policies).
--   The membership table is org-readable precisely so that a future policy
--   can compose without that intersection.
-- · THREADS. No `root_id`. The research recommended shipping the column now
--   so threading is later a UI change rather than a migration — declined,
--   because a column nothing reads is the defect this repo has found four
--   times, and one ALTER TABLE is cheaper than a year of a column that means
--   nothing. The depth rule (a reply's root must itself be a root) is
--   expressible as structure and should land WITH the feature.
-- · REACTIONS, PINS, EDIT HISTORY, TYPING RECEIPTS, READ RECEIPTS. None are
--   reachable from the directive.

begin;

create table echo.chat_channel (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  name        text not null check (length(trim(name)) between 1 and 80),
  /* one line under the name — what this room is for */
  topic       text not null default '' check (length(topic) <= 200),
  /* 0181 promised this link out loud ("its conversation is a channel carrying
     project_id") and the table did not exist yet. Honoured here. */
  project_id  uuid,
  archived_at timestamptz,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  constraint chat_channel_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  constraint chat_channel_project
    foreign key (project_id, org_id) references echo.project (id, org_id) on delete cascade,
  unique (id, org_id)
);

/* one channel per project, and only one — the channel IS the project's
   conversation, so a second would split it in two places */
create unique index chat_channel_project_uniq on echo.chat_channel (project_id)
  where project_id is not null;
create unique index chat_channel_name_uniq
  on echo.chat_channel (org_id, lower(name)) where archived_at is null;

comment on table echo.chat_channel is
  'Team channels (0184). Every active member of the org reads every channel; membership is the sidebar and the read cursor, not the wall.';

create table echo.chat_channel_member (
  channel_id    uuid not null,
  user_id       uuid not null,
  org_id        uuid not null references echo.org(id),
  /* THE CURSOR, and the only read state there is. Unread is the comparison
     `max(seq) in channel > last_read_seq` — free at any backlog size, correct
     through deletion and edits, and impossible to drift because nothing
     maintains it but the person's own acknowledgement. */
  last_read_seq bigint not null default 0,
  muted         boolean not null default false,
  joined_at     timestamptz not null default now(),
  primary key (channel_id, user_id),
  constraint chat_member_channel
    foreign key (channel_id, org_id) references echo.chat_channel (id, org_id) on delete cascade,
  constraint chat_member_person
    foreign key (user_id, org_id) references echo.app_user (id, org_id)
);

comment on column echo.chat_channel_member.last_read_seq is
  'How far this person has read (0184). Advanced with greatest() so a stale client can never move it backwards.';

create table echo.chat_message (
  id          uuid primary key default gen_random_uuid(),
  /* the ordering axis — see the header */
  seq         bigint generated always as identity,
  org_id      uuid not null references echo.org(id),
  channel_id  uuid not null,
  /* PINNED BY THE WRITING ROLE (0164's design, carried forward). The check
     pairs it with the author columns so neither can disagree with the other. */
  author_kind text not null check (author_kind in ('user', 'agent')),
  author_id   uuid,
  /* an agent's handle from core's own SHIPPED_NAMES — text, because the
     vocabulary belongs to core and a fk here would put product configuration
     in the schema */
  agent_handle text check (agent_handle is null or length(agent_handle) between 1 and 40),
  body        text not null check (length(body) between 1 and 20000),
  edited_at   timestamptz,
  /* SOFT, and deliberately still READABLE. A read policy that hides deleted
     rows makes the post-image of the delete invisible to its own author,
     which is precisely the 42501 that broke M11 for members for weeks. A
     deleted message stays in the room as a tombstone, which is also what
     every chat product does. */
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint chat_message_author_shape check (
    (author_kind = 'user'  and author_id is not null and agent_handle is null) or
    (author_kind = 'agent' and author_id is null     and agent_handle is not null)
  ),
  constraint chat_message_channel
    foreign key (channel_id, org_id) references echo.chat_channel (id, org_id) on delete cascade,
  constraint chat_message_author
    foreign key (author_id, org_id) references echo.app_user (id, org_id),
  unique (id, org_id)
);

create unique index chat_message_seq_uniq on echo.chat_message (seq);
create index chat_message_channel_seq on echo.chat_message (channel_id, seq desc);

comment on table echo.chat_message is
  'One message in a channel (0184). author_kind is pinned by the writing DB role: echo_app writes user rows, echo_agent writes agent rows, and neither can write the other.';

create table echo.chat_mention (
  message_id uuid not null,
  user_id    uuid not null,
  org_id     uuid not null references echo.org(id),
  /* DENORMALIZED from the message, and the one denormalization here that
     earns its place: the badge query is `count(*) where user_id = me and
     channel_id = $1 and seq > cursor` — index-only, exact by construction,
     and it never joins the message table. Both values are immutable on their
     source row (a message does not change channel and `seq` is generated), so
     this cannot drift the way a maintained counter does. */
  channel_id uuid not null,
  seq        bigint not null,
  primary key (message_id, user_id),
  constraint chat_mention_message
    foreign key (message_id, org_id) references echo.chat_message (id, org_id) on delete cascade,
  constraint chat_mention_person
    foreign key (user_id, org_id) references echo.app_user (id, org_id)
);

create index chat_mention_badge on echo.chat_mention (user_id, channel_id, seq);

comment on table echo.chat_mention is
  'Who was named in a message (0184). A row, not a counter: the badge is counted from these and is therefore exact through deletes, edits and mark-as-unread.';

-- The author shape refuses an agent row wearing a person's id, asserted by
-- ATTEMPTING it: a constraint nobody has tried is a constraint nobody knows
-- is armed. It runs HERE, before `force row level security`, and that is the
-- whole reason it is not down with the other checks — under FORCE the owner
-- is subject to policies too, so this insert would be refused by the wall
-- (42501) and the probe would report the wall rather than the constraint. A
-- check that can be satisfied by the wrong mechanism proves nothing.
do $shape$
begin
  insert into echo.chat_message (org_id, channel_id, author_kind, author_id, agent_handle, body)
  values (gen_random_uuid(), gen_random_uuid(), 'agent', gen_random_uuid(), 'echo', 'x');
  raise exception 'CHECK FAILED: an agent message accepted a person as its author';
exception
  when check_violation then null;   -- the shape constraint fired: correct
  when foreign_key_violation then
    raise exception 'CHECK FAILED: the FK fired before the shape check, so the shape check is unproven';
  when insufficient_privilege then
    raise exception 'CHECK FAILED: the wall answered before the constraint did — this probe has moved below the RLS statements and is now vacuous';
end $shape$;

-- ── the wall ─────────────────────────────────────────────────────────────
alter table echo.chat_channel        enable row level security;
alter table echo.chat_channel_member enable row level security;
alter table echo.chat_message        enable row level security;
alter table echo.chat_mention        enable row level security;
alter table echo.chat_channel        force row level security;
alter table echo.chat_channel_member force row level security;
alter table echo.chat_message        force row level security;
alter table echo.chat_mention        force row level security;

create policy chat_channel_read on echo.chat_channel
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy chat_channel_insert on echo.chat_channel
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

/* rename, re-topic, archive — any active member. A channel is the room the
   team is standing in, and asking an admin to rename it is the kind of
   ceremony that makes a room feel like somebody else's. */
create policy chat_channel_update on echo.chat_channel
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

/* ORG-READABLE membership, and that is a decision rather than an oversight:
   knowing WHO is in a room is a far weaker disclosure than its contents, and
   it is what lets a future privacy policy compose without an EXISTS that
   silently intersects with this table's own policies (D9). */
create policy chat_member_read on echo.chat_channel_member
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

/* a person joins, leaves and acknowledges FOR THEMSELVES. Nobody moves
   somebody else's read cursor. */
create policy chat_member_write on echo.chat_channel_member
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and user_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and user_id = echo.actor_id());

create policy chat_message_read on echo.chat_message
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy chat_message_insert on echo.chat_message
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and author_kind = 'user' and author_id = echo.actor_id());

/* THE AGENT'S ONLY WRITE. It may add a message as itself and may never add
   one as a person — the policy, not a prompt, is what makes that true. */
create policy chat_message_agent_insert on echo.chat_message
  for insert to echo_agent
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and author_kind = 'agent' and author_id is null);

/* edit and tombstone YOUR OWN. An admin may tombstone anybody's — moderation
   is a real need — and nobody may edit anybody else's words, which is the
   distinction that matters: removing a message and putting words in
   somebody's mouth are not the same power. */
create policy chat_message_update on echo.chat_message
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (author_id = echo.actor_id() or echo.actor_is_admin()))
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and (author_id = echo.actor_id() or echo.actor_is_admin()));

create policy chat_mention_read on echo.chat_mention
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy chat_mention_insert on echo.chat_mention
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

/* an agent naming a colleague is a real mention — the agent writes the row
   for the same reason it writes the message */
create policy chat_mention_agent_insert on echo.chat_mention
  for insert to echo_agent
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

-- NO DELETE on a message for anyone: it is tombstoned, like every other
-- record in this product. The membership row takes delete because leaving a
-- channel is not deleting anything of anybody's.
grant select, insert, update on echo.chat_channel        to echo_app;
grant select, insert, update, delete on echo.chat_channel_member to echo_app;
grant select, insert, update on echo.chat_message        to echo_app;
grant select, insert on echo.chat_mention                to echo_app;
grant select on echo.chat_channel        to echo_agent;
grant select on echo.chat_channel_member to echo_agent;
grant select, insert on echo.chat_message to echo_agent;
grant select, insert on echo.chat_mention to echo_agent;

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v int;
begin
  /* the agent writes messages and mentions and NOTHING else — no update, no
     delete, no channel of its own */
  if has_table_privilege('echo_agent', 'echo.chat_message', 'update')
     or has_table_privilege('echo_agent', 'echo.chat_message', 'delete')
     or has_table_privilege('echo_agent', 'echo.chat_channel', 'insert')
     or has_table_privilege('echo_agent', 'echo.chat_channel', 'update')
     or has_table_privilege('echo_agent', 'echo.chat_channel_member', 'insert') then
    raise exception 'CHECK FAILED: the agent may do more than speak';
  end if;

  /* nobody deletes a message */
  if has_table_privilege('echo_app', 'echo.chat_message', 'delete') then
    raise exception 'CHECK FAILED: a message can be deleted — it is tombstoned';
  end if;

  /* a grant is not a policy: every table the agent may SELECT admits it by
     name (the 0178 finding, asserted for four new tables on the day they
     were born rather than after a user reports a broken agent) */
  select count(*) into v
    from pg_class t join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'echo'
     and t.relname in ('chat_channel', 'chat_channel_member', 'chat_message', 'chat_mention')
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'echo' and p.tablename = t.relname
          and 'echo_agent' = any(p.roles));
  if v > 0 then
    raise exception 'CHECK FAILED: % chat table(s) the agent may SELECT have no policy admitting it', v;
  end if;

  /* RLS enabled AND forced on all four */
  select count(*) into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relkind = 'r'
     and c.relname in ('chat_channel', 'chat_channel_member', 'chat_message', 'chat_mention')
     and not (c.relrowsecurity and c.relforcerowsecurity);
  if v > 0 then
    raise exception 'CHECK FAILED: RLS is not enabled AND forced on % chat table(s)', v;
  end if;

end $chk$;

commit;
