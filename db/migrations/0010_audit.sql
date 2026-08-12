-- Echo — 0010: the admin action log (M10).
--
-- The other half of "audit = agent_runs + admin action log". Deletions,
-- acceptances, role changes, scope flips — the human decisions that no agent
-- can make. Append-only: 0011 blocks UPDATE, and nobody holds DELETE.

create table echo.admin_action (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  actor_id    uuid not null references echo.app_user(id),

  action      text not null check (length(btrim(action)) > 0),
  target_type text not null,
  target_id   uuid,
  -- Identifiers, before/after states, reasons. Never call content (invariant 7).
  detail      jsonb not null default '{}',

  created_at  timestamptz not null default now(),

  constraint admin_action_actor_same_org
    foreign key (actor_id, org_id) references echo.app_user (id, org_id)
);

create index admin_action_org_idx    on echo.admin_action (org_id, created_at desc);
create index admin_action_target_idx on echo.admin_action (target_type, target_id);

comment on table echo.admin_action is
  'Human decisions, always logged (M11). Append-only; no role in this database holds DELETE on it.';
