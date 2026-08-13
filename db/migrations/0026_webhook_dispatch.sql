-- Echo — 0026: make the outbound half of M17 buildable, and make 0013's
-- comment true.
--
-- 0013 said "the worker queues and retries deliveries while running as a
-- member". The policies said otherwise: a member could INSERT and UPDATE a
-- delivery but never SELECT one — not even through RETURNING, since Postgres
-- applies select policies there — and echo.webhook, which holds the URL and
-- the signing secret, was admin-only for every command. The comment described
-- a worker the policies forbade, and nobody had written it yet, so nothing
-- failed. A comment describing a control that does not exist is worse than no
-- comment: it is read as evidence.
--
-- Ruled (M17): the dispatcher runs as the webhook's created_by — an admin by
-- construction — with identity carried in the queue payload from enqueue time,
-- failing closed if that person is later demoted. That mirrors the inbound
-- side (D6: a gateway key acts as a member and stops working when the member
-- does), and the symmetry is the point rather than a coincidence.
--
-- So the two halves have different shapes and different roles:
--   enqueue   — the call's OWNER, a member, records that a delivery is due
--   dispatch  — the webhook's CREATOR, an admin, reads the URL and secret,
--               sends, and records the outcome

-- ---------------------------------------------------------------------------
-- 1. The queue nobody had created.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'pgmq is not installed on this server — delivery queue skipped.';
    return;
  end if;

  if not exists (select 1 from pgmq.list_queues() where queue_name = 'echo_deliver_webhook') then
    perform pgmq.create('echo_deliver_webhook');
  end if;

  execute 'grant usage on schema pgmq to echo_app';
  execute 'grant select, insert, update, delete on all tables in schema pgmq to echo_app';
  execute 'grant execute on all functions in schema pgmq to echo_app';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The scoped read that makes enqueue possible.
--
-- The enqueuer is a member. To know whether a delivery is due it must discover
-- which of its org's webhooks subscribe to an event — and must never learn
-- where they point or what signs them.
--
-- Why the split is drawn there: that a subscription EXISTS, and to what, is an
-- organizational fact — the org agreed to emit these events, and any member
-- whose work triggers one is already a party to it. The URL and the signing
-- secret are neither: they are the credential and the destination, and knowing
-- them is the difference between "my call will be announced" and "I can
-- announce anything to that endpoint, signed". Members get the fact; admins
-- keep the credential.
--
-- This is the identity-helper class — self-scoped, secret-free, requiring an
-- identity to answer at all — not a third pre-identity door in the sense of
-- D8. It reveals strictly less than echo.webhook's own admin policy already
-- does, to strictly fewer people.
-- ---------------------------------------------------------------------------

create function echo.subscribed_webhooks(p_event text)
  returns table (webhook_id uuid, events text[], enabled boolean)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select w.id, w.events, w.enabled
  from echo.webhook w
  where w.org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and p_event = any(w.events)
  order by w.id;
$$;

revoke all on function echo.subscribed_webhooks(text) from public;
grant execute on function echo.subscribed_webhooks(text) to echo_app;

comment on function echo.subscribed_webhooks(text) is
  'Which of the caller''s org webhooks subscribe to an event. Never returns url or secret_sha256 — a member may know a subscription exists, not where it points.';

-- Disabled subscriptions are returned rather than filtered, deliberately: the
-- enqueuer can then say "3 subscribed, 1 disabled" instead of silently
-- emitting less than the org expects (M21 — forfeits are said out loud).

-- ---------------------------------------------------------------------------
-- 3. Policies that describe the worker that was actually ruled.
--
-- Reading and advancing a delivery is dispatch, and dispatch is the admin.
-- Inserting one is enqueue, and enqueue is the member. The member cannot read
-- back what it inserted — including via RETURNING — so an enqueuer must
-- generate the delivery id itself rather than expect one back.
-- ---------------------------------------------------------------------------

-- A delivery must not name a webhook in another org. That belongs in a
-- constraint rather than in the policy: an EXISTS against echo.webhook inside
-- an INSERT policy would be evaluated as the *member*, who cannot see
-- echo.webhook at all, so the check would deny every enqueue — the same
-- intersection trap that made a pending user's identity resolution return 401.
-- Structure does not have that problem, and D9 already says how: composite
-- foreign keys, so a cross-org reference is unrepresentable.
alter table echo.webhook
  add constraint webhook_id_org_key unique (id, org_id);

alter table echo.webhook_delivery
  add constraint webhook_delivery_same_org
  foreign key (webhook_id, org_id) references echo.webhook (id, org_id);

drop policy webhook_delivery_write on echo.webhook_delivery;
drop policy webhook_delivery_advance on echo.webhook_delivery;

create policy webhook_delivery_enqueue on echo.webhook_delivery for insert to echo_app
  with check (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
  );

create policy webhook_delivery_dispatch on echo.webhook_delivery for update to echo_app
  using      (org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin());
