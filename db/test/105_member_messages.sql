-- db/0167 — one member sends another a message.
--
-- The migration's own self-checks run against whatever the database happens to
-- hold, and print "did not run, result unknown" when it holds no org with two
-- active members. That is the honest thing for a migration and a bad thing for
-- a standing check, so this file SEEDS ITS OWN (rule 9): the fixture orgs are
-- here, the actors are named, and the result is never a function of what was
-- lying around.
--
-- The whole matrix, because the ordinary path is the product: the message
-- lands, addressed to the colleague and stamped with the sender; a message to
-- oneself, to an empty string, to a suspended colleague, to another org's
-- member and to nobody at all are all refused; and the WALL behind the door
-- has not moved — echo_app still cannot write a card for anybody but itself,
-- which is the reason the door exists.

reset role;

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0167 message tests run under a non-bypass product role');

-- ─── THE ORDINARY PATH ──────────────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select set_config('echo.actor_org_id', '0a000000-0000-4000-8000-00000000000a', true);
select echo.send_member_message(
  '03000000-0000-4000-8000-000000000003', 'جلسه به ساعت ۳ منتقل شد');

reset role; -- read at owner altitude: the recipient's inbox is not the
            -- sender's to see, so a check run below the wall would be
            -- measuring RLS rather than the door
select t.ok(
  exists (
    select 1 from echo.agent_card
     where owner_id = '03000000-0000-4000-8000-000000000003'
       and from_user_id = '02000000-0000-4000-8000-000000000002'
       and kind = 'member_message'
       and body = 'جلسه به ساعت ۳ منتقل شد'
       and read_at is null
  ),
  '0167: the message lands as an unread card in the RECIPIENT''s inbox, stamped with its sender');

-- ─── the sender is stamped, never supplied ──────────────────────────────
-- There is no argument for it, so this asserts the shape rather than an
-- attempt: a two-argument signature is what makes "who sent this" unforgeable,
-- and a third argument appearing later would silently make it forgeable again.
select t.ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'echo' and p.proname = 'send_member_message'
      and p.pronargs = 2) = 1,
  '0167: the door takes the recipient and the text — and nothing that names the sender');

-- ─── the refusals ───────────────────────────────────────────────────────
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select set_config('echo.actor_org_id', '0a000000-0000-4000-8000-00000000000a', true);

select t.denied(
  $$select echo.send_member_message('02000000-0000-4000-8000-000000000002', 'به خودم')$$,
  '0167: a message to oneself is refused — that is a task, and the platform has tasks');
select t.denied(
  $$select echo.send_member_message('03000000-0000-4000-8000-000000000003', '   ')$$,
  '0167: an empty message is refused');
select t.denied(
  $$select echo.send_member_message('05000000-0000-4000-8000-000000000005', 'سلام همسایه')$$,
  '0167: a message to another organisation''s member is refused');
select t.denied(
  $$select echo.send_member_message('ffffffff-0000-4000-8000-00000000ffff', 'به هیچ‌کس')$$,
  '0167: a message to somebody who does not exist is refused — with the SAME sentence as the two above, so this is not an oracle for who is on the platform');

-- ─── THE WALL, still standing ───────────────────────────────────────────
-- The door exists BECAUSE this is refused. If the direct insert ever starts
-- working, the door stops being the only way a card reaches somebody else and
-- every guarantee written into it becomes advisory.
select t.denied(
  $$insert into echo.agent_card (org_id, owner_id, kind, title)
    values ('0a000000-0000-4000-8000-00000000000a',
            '03000000-0000-4000-8000-000000000003', 'weekly_digest', 'direct')$$,
  '0167: echo_app still cannot write a card into a colleague''s inbox directly');

-- ─── and the agent has no key to this door ──────────────────────────────
-- "Auto for reads, approval for writes" (user ruling, 2026-09-03) is only true
-- if the write cannot be reached from inside the model loop. The agent role
-- holding EXECUTE here would make the approval a matter of the prompt.
reset role;
select t.ok(
  not exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     join pg_roles r on r.oid = a.grantee
    where n.nspname = 'echo' and p.proname = 'send_member_message'
      and a.privilege_type = 'EXECUTE' and r.rolname = 'echo_agent'
  ),
  '0167: echo_agent cannot execute the door — the agent proposes a message, the person''s own session sends it');

delete from echo.agent_card
 where owner_id = '03000000-0000-4000-8000-000000000003'
   and kind = 'member_message';
