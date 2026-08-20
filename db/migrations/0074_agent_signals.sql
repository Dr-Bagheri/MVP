-- NeurAI Platform — 0074: signals — the agent acts without being asked
-- (proposed M35; AI-native plan Phase B, user-directed 2026-08-21).
--
-- Two tables and a queue:
--   agent_card — the proactivity channel's items: something the agent
--     INITIATED (a post-call brief, a weekly digest) waiting in the owner's
--     dock. Codes, titles and REFERENCES only — the content lives in the
--     linked conversation, where content already knows how to live.
--   agent_rule — per-owner standing subscriptions (v1: the weekly digest).
--     The post-call brief is an implicit system rule and needs no row.
--   echo_agent_rules (pgmq) — the transport for both, walked by the worker
--     exactly like the pipeline's own queues; runs execute AS THE OWNER
--     (the job-identity precedent, M3 — never a service account).
--
-- Cross-owner scheduling needs two doors (the D19 subscribed_webhooks
-- precedent): the worker cannot read every owner's rules through owner-
-- scoped RLS, so `due_agent_rules()` (metadata: ids only) and
-- `mark_agent_rule_fired()` are SECURITY DEFINER, enumerated with reasons
-- per D8. Nothing here reaches content: firing a rule only ENQUEUES; the
-- run itself happens under the owner's identity and their RLS.
--
-- core detects these tables at boot (capability detection) and skips the
-- whole feature loudly until this lands.

-- ─── the proactivity channel ────────────────────────────────────────────────
create table echo.agent_card (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references echo.org(id),
  owner_id      uuid not null,
  kind          text not null check (kind in ('post_call_brief', 'weekly_digest')),
  title         text not null default '',
  session_id    uuid,
  agent_run_id  uuid references echo.agent_run(id) on delete set null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,

  -- D9: a card in org A structurally cannot belong to a person in org B
  constraint agent_card_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  -- the brief's content lives in its conversation; if that is ever purged,
  -- the card survives as a tombstoned pointer (0018's SET NULL class)
  constraint agent_card_session_same_org
    foreign key (session_id, org_id) references echo.agent_session (id, org_id)
    on delete set null
);

create index agent_card_owner_unread
  on echo.agent_card (owner_id, created_at desc) where read_at is null;

alter table echo.agent_card enable row level security;
alter table echo.agent_card force row level security;

-- Owner-only, all verbs on echo_app: the worker writes them AS the owner.
create policy agent_card_own on echo.agent_card for all to echo_app
  using (echo.actor_is_active()
         and owner_id = echo.actor_id() and org_id = echo.actor_org_id())
  with check (echo.actor_is_active()
         and owner_id = echo.actor_id() and org_id = echo.actor_org_id());

grant select, insert on echo.agent_card to echo_app;
grant update (read_at) on echo.agent_card to echo_app;

comment on table echo.agent_card is
  'M35 proactivity channel: agent-INITIATED items. Titles and refs only; content lives in the linked conversation. Never a pending-approvals inbox (M4).';

-- ─── standing subscriptions ─────────────────────────────────────────────────
create table echo.agent_rule (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references echo.org(id),
  owner_id       uuid not null,
  event          text not null check (event in ('cron.weekly')),
  enabled        boolean not null default true,
  config         jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  last_fired_at  timestamptz,

  constraint agent_rule_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  -- one weekly digest per person, not one per toggle-flip
  constraint agent_rule_one_per_event unique (owner_id, event)
);

alter table echo.agent_rule enable row level security;
alter table echo.agent_rule force row level security;

create policy agent_rule_own on echo.agent_rule for all to echo_app
  using (echo.actor_is_active()
         and owner_id = echo.actor_id() and org_id = echo.actor_org_id())
  with check (echo.actor_is_active()
         and owner_id = echo.actor_id() and org_id = echo.actor_org_id());

grant select, insert on echo.agent_rule to echo_app;
grant update (enabled) on echo.agent_rule to echo_app;

comment on table echo.agent_rule is
  'M35 standing subscriptions (v1: cron.weekly digest). last_fired_at is stamped only through the definer door — the worker schedules across owners.';

-- ─── the scheduler''s two doors (D8: enumerated, with reasons) ──────────────
-- Reason: the worker must discover DUE rules across every owner, and RLS is
-- owner-scoped by design. This door returns METADATA ONLY (ids, event) —
-- the run it triggers executes under the owner''s identity and their RLS.
create function echo.due_agent_rules()
  returns table (id uuid, owner_id uuid, org_id uuid, event text)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select r.id, r.owner_id, r.org_id, r.event
    from echo.agent_rule r
   where r.enabled
     and r.event = 'cron.weekly'
     and (r.last_fired_at is null or r.last_fired_at < now() - interval '7 days')
$$;

-- Reason: the stamp is the idempotency guard for the same cross-owner walk;
-- without it every scheduler tick would re-fire every rule.
create function echo.mark_agent_rule_fired(p_rule uuid)
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  update echo.agent_rule set last_fired_at = now() where id = p_rule
$$;

grant execute on function echo.due_agent_rules() to echo_app;
grant execute on function echo.mark_agent_rule_fired(uuid) to echo_app;
revoke all on function echo.due_agent_rules() from public;
revoke all on function echo.mark_agent_rule_fired(uuid) from public;

-- ─── the transport ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'pgmq absent on this server — echo_agent_rules not created here';
    return;
  end if;
  perform pgmq.create('echo_agent_rules');
end $$;
