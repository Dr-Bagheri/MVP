-- 0115 — the switch that decides whether anyone's mail is read at all.
--
-- 0114 hung `due_mail_polls` off an enabled ENGINE workflow subscribed to
-- `email.received`. Writing the first test against it exposed the design
-- error behind the convenience: running the draft inside the engine would
-- mean teaching it to read a mailbox, which means re-solving the one thing
-- the assistant path already solves — an email is UNTRUSTED CONTENT, and
-- `sourceContext` already attaches provider text as quoted reference data
-- rather than as instructions (invariant 3). A second implementation of
-- that fence is the last place to want one: an email that says "ignore your
-- instructions" is not a hypothetical, it is the normal case for anything
-- pointed at an inbox.
--
-- So the RUN goes through the assistant, exactly as M35's post-call brief
-- does, and the trigger keeps only the job it is good at: noticing.
--
-- The switch is therefore per PERSON, not per org: it is their mailbox, their
-- consent, and the same shape as `post_call_brief` (0112). An admin governs
-- the workflow; only the owner of the mailbox turns reading it on.

begin;

alter table echo.app_user
  add column auto_draft_replies boolean not null default false;

comment on column echo.app_user.auto_draft_replies is
  'The person''s own switch for "read my new mail and draft replies". DEFAULT FALSE: reading someone''s inbox is not a feature that arrives switched on.';

-- Same door, honest predicate. The EXISTS on a workflow row goes away with
-- the design it belonged to; what replaces it is the only fact that should
-- ever have governed this — the owner of the mailbox said yes.
create or replace function echo.due_mail_polls(p_limit int default 20)
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
     and u.auto_draft_replies
     and (c.polled_at is null or c.polled_at < now() - interval '2 minutes')
   order by c.polled_at asc nulls first
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

comment on function echo.due_mail_polls(int) is
  'M43 (D8-enumerated): connections whose mailbox is due a look. Ids only — no token, no label. The owner''s own `auto_draft_replies` is the off-switch: with it false, their mail is never read.';

commit;
