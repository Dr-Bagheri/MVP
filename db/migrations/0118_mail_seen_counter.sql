-- 0118 — how many messages the poller has actually looked at.
--
-- The user's report was precise: "i got the email but it did not update
-- itself … it must show in that table". A connection that says only
-- "connected" cannot answer the one question a person asks of an
-- integration — is it working RIGHT NOW — and `polled_at` alone answers
-- "we looked", not "we saw anything".
--
-- A counter rather than a stored list: the messages themselves are the
-- person's mail and have no business in our tables (W9, references not
-- content). A number is enough to show the integration is alive, and it is
-- the same number a person can sanity-check against their own inbox.

begin;

alter table echo.connector_connection
  add column messages_seen integer not null default 0
    check (messages_seen >= 0);

comment on column echo.connector_connection.messages_seen is
  'How many mailbox messages this connection has passed through the poller. Not a store of mail — a liveness count the owner can check against their own inbox.';

-- The poller's own increment, alongside the cursor it already advances.
create or replace function echo.set_mail_cursor(p_id uuid, p_cursor text, p_seen integer default 0)
returns void
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection c
     set mail_cursor = p_cursor,
         messages_seen = c.messages_seen + greatest(0, coalesce(p_seen, 0))
   where c.id = p_id
$$;

comment on function echo.set_mail_cursor(uuid, text, integer) is
  'M43 (D8-enumerated): records the newest message the poller has seen for one connection, and how many it passed through this round.';

revoke all on function echo.set_mail_cursor(uuid, text, integer) from public;
grant execute on function echo.set_mail_cursor(uuid, text, integer) to echo_app;

commit;
