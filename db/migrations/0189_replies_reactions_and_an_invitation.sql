-- 0189 — a reply, a reaction, and an invitation somebody accepts
--
-- User directive, 2026-09-04: "for each message that has been sent there must
-- be a possible right click to do the reply and reaction emoji as well. Also
-- the admins had to have this option to add all members and other admins to
-- the room, but it will go to their platform as a notification and if they
-- accept they will join. Actually do the same notification if they are
-- invited for an online meeting as well."
--
-- ── WHAT AN INVITATION IS HERE, SAID PLAINLY ──────────────────────────────
--
-- It grants NOTHING. Both walls it appears to move are already open: 0184
-- made every channel readable by every active member of the org, and 0145 did
-- the same for meetings. So a person invited to a room could already open it,
-- and a person invited to a meeting could already join it.
--
-- That is not a reason to skip the feature — it is the reason to describe it
-- correctly. What an invitation does is ATTENTION and a ONE-PRESS WAY IN: it
-- says somebody wants you there, it survives a reload (a toast does not), and
-- accepting puts the room in your own sidebar and takes you to it. Slack's
-- "you were added to #x" is exactly this and it is worth having.
--
-- The failure this avoids is the one where an invitation implies a permission
-- it never carried: an "accept" that reads like unlocking a door which was
-- never locked teaches people a wrong model of who can see what — and the day
-- private channels arrive, that wrong model is the one they will be
-- reasoning with.
--
-- ── WHO MAY INVITE, AND WHY THE POLICY SAYS BOTH ──────────────────────────
--
-- Rooms: ADMINS ONLY, which is the directive's own words and matches 0186's
-- ruling that handing work — or a room — to somebody is a thing a role does.
-- Meetings: ANY active member, because arranging a meeting is not an
-- administrative act and the person booking it is the one who knows who
-- should be in it.
--
-- Two rules in one policy rather than two tables: they are the same row with
-- the same lifecycle, and splitting them would give the notification bell two
-- lists to merge. The predicate says the difference out loud
-- (`kind = 'meeting' or actor_is_admin()`), so nobody has to remember it.
--
-- ── AND THE REPLY'S FOREIGN KEY ───────────────────────────────────────────
--
-- `on delete set null (reply_to_id)` — column-specific, which is 0188's
-- lesson applied on the day after it cost a migration. A composite FK's
-- cascade action applies to the WHOLE key, so a plain `set null` on
-- `(reply_to_id, org_id)` would try to null `org_id` too and could only ever
-- raise.

begin;

-- ── a message can answer another ─────────────────────────────────────────
alter table echo.chat_message
  add column reply_to_id uuid,
  add constraint chat_message_reply_fk
    foreign key (reply_to_id, org_id) references echo.chat_message (id, org_id)
    on delete set null (reply_to_id);

create index chat_message_replies on echo.chat_message (reply_to_id)
  where reply_to_id is not null;

comment on column echo.chat_message.reply_to_id is
  'The message this one answers (0189). ONE LEVEL by use, not by constraint: the client quotes the parent inline rather than opening a thread, so a reply to a reply quotes that reply and nothing recurses on screen.';

-- ── and somebody can react to it ─────────────────────────────────────────
create table echo.chat_reaction (
  message_id uuid not null,
  user_id    uuid not null,
  /* the emoji itself, not a code name. A closed set would need a migration
     every time somebody wants a different one, and the alternative failure —
     a reaction nobody can render — cannot happen: whatever a person picked
     from their own keyboard renders on their own screen. Up to 16 characters
     because a single emoji can be a ZWJ sequence of five. */
  emoji      text not null check (length(emoji) between 1 and 16),
  org_id     uuid not null references echo.org(id),
  created_at timestamptz not null default now(),
  /* one person, one of each emoji, on one message — pressing twice is
     removing, and the primary key is what makes that true rather than a
     check somebody writes in the api */
  primary key (message_id, user_id, emoji),
  constraint chat_reaction_message
    foreign key (message_id, org_id) references echo.chat_message (id, org_id) on delete cascade,
  constraint chat_reaction_person
    foreign key (user_id, org_id) references echo.app_user (id, org_id)
);

create index chat_reaction_message_idx on echo.chat_reaction (message_id);

comment on table echo.chat_reaction is
  'Reactions on a chat message (0189). The emoji is stored as itself; the PK makes a second press a removal.';

-- ── an invitation somebody answers ───────────────────────────────────────
create table echo.join_invite (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  /* WHAT they are being invited to. Two kinds in one table because they have
     one lifecycle and one inbox; a third would join them here rather than
     become a third list the bell has to merge. */
  kind        text not null check (kind in ('chat_channel', 'meeting')),
  /* deliberately NOT a foreign key: it points at one of two tables depending
     on `kind`, and a polymorphic FK cannot be written. The consequence is
     stated rather than discovered — an invite can outlive its target, so
     every read resolves the target and an unresolvable one is DROPPED from
     the list rather than rendered as an invitation to nothing. */
  target_id   uuid not null,
  invitee_id  uuid not null,
  invited_by  uuid not null,
  state       text not null default 'pending'
              check (state in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  responded_at timestamptz,
  constraint join_invite_invitee
    foreign key (invitee_id, org_id) references echo.app_user (id, org_id),
  constraint join_invite_author
    foreign key (invited_by, org_id) references echo.app_user (id, org_id),
  /* ONE live invitation per person per thing. Inviting somebody twice is not
     two notifications, it is the same one — and without this, "add all
     members" pressed twice fills a bell with duplicates of itself. */
  unique (kind, target_id, invitee_id)
);

create index join_invite_inbox on echo.join_invite (invitee_id, state, created_at desc);

comment on table echo.join_invite is
  'An invitation to a room or a meeting (0189). It grants NOTHING — both are already readable org-wide — it carries attention and a one-press way in. See the migration header before adding a permission to it.';

-- ── the wall ─────────────────────────────────────────────────────────────
alter table echo.chat_reaction enable row level security;
alter table echo.chat_reaction force row level security;
alter table echo.join_invite   enable row level security;
alter table echo.join_invite   force row level security;

create policy chat_reaction_read on echo.chat_reaction
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

/* YOUR OWN REACTION, both ways. Adding one under somebody else's name is
   putting an opinion in their mouth, and it is unrepresentable rather than
   forbidden because the policy names the actor on both sides. */
create policy chat_reaction_write on echo.chat_reaction
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and user_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and user_id = echo.actor_id());

/* THE INVITEE AND THE INVITER SEE IT, and nobody else — an invitation is
   addressed to one person, and a colleague reading the org's invitations
   would learn who is being pulled into what. Admins are NOT added: this is
   the one place in the product where "an admin can see everything" would
   turn a courtesy into surveillance. */
create policy join_invite_read on echo.join_invite
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (invitee_id = echo.actor_id() or invited_by = echo.actor_id()));

/*
 * ROOMS ARE AN ADMIN'S TO FILL; A MEETING IS ANYBODY'S TO ARRANGE.
 *
 * The two halves of the directive, written as the condition that makes each
 * true rather than as two tables or a rule in a route. `invited_by =
 * actor_id()` for the same reason every other author column in this schema
 * carries it: a fact about who did something must not be supplyable.
 */
create policy join_invite_insert on echo.join_invite
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and invited_by = echo.actor_id()
              and (kind = 'meeting' or echo.actor_is_admin()));

/* ONLY THE INVITEE ANSWERS. Not the inviter, not an admin: an invitation
   accepted on somebody's behalf is a membership they never agreed to, which
   is the entire thing this table exists to avoid. */
create policy join_invite_respond on echo.join_invite
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and invitee_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and invitee_id = echo.actor_id());

/* withdrawing an invitation is the INVITER's — a person who invited somebody
   by mistake must be able to take it back, and the invitee's own "no" is the
   `declined` state rather than a delete (a record that says nothing happened
   and a record that says they said no are different facts) */
create policy join_invite_withdraw on echo.join_invite
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and invited_by = echo.actor_id());

grant select, insert, update, delete on echo.chat_reaction to echo_app;
grant select on echo.chat_reaction to echo_agent;
grant select, insert, update, delete on echo.join_invite to echo_app;

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v int;
begin
  /* the agent may READ a reaction and never leave one — an agent with an
     opinion about a colleague's message is a thing nobody asked for */
  if has_table_privilege('echo_agent', 'echo.chat_reaction', 'insert')
     or has_table_privilege('echo_agent', 'echo.chat_reaction', 'delete') then
    raise exception 'CHECK FAILED: the agent may react';
  end if;

  /* and it cannot see invitations AT ALL — not a grant, not a policy. An
     invitation is between two people. */
  if has_table_privilege('echo_agent', 'echo.join_invite', 'select') then
    raise exception 'CHECK FAILED: the agent can read invitations';
  end if;

  -- a grant is not a policy (0178), for the table the agent DOES read
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and tablename = 'chat_reaction'
       and 'echo_agent' = any(roles)) then
    raise exception 'CHECK FAILED: the agent may SELECT chat_reaction with no policy admitting it';
  end if;

  -- RLS enabled AND forced on both
  select count(*) into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relkind = 'r'
     and c.relname in ('chat_reaction', 'join_invite')
     and not (c.relrowsecurity and c.relforcerowsecurity);
  if v > 0 then
    raise exception 'CHECK FAILED: RLS is not enabled AND forced on % new table(s)', v;
  end if;

  /* THE ROOM/MEETING SPLIT IS IN THE POLICY, read from the catalogue rather
     than trusted from the CREATE above — a policy recreated without the
     admin half is the edit this check exists for, and it would make every
     member an inviter to every room */
  if not exists (
    select 1 from pg_policies
     where schemaname = 'echo' and policyname = 'join_invite_insert'
       and with_check like '%actor_is_admin%'
       and with_check like '%meeting%') then
    raise exception 'CHECK FAILED: the invite policy no longer distinguishes a room from a meeting';
  end if;

  /* 0188's lesson, asserted rather than remembered: the self-reference must
     null ONE column. A whole-key SET NULL on a key holding org_id can only
     ever raise, and it reads exactly like this one. */
  if not exists (
    select 1 from pg_constraint
     where conname = 'chat_message_reply_fk'
       and pg_get_constraintdef(oid) like '%SET NULL (reply_to_id)%') then
    raise exception 'CHECK FAILED: the reply FK does not name the single column it nulls';
  end if;
end $chk$;

commit;
