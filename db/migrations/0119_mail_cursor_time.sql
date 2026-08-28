-- 0119 — the mark grows a CLOCK, because an id alone cannot say what is new.
--
-- What happened on 2026-08-28, in production, watched live: the poller's
-- window narrowed to the inbox (0fdef5a, the fix for "it got double time,
-- but i got one email"). The stored cursor was the id of a message that was
-- no longer in that narrower window, so `newMailSince` took its "cursor not
-- in the window" branch — take the whole page — and the assistant drafted
-- replies to three messages that had been sitting in the mailbox for hours.
-- Nothing was broken. Every layer did exactly what it says it does.
--
-- The branch is not wrong to exist. Its two neighbours are both worse:
--
--   * take NOTHING when the id is missing — and the ordinary case breaks,
--     because the ordinary case is a person ARCHIVING the mail we drafted
--     for. The cursor leaves the inbox almost every time it works, and a
--     round that silently skips every new message would be indistinguishable
--     from a poller that has stopped.
--   * take the PAGE — which is what shipped, and which turns any window
--     shift into a burst of replies to old mail. A missed reply is asked for
--     again; an unasked-for reply is already in someone's drafts.
--
-- So the mark records WHEN as well as WHICH. With a time, the missing-id
-- case stops being a guess: keep the messages that arrived after the last
-- one we saw, which is the question the id was always standing in for.
--
-- One door, one signature. The 3-arg form from 0118 is dropped rather than
-- kept beside a 4-arg one with a default — two overloads reachable by the
-- same call is how a caller silently binds to the older behaviour, and the
-- older behaviour here is the defect.

begin;

alter table echo.connector_connection
  add column mail_cursor_at timestamptz;

comment on column echo.connector_connection.mail_cursor_at is
  'When the message named by mail_cursor arrived. The poller uses it when that message is no longer in the window it can see — archived, deleted, or filtered — so "new" stays answerable without replying to a backlog.';

drop function if exists echo.set_mail_cursor(uuid, text, integer);
drop function if exists echo.set_mail_cursor(uuid, text);

create function echo.set_mail_cursor(
  p_id uuid, p_cursor text, p_seen integer, p_at timestamptz
) returns void
language sql
security definer
set search_path = ''
as $$
  update echo.connector_connection c
     set mail_cursor = p_cursor,
         -- null only where the provider gave no date; the id still moves, so
         -- a mailbox whose headers we cannot read is no worse off than before
         mail_cursor_at = p_at,
         messages_seen = c.messages_seen + greatest(0, coalesce(p_seen, 0))
   where c.id = p_id
$$;

comment on function echo.set_mail_cursor(uuid, text, integer, timestamptz) is
  'M43 (D8-enumerated): records the newest message the poller has seen for one connection, when it arrived, and how many it passed through this round.';

revoke all on function echo.set_mail_cursor(uuid, text, integer, timestamptz) from public;
grant execute on function echo.set_mail_cursor(uuid, text, integer, timestamptz) to echo_app;

commit;
