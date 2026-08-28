-- 0114 — the reply the assistant writes, and the button only a person presses.
--
-- The product this lands: an incoming email is read, a reply is DRAFTED, and
-- the draft waits — in the thread and in the person's own mailbox — until
-- they press send. Nothing here sends anything.
--
-- ── Why a table of its own rather than a fourth proposal kind ────────────
-- The repo already has two proposal machines (M4's `agent_run.steps` and
-- M41's `workflow_step_output`), and both assume a CALL: `WriteProposal.call_id`
-- is non-optional and `proposal_decision`'s composite FKs hang off the call
-- the decision is about. A reply to an email is about a message in someone's
-- mailbox — there is no call, and inventing a null-call decision would put a
-- row into `proposal_decision` that its own read policy (which follows the
-- call) could not return to the person who made it. That failure has been
-- had once already (95_workflow_writes' NULL-call decision, invisible to its
-- own decider). A draft is its own artifact with its own lifecycle, so it
-- gets its own table and its own wall.
--
-- ── The wall is the GRANT, not a prompt ─────────────────────────────────
-- `echo_agent` may INSERT a draft and may never UPDATE one. `status` only
-- ever moves off 'pending' on `echo_app`, which is to say: through an api
-- call made by a signed-in person. The agent physically cannot mark a draft
-- sent, so "the assistant will not send email on its own" is a fact about
-- the database rather than a sentence in a system prompt (invariant 3).
--
-- ── Owner-only, like the step outputs it resembles ──────────────────────
-- A draft quotes the person's mail. W16's argument applies unchanged: not
-- even an admin reads it. Admins govern the workflow; they do not read the
-- correspondence it touches.
--
-- ── The poller's two columns ────────────────────────────────────────────
-- `mail_cursor` / `polled_at` on connector_connection are what make
-- "when an email arrives" a trigger rather than a promise. The claim below
-- is 0111's shape and 0111's reason: the due-predicate under the row lock IS
-- the compare-and-set, so nothing round-trips through JavaScript to be
-- truncated on the way back.

begin;

-- ─── the drafts ─────────────────────────────────────────────────────────
create table echo.mail_draft (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references echo.org(id),
  owner_id     uuid not null references echo.app_user(id),
  provider     text not null check (provider in ('google', 'microsoft')),
  -- the provider's own ids for the message being answered; REFERENCES, not
  -- content (W9), so a purge of the mailbox side leaves nothing dangling
  source_ref   text not null check (char_length(source_ref) between 1 and 200),
  thread_ref   text check (thread_ref is null or char_length(thread_ref) <= 200),
  to_address   text not null check (char_length(to_address) between 3 and 320),
  subject      text not null check (char_length(subject) <= 500),
  body         text not null check (char_length(body) between 1 and 20000),
  status       text not null default 'pending'
               check (status in ('pending', 'sent', 'discarded')),
  -- set once the provider has it: a draft in their real mailbox
  provider_draft_id text check (provider_draft_id is null or char_length(provider_draft_id) <= 200),
  -- the conversation it was written in, so the thread can show it again on
  -- reload; SET NULL because the draft outlives a purged conversation
  session_id   uuid references echo.agent_session(id) on delete set null,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references echo.app_user(id),

  constraint mail_draft_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  -- one draft per incoming message per person: a poller that sees the same
  -- mail twice must not produce a second reply to it (the engine's
  -- run_trigger_once, applied to the artifact instead of the run)
  constraint mail_draft_one_per_source unique (owner_id, provider, source_ref),
  -- a decided draft names who decided and when, or neither
  constraint mail_draft_decided_together
    check ((status = 'pending') = (decided_at is null and decided_by is null))
);

comment on table echo.mail_draft is
  'A reply the assistant wrote and nobody has sent. Owner-only. echo_agent may insert and may not update: the send is a person''s act, enforced by the grant rather than by instruction.';

create index mail_draft_owner_idx
  on echo.mail_draft (owner_id, status, created_at desc);
create index mail_draft_session_idx
  on echo.mail_draft (session_id) where session_id is not null;

alter table echo.mail_draft enable row level security;
alter table echo.mail_draft force row level security;

-- OWNER ONLY, both roles. The agent's policy is the same predicate; its
-- ceiling is the missing UPDATE grant below, not a narrower policy — one
-- sentence about who may see a draft, in one place.
create policy mail_draft_own on echo.mail_draft for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());

create policy mail_draft_agent on echo.mail_draft for all to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());

grant select, insert, update on echo.mail_draft to echo_app;
-- THE WALL: no update. The agent writes a draft; only a person decides it.
grant select, insert         on echo.mail_draft to echo_agent;

-- ─── the mailbox poller's cursor ────────────────────────────────────────
alter table echo.connector_connection
  add column mail_cursor text
    check (mail_cursor is null or char_length(mail_cursor) <= 200),
  add column polled_at timestamptz;

comment on column echo.connector_connection.mail_cursor is
  'The newest provider message already seen by the poller. Absent means "we have not looked yet" — the first poll establishes the mark and produces no drafts, so enabling a workflow never answers a backlog.';

-- Connections whose mailbox is due a look. Definer because the worker must
-- see every owner's connection and RLS deliberately shows it none of them;
-- the select list is the wall — no token, no label, nothing but the ids the
-- worker needs to resolve the owner and read as them.
create or replace function echo.due_mail_polls(p_limit int default 20)
returns table (connection_id uuid, owner_id uuid, org_id uuid, provider text)
language sql
security definer
set search_path = ''
stable
as $$
  select c.id, c.owner_id, c.org_id, c.provider
    from echo.connector_connection c
    join echo.app_user u on u.id = c.owner_id and u.status = 'active'
   where c.status = 'connected'
     and (c.polled_at is null or c.polled_at < now() - interval '2 minutes')
     and exists (
       select 1 from echo.workflow w
        where w.org_id = c.org_id
          and w.enabled
          and w.trigger_event = 'email.received'
          and w.current_version_id is not null)
   order by c.polled_at asc nulls first
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

comment on function echo.due_mail_polls(int) is
  'M43 (D8-enumerated): connections whose mailbox is due a look. Returns ids only. The EXISTS is the off-switch — with no enabled email workflow in the org, nobody''s mail is read at all.';

-- 0111's shape: the due-predicate under the row lock IS the compare-and-set,
-- so two workers cannot both claim one connection and no token round-trips.
create or replace function echo.claim_mail_poll(p_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection c
     set polled_at = now()
   where c.id = p_id
     and c.status = 'connected'
     and (c.polled_at is null or c.polled_at < now() - interval '2 minutes')
  returning true
$$;

comment on function echo.claim_mail_poll(uuid) is
  'M43 (D8-enumerated): exactly-once mailbox poll. 0111''s lesson applied on arrival — the predicate is the CAS, nothing is echoed through the worker.';

-- The cursor advances only for the connection just polled, and only forward
-- in the caller's intent: the worker passes the newest id it actually saw.
create or replace function echo.set_mail_cursor(p_id uuid, p_cursor text)
returns void
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection c
     set mail_cursor = p_cursor
   where c.id = p_id
$$;

comment on function echo.set_mail_cursor(uuid, text) is
  'M43 (D8-enumerated): records the newest message the poller has seen for one connection.';

revoke all on function echo.due_mail_polls(int) from public;
revoke all on function echo.claim_mail_poll(uuid) from public;
revoke all on function echo.set_mail_cursor(uuid, text) from public;
grant execute on function echo.due_mail_polls(int) to echo_app;
grant execute on function echo.claim_mail_poll(uuid) to echo_app;
grant execute on function echo.set_mail_cursor(uuid, text) to echo_app;

commit;
