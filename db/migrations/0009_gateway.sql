-- Echo — 0009: the public API gateway (M17) — per-org keys and webhooks, so
-- any platform can push audio in and pull results out.
--
-- The gateway is not a bypass. A key does not authenticate "the org" — it
-- acts AS a specific member (actor_id), so a gateway request arrives with a
-- user identity and meets exactly the same RLS wall as a browser request.
-- Invariant 2 has no exceptions, and this is where it would have been
-- tempting to make one.

create table echo.api_key (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references echo.org(id),
  -- The member this key acts as. Its permissions are that member's, never more.
  actor_id     uuid not null references echo.app_user(id),

  name         text not null check (length(btrim(name)) > 0),
  -- sha256 of the token. The token itself is shown once at creation and is
  -- never stored — not here, not in logs (invariant 7).
  token_sha256 text not null,
  -- Leading characters, for "which key is this?" in the UI. Not a secret.
  token_prefix text not null,

  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references echo.app_user(id),

  created_by   uuid not null references echo.app_user(id),
  created_at   timestamptz not null default now(),

  constraint api_key_token_key unique (token_sha256),
  constraint api_key_actor_same_org
    foreign key (actor_id, org_id) references echo.app_user (id, org_id),
  constraint api_key_revoke_consistent
    check (num_nonnulls(revoked_at, revoked_by) in (0, 2))
);

create index api_key_org_idx on echo.api_key (org_id) where revoked_at is null;

comment on column echo.api_key.actor_id is
  'A gateway request borrows this member''s authority and never more (M3/M17).';

-- ---------------------------------------------------------------------------
-- Webhooks: the outbound half of the gateway.
-- ---------------------------------------------------------------------------

create table echo.webhook (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references echo.org(id),
  url           text not null check (url ~ '^https://'),
  -- Signing secret, stored hashed for verification of our own signatures at
  -- rotation time; the live secret lives in the secret store, not here.
  secret_sha256 text not null,
  events        text[] not null default '{}',
  enabled       boolean not null default true,
  created_by    uuid not null references echo.app_user(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint webhook_events_not_empty check (cardinality(events) > 0)
);

create index webhook_org_idx on echo.webhook (org_id) where enabled;

create trigger webhook_set_updated_at
  before update on echo.webhook
  for each row execute function echo.tg_set_updated_at();

create table echo.webhook_delivery (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references echo.org(id),
  webhook_id      uuid not null references echo.webhook(id),
  event           text not null,
  -- Identifiers and status only. Transcript and summary text never leave in a
  -- webhook body; the consumer fetches through the gateway, under the wall.
  payload         jsonb not null default '{}',
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  response_code   integer,
  delivered_at    timestamptz,
  failed_at       timestamptz,
  created_at      timestamptz not null default now()
);

create index webhook_delivery_pending_idx
  on echo.webhook_delivery (next_attempt_at)
  where delivered_at is null and failed_at is null;
create index webhook_delivery_org_idx on echo.webhook_delivery (org_id, created_at desc);
