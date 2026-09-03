-- The remaining three properties the wall depends on: the roles really are
-- ordinary, Persian search really matches across spellings, and the gateway
-- really does arrive as a person.

-- --- the roles are not privileged -----------------------------------------
reset role;
select t.ok(
  not exists (select 1 from pg_roles
              where rolname in ('echo_app','echo_agent','echo_purge')
                and (rolsuper or rolbypassrls)),
  'no application role is a superuser or bypasses RLS — otherwise none of the rest matters');
-- Scoped to the echo schema: echo_app does hold DELETE on pgmq's own tables,
-- because working a queue means consuming from it. No product row is reachable
-- that way.
--
-- Altitude note (rule 11): role_table_grants is permission-filtered, but the
-- suite connects as the role that GRANTED everything here, so the view is
-- complete at this altitude — and the staged-grant control below proves this
-- instrument sees a grant appear.
--
-- ONE ruled exception, named (D3 amendment, 2026-08-27): 0079 grants
-- echo_app DELETE on call_note — a note is its author's own annotation,
-- append-only delete-and-retype by design, RLS-scoped to created_by =
-- actor, and consumed by core (calls.ts deleteNote). Every other product
-- row still deletes only through echo_purge. The list is EXACT, so a stray
-- DELETE grant anywhere else in echo turns this red — it caught 0101's
-- unconsumed role_capability grant, revoked in 0109, and it caught 0144's
-- two additions on landing day, which is how they came to be argued here:
--
--   · task_checklist_item (0144): removing a checklist line is EDITING the
--     task, and a removed-flag is a second spelling of absence every count
--     must remember to exclude — the call_note class, one table over.
--   · task_assignee (0144): a membership row; unassigning must remove it
--     or "who is on this" accretes everyone who ever touched the card.
--   · task_label (0147): a label the org invented and can retire — the
--     reference's own pencil deletes one, and a retired label that lingers
--     on every card is worse than gone.
--   · task_label_link (0147): the same membership shape as task_assignee —
--     taking a label off a card must remove the row.
--   · meeting_attachment (0159): a document somebody attached to a meeting.
--     The same shape as a note — a person put it there and removing it is an
--     ordinary act, not a purge. The OBJECT behind the row is a different
--     question and a different role's: echo_purge deletes the bytes, and
--     platform_meeting_storage_paths is how it finds them.
--   · meeting_item (0160): a decision, action item, question, risk or
--     entity. Removing one is the ordinary act the surface is FOR — the
--     assistant may add these and holds no DELETE, so the authority runs one
--     way and this grant is the half that makes the other half meaningful.
--   · meeting (0148): a meeting is a PLAN, not a record — the call it
--     produced is a separate row with its own ladder, and this delete
--     cannot reach it (asserted in 0148: nothing cascades from meeting).
--
-- Task ROWS themselves stay undeletable by every app role: archived_at is
-- the only way off the board — and since 0162, echo.delete_task, which is a
-- DOOR rather than a grant and so never appears in this list.
-- ONE list, read twice. It was written out twice until 0160, and the second
-- copy is the one that goes stale: adding a table here turned the first check
-- green and left the second red, in a file whose whole job is to be exact.
create temp table argued_deletes (name text) on commit drop;
insert into argued_deletes (name) values
  -- agent_room_member was here from 0164 until 0166 dropped the rooms
  -- (the agents answer inline in the assistant thread instead). It is
  -- mentioned only so the next reader of the git history is not left
  -- wondering whether an entry went missing by accident.
  ('call_note'), ('meeting'), ('meeting_attachment'), ('meeting_item'),
  ('task_assignee'), ('task_checklist_item'), ('task_label'), ('task_label_link');

select t.ok(
  (select coalesce(array_agg(distinct table_name::text order by table_name::text), '{}')
     from information_schema.role_table_grants
    where grantee = 'echo_app' and privilege_type = 'DELETE' and table_schema = 'echo')
   = (select array_agg(name order by name) from argued_deletes),
  'core/''s own role deletes exactly the argued list: a note author''s own note (0079), a task''s checklist lines and its assignee rows (0144), a label and a card''s wearing of one (0147), a meeting''s attached document (0159), a meeting''s decisions and action items (0160), an agent''s membership of a room (0164) — every other product row is echo_purge''s alone');
-- Scoped to the application roles: the schema owner also appears as a grantee
-- of everything on a managed platform, and a superuser was never inside this
-- wall to begin with — core/ simply never connects as one.
select t.ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'echo' and privilege_type = 'DELETE'
      and grantee::text like 'echo\_%'
      and grantee::text <> 'echo_purge'
      and not (grantee::text = 'echo_app'
               and table_name in (select name from argued_deletes))
  ),
  'echo_purge is the only application role that deletes product rows — the 0079 note exception is the closed list''s single entry');

-- Negative control (the en-sweep lesson): a closed-list check that has never
-- seen a stray grant is indistinguishable from one that cannot see grants at
-- all. Stage the defect, watch the check-form fire, then take the grant back
-- out (the file's rollback would anyway).
grant delete on echo.skill to echo_app;
select t.denied(
  $$select t.ok(
      (select coalesce(array_agg(distinct table_name::text order by table_name::text), '{}')
         from information_schema.role_table_grants
        where grantee = 'echo_app' and privilege_type = 'DELETE' and table_schema = 'echo')
       = array['call_note', 'meeting', 'task_assignee', 'task_checklist_item', 'task_label', 'task_label_link'], 'control')$$,
  'a staged stray DELETE grant turns the closed list red — the instrument can fail for its own reason');
revoke delete on echo.skill from echo_app;

-- Every product table has RLS on and forced. A table added later without it
-- would be a silent hole, so the suite counts them rather than trusting review.
select t.ok(
  not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'echo' and c.relkind = 'r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ),
  'every table in the echo schema has row level security enabled AND forced');

-- Every application role reaps its own leaked transactions. A harness that
-- crashes between begin and rollback once held locks on the shared project for
-- thirty-two minutes and blocked every session's DDL; this is that rule turned
-- into something that runs.
select t.ok(
  not exists (
    select 1 from pg_roles
    where rolname in ('echo_app', 'echo_agent', 'echo_purge')
      and coalesce(array_to_string(rolconfig, ','), '')
          not like '%idle_in_transaction_session_timeout%'
  ),
  'no application role can hold a transaction open indefinitely');

-- --- Persian folding ------------------------------------------------------
select t.ok(echo.fa_fold('كتاب') = echo.fa_fold('کتاب'),
  'Arabic kaf and Persian kaf fold together');
select t.ok(echo.fa_fold('علي') = echo.fa_fold('علی'),
  'Arabic yeh and Persian yeh fold together');
select t.ok(echo.fa_fold('٥') = '5' and echo.fa_fold('۵') = '5',
  'Arabic-Indic and Persian digits fold to the same key');
select t.ok(echo.fa_fold('کتاب‌ها') = 'کتابها',
  'the zero-width non-joiner does not split a word in the index');

-- --- search matches across spellings --------------------------------------
-- The fixture line was stored with Arabic yeh and an Arabic-Indic digit, the
-- way an STT might return it. Someone typing the Persian forms must find it.
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.ok(
  exists (select 1 from echo.transcript_segment
          where search @@ plainto_tsquery('simple', echo.fa_fold('قیمت'))),
  'a query in Persian yeh finds text stored with Arabic yeh');
select t.ok(
  exists (select 1 from echo.transcript_segment
          where search @@ plainto_tsquery('simple', echo.fa_fold('۵'))),
  'a query in Persian digits finds an Arabic-Indic digit');
select t.ok(
  exists (select 1 from echo.summary
          where search @@ plainto_tsquery('simple', echo.fa_fold('خلاصه'))),
  'summaries are searchable too');

-- Search obeys the wall like everything else.
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.ok(
  not exists (select 1 from echo.transcript_segment
              where search @@ plainto_tsquery('simple', echo.fa_fold('قیمت'))),
  'search returns nothing from another org — the index is not a side channel');

-- --- the gateway arrives as a person (M17) --------------------------------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.ok(
  (select actor_id from echo.resolve_api_key('sha-live'))
    = '02000000-0000-4000-8000-000000000002',
  'a live key resolves to the member it acts as, not to "the org"');
select t.ok(
  not exists (select 1 from echo.resolve_api_key('sha-revoked')),
  'a revoked key resolves to nobody');
select t.ok(
  not exists (select 1 from echo.resolve_api_key('sha-pending')),
  'a key whose member is not active resolves to nobody — disabling a person stops their integrations');
select t.ok(
  not exists (select 1 from echo.resolve_api_key('sha-nonexistent')),
  'an unknown token resolves to nobody');

-- --- the assistant is per-key opt-in (M17 amendment) ----------------------
-- The flag has to come back from the resolution itself: at gateway auth time
-- there is no identity, so core/ cannot read echo.api_key to find it.
select t.ok(
  (select allow_assistant from echo.resolve_api_key('sha-live')) = false,
  'a key resolves with the assistant closed unless someone opened it');
select t.ok(
  (select allow_assistant from echo.resolve_api_key('sha-assistant')) = true,
  'and open when an admin granted it');

-- Negative-space guard: every key written the pre-0022 way — no mention of the
-- column at all — is closed. Nothing about adding the feature promoted an
-- existing key, and no future backfill may either.
select t.ok(
  (select count(*) from echo.api_key
    where allow_assistant and id <> '24000000-0000-4000-8000-000000000004') = 0,
  'no key acquired assistant access it was not explicitly granted');

-- Granting it is an admin act, like every other change to a gateway key.
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.writes_nothing(
  $$update echo.api_key set allow_assistant = true
     where id = '21000000-0000-4000-8000-000000000001'$$,
  'a member cannot open the assistant on a key, or see one to try');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
update echo.api_key set allow_assistant = true
 where id = '21000000-0000-4000-8000-000000000001';
select t.ok(
  (select allow_assistant from echo.resolve_api_key('sha-live')) = true,
  'an admin opens it, and the resolution reflects it immediately');

-- --- signup JOINS, it never FOUNDS (0082, user ruling 2026-08-23) ----------
reset role;
insert into auth.users (id, email)
values ('09000000-0000-4000-8000-000000000009', 'frank@example.com');

set local role echo_app;
-- 0150: a bare registration is the ORDINARY path now — it lands somewhere
-- rather than being refused for want of a setting. What 0082 was protecting
-- is unchanged and is what gets asserted: it FOUNDS nothing and it does not
-- arrive as an owner. (The refusal it used to raise was the means, not the
-- rule; pinning the means is how a test outlives its own reason.)
select t.ok(
  (select count(*)::int from echo.org) = (
    with before as (select count(*)::int as n from echo.org),
         made as (select echo.register_account(
           '09000000-0000-4000-8000-000000000009', 'frank@example.com', 'فرانک'))
    select n from before, made),
  '0150: a bare registration creates NO organization — founding is still gone');
-- the READ drops to owner altitude on purpose: app_user is behind RLS and
-- echo_app with no actor set sees nothing, so asking the question from here
-- would answer "no such row" for a row that exists (rule 11's counting
-- corollary — "I cannot see any" is not "there are none").
reset role;
select t.ok(
  (select role::text || '/' || status::text from echo.app_user
    where id = '09000000-0000-4000-8000-000000000009') = 'member/pending',
  '0150: and it arrives as a PENDING MEMBER — the owner accepts from the console');
delete from echo.app_user where id = '09000000-0000-4000-8000-000000000009';

set local role echo_app;
select t.denied(
  $$select echo.register_account(
      '09000000-0000-4000-8000-000000000009', 'frank@example.com', 'فرانک',
      'سازمانی که وجود ندارد')$$,
  'a name matching no active org is refused — the name is a JOIN key, not a founding wish');
select t.ok(
  (select status from echo.register_account(
     '09000000-0000-4000-8000-000000000009', 'frank@example.com', 'فرانک',
     'شرکت الف')) = 'pending',
  'the RIGHT name joins the existing org as PENDING — acceptance stays the org''s decision');
-- Read it as the new account: echo_app with no identity attached can see
-- nothing, not even the row it just created (invariant 2).
select set_config('echo.actor_id', '09000000-0000-4000-8000-000000000009', true);
select t.ok(
  (select role from echo.app_user where id = '09000000-0000-4000-8000-000000000009') = 'member',
  'and the role is MEMBER, never owner — owners are made in the platform console only (0082)');

select t.ok((select count(*) from echo.call) = 0,
  'and that brand-new account can still see nothing until someone accepts it');

reset role;
