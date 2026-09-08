-- db/0212 — a Telegram account speaks for a colleague only after it is linked.
--
-- The feature reads as "voice note in, card out", and every assertion here is
-- about the sentence underneath it: **a Telegram sender is an integer until a
-- code says otherwise.** The bot answers anybody who finds it, so if the link
-- can be forged, written by hand, or read across an organisation, the feature
-- is a public write endpoint onto somebody's task board.
--
--   alice  owner,  org A   01…01
--   bob    member, org A   02…02
--   erin   owner,  org B   05…05  — a stranger with the highest role there is
--
-- A migration's self-checks run ONCE, on the day it is applied. They cannot
-- see a policy dropped and recreated two migrations later, which is the edit
-- they exist for — so the rules live here as well (0189's lesson).

reset role;

-- ── the fixture: bob has a live code, alice has a link already ────────────
insert into echo.telegram_link_code (id, org_id, user_id, code_hash, expires_at)
values ('13000000-0000-4000-8000-0000000009d1'::uuid,
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        'test-0212-bob-hash', now() + interval '10 minutes');

select linked_user_id from echo.redeem_telegram_link(
  '0a000000-0000-4000-8000-00000000000a'::uuid, 'test-0212-bob-hash',
  777000000001::bigint, 777000000001::bigint, 'bob_tg');

select t.ok(
  (select count(*) = 1 from echo.telegram_identity
    where telegram_user_id = 777000000001
      and user_id = '02000000-0000-4000-8000-000000000002'),
  '0212: redeeming a live code links the account — the accept half');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0212 tests run under a non-bypass product role');

-- ── NOBODY WRITES A LINK BY HAND ──────────────────────────────────────────
--
-- The whole wall. If a product role can insert here, the code proves nothing:
-- the api could link anybody to anybody, and so could anything that reached
-- the api. This is a GRANT refusal, not a policy one, so it RAISES — an
-- update or insert walled by a policy matches zero rows and succeeds (0186),
-- and asserting the record would report a working wall as broken.
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.denied(
  $$insert into echo.telegram_identity (org_id, user_id, telegram_user_id, chat_id)
    values ('0a000000-0000-4000-8000-00000000000a',
            '02000000-0000-4000-8000-000000000002', 888000000001, 888000000001)$$,
  '0212: a member cannot write their own link by hand');

select t.ok(
  not has_table_privilege('echo_agent', 'echo.telegram_identity', 'INSERT'),
  '0212: nor can the agent role');
select t.ok(
  not has_table_privilege('echo_agent', 'echo.telegram_identity', 'SELECT'),
  '0212: the agent cannot even read who is linked — a messaging account is personal');

-- ── A LINK IS THEIRS AND ONLY THEIRS ──────────────────────────────────────
select t.ok(
  (select count(*) = 1 from echo.telegram_identity),
  '0212: bob sees his own link');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, OWNER
select t.ok(
  (select count(*) = 0 from echo.telegram_identity),
  '0212: the org OWNER does not see a colleague''s messaging account');

select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin, org B
select t.ok(
  (select count(*) = 0 from echo.telegram_identity),
  '0212: and neither does another organisation');

-- ── THE DOOR ANSWERS FOR THE RIGHT ORG AND NOBODY ELSE ────────────────────
--
-- `telegram_identity_for` is definer, so it is the one place where a wrong
-- org argument would cross the wall. The pair is the assertion: the same
-- sender id resolves in org A and resolves to NOTHING in org B.
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  (select count(*) = 1 from echo.telegram_identity_for(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 777000000001::bigint)),
  '0212: the door names the colleague behind a linked sender');
select t.ok(
  (select count(*) = 0 from echo.telegram_identity_for(
     '0b000000-0000-4000-8000-00000000000b'::uuid, 777000000001::bigint)),
  '0212: the same sender is nobody in another organisation');
select t.ok(
  (select count(*) = 0 from echo.telegram_identity_for(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 111000000999::bigint)),
  '0212: an unlinked sender is zero rows — the only answer a stranger gets');

-- ── THE CODE: SINGLE USE, AND EVERY REFUSAL LOOKS THE SAME ────────────────
reset role;

-- spent (bob's, redeemed above)
select t.ok(
  (select count(*) = 0 from echo.redeem_telegram_link(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 'test-0212-bob-hash',
     888000000002::bigint, 888000000002::bigint, 'thief')),
  '0212: a spent code redeems nothing');

-- expired
insert into echo.telegram_link_code (org_id, user_id, code_hash, created_at, expires_at)
values ('0a000000-0000-4000-8000-00000000000a',
        '01000000-0000-4000-8000-000000000001',
        'test-0212-stale-hash', now() - interval '1 hour', now() - interval '45 minutes');
select t.ok(
  (select count(*) = 0 from echo.redeem_telegram_link(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 'test-0212-stale-hash',
     888000000003::bigint, 888000000003::bigint, 'late')),
  '0212: an expired code redeems nothing');

-- unknown
select t.ok(
  (select count(*) = 0 from echo.redeem_telegram_link(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 'test-0212-never-existed',
     888000000004::bigint, 888000000004::bigint, 'guess')),
  '0212: an unknown code redeems nothing — and all three answer the same way');

-- a code minted in ANOTHER org cannot be redeemed against this one
insert into echo.telegram_link_code (org_id, user_id, code_hash, expires_at)
values ('0b000000-0000-4000-8000-00000000000b',
        '05000000-0000-4000-8000-000000000005',
        'test-0212-orgb-hash', now() + interval '10 minutes');
select t.ok(
  (select count(*) = 0 from echo.redeem_telegram_link(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 'test-0212-orgb-hash',
     888000000005::bigint, 888000000005::bigint, 'erin')),
  '0212: a code from another organisation is not a key to this one');
/* ...and the control: it IS a live code, so the refusal above is about the
   ORG and not about the code being stale. Without this the assertion passes
   against a function that refuses everything. */
select t.ok(
  (select count(*) = 1 from echo.redeem_telegram_link(
     '0b000000-0000-4000-8000-00000000000b'::uuid, 'test-0212-orgb-hash',
     888000000005::bigint, 888000000005::bigint, 'erin')),
  '0212: and that same code works in the organisation it was minted in');

-- ── ONE LIVE CODE PER PERSON ──────────────────────────────────────────────
insert into echo.telegram_link_code (org_id, user_id, code_hash, expires_at)
values ('0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        'test-0212-first', now() + interval '10 minutes');
select t.raises(
  $$insert into echo.telegram_link_code (org_id, user_id, code_hash, expires_at)
    values ('0a000000-0000-4000-8000-00000000000a',
            '02000000-0000-4000-8000-000000000002',
            'test-0212-second', now() + interval '10 minutes')$$,
  '23505', '0212: a second live code for one person is refused by the index');

-- ── RE-LINKING REPLACES, IT DOES NOT ACCUMULATE ───────────────────────────
--
-- Somebody who changes phone number expects the old account to stop working.
-- Two rows would also be refused by the unique index with an error they
-- cannot act on, so the door deletes first — asserted from BOTH sides: the
-- new account answers and the old one does not.
select linked_user_id from echo.redeem_telegram_link(
  '0a000000-0000-4000-8000-00000000000a'::uuid, 'test-0212-first',
  777000000099::bigint, 777000000099::bigint, 'bob_new');
select t.ok(
  (select count(*) = 1 from echo.telegram_identity
    where user_id = '02000000-0000-4000-8000-000000000002'),
  '0212: re-linking leaves one row, not two');
select t.ok(
  (select count(*) = 1 from echo.telegram_identity_for(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 777000000099::bigint)),
  '0212: the new account answers');
select t.ok(
  (select count(*) = 0 from echo.telegram_identity_for(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 777000000001::bigint)),
  '0212: and the old one has stopped');

-- ── A DISABLED COLLEAGUE'S PHONE STOPS SPEAKING FOR THEM ──────────────────
--
-- The door joins app_user on `status = 'active'` deliberately: a link is not
-- revoked when somebody is disabled, and if the door ignored status their
-- phone would keep filing work after their account was closed.
update echo.app_user set status = 'disabled'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select count(*) = 0 from echo.telegram_identity_for(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 777000000099::bigint)),
  '0212: a disabled colleague''s linked phone resolves to nobody');
update echo.app_user set status = 'active'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select count(*) = 1 from echo.telegram_identity_for(
     '0a000000-0000-4000-8000-00000000000a'::uuid, 777000000099::bigint)),
  '0212: and it speaks again when they are active — the discriminating half');

-- ── THE PURGE NAMES BOTH TABLES ───────────────────────────────────────────
select t.ok(
  position('delete from echo.telegram_identity' in (
    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.proname = 'platform_purge_org')) > 0,
  '0212: the purge deletes links');
select t.ok(
  position('delete from echo.telegram_link_code' in (
    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.proname = 'platform_purge_org')) > 0,
  '0212: and codes');

-- ── the fixture leaves nothing behind ─────────────────────────────────────
delete from echo.telegram_identity
 where telegram_user_id in (777000000001, 777000000099, 888000000005);
delete from echo.telegram_link_code where code_hash like 'test-0212-%';
