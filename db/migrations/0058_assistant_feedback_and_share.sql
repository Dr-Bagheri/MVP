-- Echo — 0058: the assistant grows judgement and a share (M27).
--
-- Two new nouns for the Part-1 chat surface, both ABOUT a conversation and
-- deliberately not part of it:
--
--   * agent_message_feedback — the person's verdict on one assistant turn.
--     A row about a message, never a message: it can never render in the
--     thread as something somebody said (the annotation-not-bubble rule at
--     schema altitude). The note is CONTENT (it quotes the answer it judges)
--     and inherits every content rule — never in logs, never agent-readable.
--
--   * agent_session_share — the owner's decision to let their org read one
--     conversation. Org-scoped by construction: no public links, because a
--     public link is an unauthenticated read of org content and invariant 2
--     refuses that shape. Revocation is a stamp, not a delete (echo_app has
--     no DELETE anywhere — the house rule).
--
-- Cross-member reads go through DEFINER DOORS, not policies. The share read
-- needs facts from two protected tables (the share row + the session), and a
-- policy EXISTS over another policied table silently intersects with that
-- table's policies (rule 11, the M15 lesson; B3's author-side corollary:
-- "reach for a constraint, not a subquery" — and where structure cannot
-- express it, a door that states its own conditions beats a composition
-- nobody can read). D8 addendum: doors 5 and 6, enumerated below with
-- reasons, per the doors-are-enumerated rule.

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------

create table echo.agent_message_feedback (
  message_id  uuid primary key references echo.agent_message(id) on delete cascade,
  session_id  uuid not null,
  org_id      uuid not null,
  verdict     text not null check (verdict in ('up', 'down')),
  -- The optional sentence about WHY. Content, with content's rules.
  note        text,
  created_by  uuid not null references echo.app_user(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The same-org chain agent_message itself uses: a feedback row cannot
  -- name a session in someone else's org, structurally.
  constraint agent_message_feedback_same_org
    foreign key (session_id, org_id) references echo.agent_session (id, org_id)
);

create trigger agent_message_feedback_set_updated_at
  before update on echo.agent_message_feedback
  for each row execute function echo.tg_set_updated_at();

alter table echo.agent_message_feedback enable row level security;
alter table echo.agent_message_feedback force  row level security;

-- The session's owner and nobody else — the same wall the thread has. The
-- verdict PK means one feedback per message; changing your mind is an UPDATE.
create policy agent_message_feedback_own on echo.agent_message_feedback
  for all to echo_app
  using      (echo.owns_agent_session(session_id))
  with check (echo.owns_agent_session(session_id)
              and org_id = echo.actor_org_id()
              and created_by = echo.actor_id());

grant select, insert, update on echo.agent_message_feedback to echo_app;
-- NO echo_agent grant, same reasoning as proposal_decision: an agent reading
-- the human's judgement of its answers is how a verdict becomes a prompt.

comment on table echo.agent_message_feedback is
  'A person''s verdict on one assistant turn (M27). The note is content: never in logs, never agent-readable.';

-- ---------------------------------------------------------------------------
-- Share
-- ---------------------------------------------------------------------------

create table echo.agent_session_share (
  session_id  uuid primary key,
  org_id      uuid not null,
  created_by  uuid not null references echo.app_user(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,

  constraint agent_session_share_same_org
    foreign key (session_id, org_id) references echo.agent_session (id, org_id)
);

alter table echo.agent_session_share enable row level security;
alter table echo.agent_session_share force  row level security;

-- Owner-only management. Org members never touch the ROW — they read the
-- shared thread through the door below, which states its own conditions.
create policy agent_session_share_own on echo.agent_session_share
  for all to echo_app
  using      (echo.owns_agent_session(session_id))
  with check (echo.owns_agent_session(session_id)
              and org_id = echo.actor_org_id()
              and created_by = echo.actor_id());

grant select, insert, update on echo.agent_session_share to echo_app;

comment on table echo.agent_session_share is
  'The owner''s decision to let their org read one conversation (M27). Org-scoped; revocation is a stamp.';

-- ---------------------------------------------------------------------------
-- Doors 5 and 6 (D8 addendum)
-- ---------------------------------------------------------------------------
-- Reason on record: a shared conversation is a cross-member read of a table
-- whose whole design is "nobody but the owner reads it" (0016). Widening the
-- session policies would change what agent_session IS; a door grants exactly
-- one shaped read — active caller, same org, live share — and nothing else.

create function echo.shared_session_meta(target_session uuid)
  returns table (id uuid, title text, shared_by uuid, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.id, s.title, sh.created_by, s.created_at
    from echo.agent_session s
    join echo.agent_session_share sh on sh.session_id = s.id
   where s.id = target_session
     and sh.revoked_at is null
     and echo.actor_is_active()
     and sh.org_id = echo.actor_org_id();
$$;

create function echo.shared_session_thread(target_session uuid)
  returns table (id uuid, seq integer, role echo.agent_message_role,
                 content text, tool_calls jsonb, agent_run_id uuid,
                 truncated boolean, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.id, m.seq, m.role, m.content, m.tool_calls, m.agent_run_id,
         coalesce(m.truncated,
                  echo.run_is_truncated(r.status, r.started_at)) as truncated,
         m.created_at
    from echo.agent_message m
    left join echo.agent_run r on r.id = m.agent_run_id
    join echo.agent_session_share sh on sh.session_id = m.session_id
   where m.session_id = target_session
     and sh.revoked_at is null
     and echo.actor_is_active()
     and sh.org_id = echo.actor_org_id()
   order by m.seq;
$$;

revoke all on function echo.shared_session_meta(uuid) from public;
revoke all on function echo.shared_session_thread(uuid) from public;
grant execute on function echo.shared_session_meta(uuid) to echo_app;
grant execute on function echo.shared_session_thread(uuid) to echo_app;

comment on function echo.shared_session_meta(uuid) is
  'Door 5 (D8): the one shaped cross-member read of a shared conversation''s title. Conditions stated inside.';
comment on function echo.shared_session_thread(uuid) is
  'Door 6 (D8): the shared conversation''s messages, with the derived truncation marker. Conditions stated inside.';
