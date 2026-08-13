-- Echo — 0027: tell the enqueuer who the dispatcher will be.
--
-- 0026 gave members {id, events, enabled} and stopped there, which made the
-- ratified chain unbuildable: dispatch runs as the webhook's created_by, the
-- identity travels in the queue payload written at enqueue time, and the
-- enqueuer is a member who cannot read echo.webhook by any other route. It
-- could create the delivery and the message, and not say who would send it —
-- and the dispatcher cannot resolve it afterwards, because reading
-- webhook.created_by requires the very admin identity it is trying to obtain.
--
-- created_by stays on the right side of D19's line. It is a member of the
-- caller's own org, already visible to them in the member list; it is not the
-- destination and not the credential. url and secret_sha256 remain admin-only
-- absolutely, which is the line that matters.

drop function echo.subscribed_webhooks(text);

create function echo.subscribed_webhooks(p_event text)
  returns table (
    webhook_id   uuid,
    events       text[],
    enabled      boolean,
    created_by   uuid,
    dispatchable boolean
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    w.id,
    w.events,
    w.enabled,
    w.created_by,
    -- Whether the person this will dispatch AS can still dispatch. The
    -- dispatcher fails closed if its identity has been demoted (M17), which is
    -- correct but silent and late: the delivery is queued, attempted, and
    -- rejected by the wall. Saying it here lets the enqueuer report the
    -- forfeit at the moment it decides to emit — the same reason disabled
    -- subscriptions are returned rather than filtered (M21).
    exists (
      select 1
      from echo.app_user u
      join echo.org o on o.id = u.org_id
      where u.id = w.created_by
        and u.role = 'admin'
        and u.status = 'active'
        and o.status = 'active'
    )
  from echo.webhook w
  where w.org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and p_event = any(w.events)
  order by w.id;
$$;

revoke all on function echo.subscribed_webhooks(text) from public;
grant execute on function echo.subscribed_webhooks(text) to echo_app;

comment on function echo.subscribed_webhooks(text) is
  'Which of the caller''s org webhooks subscribe to an event, who they dispatch as, and whether that person still can. Never returns url or secret_sha256.';

-- ---------------------------------------------------------------------------
-- NOT changed here, and flagged to the steward instead: nothing requires
-- webhook.created_by to be the admin who registered it. The webhook_admin
-- policy checks that the *actor* is an admin, not that created_by is the
-- actor — so one admin can register a webhook that will dispatch as another,
-- attributing outbound calls to a colleague who never agreed to them.
--
-- Tightening it is a two-word change to the policy's WITH CHECK, but it also
-- decides who may EDIT a webhook someone else registered, which is a product
-- question rather than a schema one. `dispatchable` at least makes the
-- resulting state visible rather than silent.
-- ---------------------------------------------------------------------------
