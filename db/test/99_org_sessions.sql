-- db/0135 — an admin sees the org signed in, and ends only what they outrank.
--
-- The two rules are DIFFERENT on purpose and this file's job is to hold them
-- apart: reading is org-wide, ending is rank-bound. A suite that only proved
-- "an admin can end a session" would pass against a door that let an admin
-- sign the owner out, which is the one case a person would call a bug.
--
-- The fixture already carries the whole hierarchy — alice is the OWNER, dave
-- an ADMIN, bob and carol members — so the same-rank and higher-rank cases
-- are real rows rather than a story about roles.

reset role;

-- Live sessions for the owner and the admin. 0125's door serves only a
-- session that CAN STILL REFRESH, so each needs an unrevoked token: a bare
-- session row is a dead one, and a fixture that skipped this would be
-- testing an empty list very thoroughly.
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent, ip)
values ('99000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000001', now(), now(),
        'Mozilla/5.0 Safari/605', '203.0.113.11'),
       ('99000000-0000-4000-8000-000000000002',
        '06000000-0000-4000-8000-000000000006', now(), now(),
        'Mozilla/5.0 Chrome/140', '203.0.113.12'),
       -- and a MEMBER, seeded here rather than borrowed from 96's fixture.
       -- The first version of this file leaned on that one and went red:
       -- a check that depends on ambient data is a check that passes or
       -- fails on what ran before it, and this one must be runnable alone.
       ('99000000-0000-4000-8000-000000000003',
        '02000000-0000-4000-8000-000000000002', now(), now(),
        'Mozilla/5.0 Firefox/141', '203.0.113.13');

insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
values ('99-fixture-token-alice',
        '01000000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000001', false, now(), now()),
       ('99-fixture-token-dave',
        '06000000-0000-4000-8000-000000000006',
        '99000000-0000-4000-8000-000000000002', false, now(), now()),
       ('99-fixture-token-bob',
        '02000000-0000-4000-8000-000000000002',
        '99000000-0000-4000-8000-000000000003', false, now(), now());

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0135 tests run under a non-bypass product role');

-- ─── reading is org-wide for an admin ───────────────────────────────────
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave (admin)

select t.ok(
  exists (select 1 from echo.org_auth_sessions()
           where user_id = '01000000-0000-4000-8000-000000000001'),
  '0135: an admin SEES the owner''s session — a security surface that hides rows cannot be reasoned from');

select t.ok(
  exists (select 1 from echo.org_session_presence()
           where user_id = '02000000-0000-4000-8000-000000000002'),
  '0135: presence names a member who is signed in');

-- The property the whole feature turns on, asserted as a DIFFERENCE rather
-- than as two separate truths: the same admin, the same list, two answers.
select t.ok(
  (select can_end from echo.org_auth_sessions()
    where user_id = '02000000-0000-4000-8000-000000000002' limit 1) is true
  and (select can_end from echo.org_auth_sessions()
        where user_id = '01000000-0000-4000-8000-000000000001' limit 1) is false,
  '0135: can_end differs per row — an admin may end a member''s session and not the owner''s');

-- ─── ending is rank-bound ───────────────────────────────────────────────
select t.denied(
  $$select echo.end_member_session('01000000-0000-4000-8000-000000000001', '99000000')$$,
  '0135: an admin cannot end the OWNER''s session');

-- same rank is not "outranks": strictly-greater is the rule (0077)
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice (owner)
select t.ok(
  echo.end_member_session('06000000-0000-4000-8000-000000000006', '99000000'),
  '0135: the owner ends the admin''s session');

select t.ok(
  not exists (select 1 from echo.org_auth_sessions()
               where user_id = '06000000-0000-4000-8000-000000000006'),
  '0135: and it is gone from the list — the delete cascades the refresh token');

-- ─── a member reaches none of it ────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob (member)

-- RAISES rather than returning zero rows, deliberately: an empty set would
-- render as "nobody in this org is signed in", which is a claim about the
-- ORGANISATION assembled out of a fact about the caller's PERMISSIONS.
select t.denied(
  $$select * from echo.org_auth_sessions()$$,
  '0135: a member cannot read the org''s sessions — and is refused, not answered empty');
select t.denied(
  $$select * from echo.org_session_presence()$$,
  '0135: a member cannot read presence either');
select t.denied(
  $$select echo.end_member_session('01000000-0000-4000-8000-000000000001', '99000000')$$,
  '0135: a member cannot end anyone else''s session');

-- their OWN is still theirs, through the door that was always for that
select t.ok(
  exists (select 1 from echo.my_auth_sessions() where ip = '203.0.113.13'),
  '0135: a member still sees their own session — the new doors took nothing away');

reset role;

-- sweep this file's own residue (alice's row; dave's was ended by the test)
delete from auth.sessions
 where id in ('99000000-0000-4000-8000-000000000001',
              '99000000-0000-4000-8000-000000000002',
              '99000000-0000-4000-8000-000000000003');
