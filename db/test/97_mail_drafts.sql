-- db/0114 — the draft the assistant writes and only a person sends.
--
-- The load-bearing assertion is the LAST one in the first block: echo_agent
-- can create a draft and cannot decide it. Everything else is scaffolding for
-- that sentence. If the grant is ever widened, this file is where the product
-- promise "the assistant will not send mail on its own" stops being true.

reset role;

-- a google connection for bob, so the poller's doors have a subject
insert into echo.connector_connection
  (id, org_id, owner_id, provider, status, account_label, scopes)
values ('97000000-0000-4000-8000-00000000000c',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        'google', 'connected', 'bob@example.com',
        '["https://www.googleapis.com/auth/gmail.compose"]'::jsonb);

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0114 policy tests run under a non-bypass product role');

-- ─── the draft is its owner's, and nobody else's ────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
insert into echo.mail_draft
  (id, org_id, owner_id, provider, source_ref, to_address, subject, body)
values ('97000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        'google', 'msg-aaa', 'someone@example.com', 'Re: meeting',
        'سلام، سه‌شنبه ساعت ۱۰ برایم مناسب است.');

select t.ok(
  (select count(*) from echo.mail_draft) = 1,
  '0114: bob reads the draft written for him');

select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  (select count(*) from echo.mail_draft) = 0,
  '0114: carol sees none of bob''s drafts — a draft quotes his mail, so not even a colleague reads it');

-- the admin is not an exception here, deliberately: admins govern the
-- workflow, they do not read the correspondence it touches
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice (admin)
select t.ok(
  (select count(*) from echo.mail_draft) = 0,
  '0114: an ADMIN sees no drafts either — governing a workflow is not reading its mail');

-- ─── THE WALL: the agent writes drafts and decides none ─────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

insert into echo.mail_draft
  (id, org_id, owner_id, provider, source_ref, to_address, subject, body)
values ('97000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        'google', 'msg-bbb', 'other@example.com', 'Re: budget', 'draft body');
select t.ok(
  (select count(*) from echo.mail_draft) = 2,
  '0114: the agent CAN write a draft for the person it runs as');

select t.denied(
  $$update echo.mail_draft set status = 'sent'
     where id = '97000000-0000-4000-8000-000000000001'$$,
  '0114: the agent cannot send — no UPDATE grant, so the promise is a fact about the database');
select t.denied(
  $$update echo.mail_draft set body = 'rewritten'
     where id = '97000000-0000-4000-8000-000000000001'$$,
  '0114: nor rewrite one after the fact');
select t.denied(
  $$delete from echo.mail_draft$$,
  '0114: nor delete one (M11 holds here too)');

-- ─── the person decides, on the product role ────────────────────────────
reset role;
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
update echo.mail_draft
   set status = 'sent', decided_at = now(), decided_by = '02000000-0000-4000-8000-000000000002'
 where id = '97000000-0000-4000-8000-000000000001';
select t.ok(
  (select status from echo.mail_draft where id = '97000000-0000-4000-8000-000000000001') = 'sent',
  '0114: bob sends his own draft');

select t.denied(
  $$update echo.mail_draft set status = 'sent'
     where id = '97000000-0000-4000-8000-000000000002'$$,
  '0114: a decided status needs its decider — the together-check refuses a bare flip');

-- one incoming message, one draft: a poller that sees the same mail twice
-- must not write a second reply to it
select t.denied(
  $$insert into echo.mail_draft
      (org_id, owner_id, provider, source_ref, to_address, subject, body)
    values ('0a000000-0000-4000-8000-00000000000a',
            '02000000-0000-4000-8000-000000000002',
            'google', 'msg-aaa', 'someone@example.com', 'Re: meeting', 'again')$$,
  '0114: a second draft for the same message is refused');

-- ─── the poller's doors ─────────────────────────────────────────────────
-- The off-switch first: a person who has not asked for this has their mail
-- left alone. Asserted BEFORE the enabling update, so the enabled case below
-- cannot pass by having been true all along.
select t.ok(
  (select count(*) from echo.due_mail_polls(10)) = 0,
  '0115: with auto_draft_replies off, no mailbox is due a look');

reset role;
update echo.app_user set auto_draft_replies = true
 where id = '02000000-0000-4000-8000-000000000002';

set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  exists (select 1 from echo.due_mail_polls(10)
           where connection_id = '97000000-0000-4000-8000-00000000000c'),
  '0115: once the owner switches it on, their connection is due');

-- the door answers about EVERY owner, not the caller: it is the worker's,
-- and RLS deliberately shows the worker none of these rows
select t.ok(
  (select owner_id from echo.due_mail_polls(10)
    where connection_id = '97000000-0000-4000-8000-00000000000c')
    = '02000000-0000-4000-8000-000000000002',
  '0115: the door names the owner the worker must run as');

-- exactly-once: the claim advances the mark, so the second claimer gets nothing
select t.ok(
  echo.claim_mail_poll('97000000-0000-4000-8000-00000000000c') is true,
  '0114: the first claim wins the poll');
select t.ok(
  echo.claim_mail_poll('97000000-0000-4000-8000-00000000000c') is null,
  '0114: the second finds nothing to claim — the predicate IS the compare-and-set (0111)');
select t.ok(
  (select count(*) from echo.due_mail_polls(10)) = 0,
  '0114: and a just-polled connection is no longer due');

reset role;
