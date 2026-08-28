-- 0117 — the pre-read that arrives before the meeting.
--
-- The mail poller's twin, with one difference that changes the whole risk
-- picture: this output never leaves the building. A brief is written into a
-- conversation the person already owns, so there is no outward action to
-- gate and no grant to withhold — which is exactly why the brief may use the
-- assistant's READ tools over the org's own records while the mail draft
-- deliberately gets none. The blast radius decides the reach.
--
-- `meeting_prep` exists for one reason: to know a meeting has already been
-- prepared. Without a row, a poller firing every few minutes would write the
-- same pre-read into a new conversation each time, which is the mail
-- draft's duplicate problem wearing a calendar.
--
-- Switch is per person and OFF, for the same reason as 0115: a calendar is
-- not less personal than an inbox.

begin;

alter table echo.app_user
  add column auto_meeting_prep boolean not null default false;

comment on column echo.app_user.auto_meeting_prep is
  'The person''s own switch for "read my calendar and prepare me before meetings". DEFAULT FALSE.';

alter table echo.connector_connection
  add column calendar_polled_at timestamptz;

create table echo.meeting_prep (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references echo.org(id),
  owner_id     uuid not null references echo.app_user(id),
  provider     text not null check (provider in ('google', 'microsoft')),
  -- the provider's event id: a REFERENCE, never the event's content (W9)
  event_ref    text not null check (char_length(event_ref) between 1 and 200),
  event_title  text not null default '' check (char_length(event_title) <= 300),
  starts_at    timestamptz,
  session_id   uuid references echo.agent_session(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint meeting_prep_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  -- one pre-read per meeting per person: the poller runs every few minutes
  -- and the meeting does not move
  constraint meeting_prep_one_per_event unique (owner_id, provider, event_ref)
);

comment on table echo.meeting_prep is
  'A record that one meeting has already been prepared for one person. Exists to make the poller idempotent; the brief itself lives in the conversation it points at.';

create index meeting_prep_owner_idx on echo.meeting_prep (owner_id, created_at desc);

alter table echo.meeting_prep enable row level security;
alter table echo.meeting_prep force row level security;

create policy meeting_prep_own on echo.meeting_prep for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and owner_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and owner_id = echo.actor_id());

grant select, insert on echo.meeting_prep to echo_app;

-- ─── the calendar poller's doors ────────────────────────────────────────
create or replace function echo.due_meeting_polls(p_limit int default 20)
returns table (connection_id uuid, owner_id uuid, org_id uuid, provider text)
language sql
security definer
set search_path = ''
stable
as $$
  select c.id, c.owner_id, c.org_id, c.provider
    from echo.connector_connection c
    join echo.app_user u on u.id = c.owner_id
   where c.status = 'connected'
     and u.status = 'active'
     and u.auto_meeting_prep
     and (c.calendar_polled_at is null
          or c.calendar_polled_at < now() - interval '5 minutes')
   order by c.calendar_polled_at asc nulls first
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

comment on function echo.due_meeting_polls(int) is
  'M44 (D8-enumerated): connections whose calendar is due a look. Ids only. The owner''s own auto_meeting_prep is the off-switch.';

-- 0111's shape again: the due-predicate under the row lock IS the CAS.
create or replace function echo.claim_meeting_poll(p_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection c
     set calendar_polled_at = now()
   where c.id = p_id
     and c.status = 'connected'
     and (c.calendar_polled_at is null
          or c.calendar_polled_at < now() - interval '5 minutes')
  returning true
$$;

comment on function echo.claim_meeting_poll(uuid) is
  'M44 (D8-enumerated): exactly-once calendar poll.';

revoke all on function echo.due_meeting_polls(int) from public;
revoke all on function echo.claim_meeting_poll(uuid) from public;
grant execute on function echo.due_meeting_polls(int) to echo_app;
grant execute on function echo.claim_meeting_poll(uuid) to echo_app;

-- the fifth card kind (0107's find-by-definition pattern)
do $$
declare
  cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'echo.agent_card'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%post_call_brief%';
  if cname is null then
    raise exception 'agent_card kind constraint not found — 0074/0107/0116 drifted?';
  end if;
  execute format('alter table echo.agent_card drop constraint %I', cname);
  execute $ddl$
    alter table echo.agent_card
      add constraint agent_card_kind_check
      check (kind in ('post_call_brief', 'weekly_digest', 'workflow_result',
                      'mail_draft', 'meeting_prep'))
  $ddl$;
end;
$$;

commit;
