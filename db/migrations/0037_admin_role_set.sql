-- Echo — 0037: one definition of "counts as an admin".
--
-- Adding 'owner' meant every `role = 'admin'` in the schema silently stopped
-- matching the org's most privileged person. There were four:
--   0003  actor_is_admin()          — fixed in 0036, the central one
--   0015  vendor_pending_orgs()     — fixed in 0036
--   0015  vendor_accept_org()       — fixed in 0036
--   0027  subscribed_webhooks()     — MISSED, and caught by the suite
--
-- The missed one is the interesting one. I anticipated the vendor pair because
-- I was thinking about founders, and the central helper because it is the
-- centre; the fourth was in a package written days earlier and had nothing to
-- do with what I was changing. Its effect: a webhook registered by the owner
-- reported `dispatchable = false`, so the enqueuer would have logged every
-- delivery as undeliverable and emitted nothing, quietly and correctly-looking.
--
-- Fixing the fourth instance is not the lesson. The lesson is that the rule
-- was written out four times, so it could drift in four places — the same
-- thing 0034 dropped an unused helper to avoid. So it gets written once.

create function echo.role_is_admin(r echo.member_role) returns boolean
  language sql
  immutable
  parallel safe
as $$ select r in ('admin', 'owner') $$;

comment on function echo.role_is_admin(echo.member_role) is
  'Which roles carry admin authority (M23: an owner is an admin with more). The only place this is decided — call it rather than restating it.';

create or replace function echo.actor_is_admin() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select echo.role_is_admin(u.role) and u.status = 'active'
     from echo.app_user u
     join echo.org o on o.id = u.org_id
     where u.id = echo.actor_id() and o.status = 'active'),
    false
  );
$$;

create or replace function echo.subscribed_webhooks(p_event text)
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
    exists (
      select 1
      from echo.app_user u
      join echo.org o on o.id = u.org_id
      where u.id = w.created_by
        and echo.role_is_admin(u.role)
        and u.status = 'active'
        and o.status = 'active'
    )
  from echo.webhook w
  where w.org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and p_event = any(w.events)
  order by w.id;
$$;

revoke all on function echo.role_is_admin(echo.member_role) from public;
grant execute on function echo.role_is_admin(echo.member_role)
  to echo_app, echo_agent, echo_purge;
