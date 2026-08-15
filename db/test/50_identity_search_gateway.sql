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
select t.ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where grantee = 'echo_app' and privilege_type = 'DELETE' and table_schema = 'echo'
  ),
  'core/''s own role holds no DELETE on any product table — only echo_purge does');
-- Scoped to the application roles: the schema owner also appears as a grantee
-- of everything on a managed platform, and a superuser was never inside this
-- wall to begin with — core/ simply never connects as one.
select t.ok(
  (select coalesce(array_agg(distinct grantee::text order by grantee::text), '{}')
     from information_schema.role_table_grants
    where table_schema = 'echo' and privilege_type = 'DELETE'
      and grantee::text like 'echo\_%') = array['echo_purge'],
  'echo_purge is the only application role that can delete a product row');

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

-- --- founding registration lands ACTIVE (M15 as amended by 0056) -----------
reset role;
insert into auth.users (id, email)
values ('09000000-0000-4000-8000-000000000009', 'frank@example.com');

set local role echo_app;
select t.ok(
  (select status from echo.register_account(
     '09000000-0000-4000-8000-000000000009', 'frank@example.com', 'فرانک')) = 'active',
  'founding a new org lands ACTIVE — the confirmed email is the acceptance (0056); '
  'the join-an-existing-org path still pends, asserted in 80_vendor_acceptance');
-- Read it as the new account: echo_app with no identity attached can see
-- nothing, not even the row it just created (invariant 2).
select set_config('echo.actor_id', '09000000-0000-4000-8000-000000000009', true);
select t.ok(
  (select role from echo.app_user where id = '09000000-0000-4000-8000-000000000009') = 'owner',
  'registering without naming an org creates an org-of-one whose founder is its owner (M2/M23)');

select t.ok((select count(*) from echo.call) = 0,
  'and that brand-new account can still see nothing until someone accepts it');

reset role;
