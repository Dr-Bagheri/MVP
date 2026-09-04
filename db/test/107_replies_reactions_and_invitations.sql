-- db/0189 — a reply, a reaction, and an invitation somebody answers.
--
-- 0189 shipped with self-checks in its own body, and self-checks run ONCE, on
-- the day the migration is applied. They cannot see a policy dropped and
-- recreated two migrations later, which is the edit this file exists for.
-- Rule 5: an RLS change ships with its SQL test, and the test is the half
-- that keeps running.
--
-- THE WHOLE MATRIX, both directions, for each of the three walls:
--
--   alice  owner,  org A  — neither invitee nor inviter, and the one this
--                           file most wants refused: an admin who could read
--                           the org's invitations would turn a courtesy into
--                           surveillance, and "an admin can see everything"
--                           is the rule 0189 deliberately does not have here
--   dave   admin,  org A  — may fill a room
--   bob    member, org A, ACTIVE — the ordinary member; ACTIVE is
--                           load-bearing (106's lesson: a PENDING fixture
--                           would make every refusal measure actor_is_active
--                           instead of the rule under test)
--   carol  member, org A, ACTIVE — the invitee, the only person who answers
--   erin   owner,  org B  — a stranger with the highest role there is, whose
--                           refusal is what proves the org wall did not
--                           quietly become the only wall

reset role;

-- ─── the room this file is about, seeded from ABOVE the wall ────────────
insert into echo.chat_channel (id, org_id, name, created_by) values
  ('a7000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-00000000000a',
   'اتاق آزمون', '01000000-0000-4000-8000-000000000001');

insert into echo.chat_message (id, org_id, channel_id, author_kind, author_id, body) values
  ('a7000000-0000-4000-8000-0000000000d1', '0a000000-0000-4000-8000-00000000000a',
   'a7000000-0000-4000-8000-0000000000c1', 'user',
   '02000000-0000-4000-8000-000000000002', 'کی جلسه را می‌گیرد؟'),
  ('a7000000-0000-4000-8000-0000000000d2', '0a000000-0000-4000-8000-00000000000a',
   'a7000000-0000-4000-8000-0000000000c1', 'user',
   '03000000-0000-4000-8000-000000000003', 'من می‌گیرم');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0189 tests run under a non-bypass product role');

-- ═══ REACTIONS ══════════════════════════════════════════════════════════
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

insert into echo.chat_reaction (message_id, user_id, emoji, org_id)
values ('a7000000-0000-4000-8000-0000000000d1', echo.actor_id(), '👍', echo.actor_org_id());
select t.ok(
  exists (select 1 from echo.chat_reaction
           where message_id = 'a7000000-0000-4000-8000-0000000000d1'::uuid
             and user_id = '02000000-0000-4000-8000-000000000002'),
  '0189: a member reacts to a colleague''s message');

/* PUTTING AN OPINION IN SOMEBODY ELSE'S MOUTH. The policy names the actor on
   both sides, so this is unrepresentable rather than merely refused — and it
   is an INSERT, which throws on WITH CHECK, so `denied` is the right shape. */
select t.denied(
  $$insert into echo.chat_reaction (message_id, user_id, emoji, org_id)
    values ('a7000000-0000-4000-8000-0000000000d1',
            '03000000-0000-4000-8000-000000000003', '🎉', echo.actor_org_id())$$,
  '0189: a member cannot react under a colleague''s name');

/* A SECOND PRESS IS A REMOVAL, and the primary key is what makes that true.
   The line above proved bob's own insert is ALLOWED, so this refusal can only
   be the key — which is the argument that keeps a generic `denied` honest
   here: without the passing insert before it, an RLS refusal would look
   identical. */
select t.denied(
  $$insert into echo.chat_reaction (message_id, user_id, emoji, org_id)
    values ('a7000000-0000-4000-8000-0000000000d1', echo.actor_id(), '👍', echo.actor_org_id())$$,
  '0189: the same person cannot leave the same emoji twice');

select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  (select count(*) from echo.chat_reaction
    where message_id = 'a7000000-0000-4000-8000-0000000000d1'::uuid) = 1,
  '0189: a colleague reads the reaction — the count is what a chip renders');
/* and cannot take it off: pressing somebody else's chip removes YOUR OWN
   reaction, never theirs. A DELETE walled by USING raises nothing — it
   matches zero rows — so this is `writes_nothing`, not `denied`. */
select t.writes_nothing(
  $$delete from echo.chat_reaction
     where message_id = 'a7000000-0000-4000-8000-0000000000d1'
       and user_id = '02000000-0000-4000-8000-000000000002'$$,
  '0189: a colleague cannot remove somebody else''s reaction');

select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin, org B
select t.ok(
  not exists (select 1 from echo.chat_reaction
               where message_id = 'a7000000-0000-4000-8000-0000000000d1'::uuid),
  '0189: another org''s owner sees no reaction at all');

-- ═══ INVITATIONS ════════════════════════════════════════════════════════
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, member

/* THE DIRECTIVE'S OWN WORDS: rooms are an admin's to fill. */
select t.denied(
  $$insert into echo.join_invite (org_id, kind, target_id, invitee_id, invited_by)
    values (echo.actor_org_id(), 'chat_channel', 'a7000000-0000-4000-8000-0000000000c1',
            '03000000-0000-4000-8000-000000000003', echo.actor_id())$$,
  '0189: a member cannot invite anybody to a room');

/* AND THE ORDINARY PATH, which is the product: arranging a meeting is not an
   administrative act, so any active member invites to one. Without this line
   the file would prove only that the wall refuses, and a policy that refused
   EVERYONE would pass every refusal above it. */
insert into echo.join_invite (org_id, kind, target_id, invitee_id, invited_by)
values (echo.actor_org_id(), 'meeting', 'a7000000-0000-4000-8000-0000000000e1',
        '03000000-0000-4000-8000-000000000003', echo.actor_id());
select t.ok(
  exists (select 1 from echo.join_invite
           where kind = 'meeting' and invited_by = '02000000-0000-4000-8000-000000000002'),
  '0189: any active member invites a colleague to a meeting');

/* A FACT ABOUT WHO DID SOMETHING MUST NOT BE SUPPLYABLE — the same rule
   every other author column in this schema carries. */
select t.denied(
  $$insert into echo.join_invite (org_id, kind, target_id, invitee_id, invited_by)
    values (echo.actor_org_id(), 'meeting', 'a7000000-0000-4000-8000-0000000000e2',
            '03000000-0000-4000-8000-000000000003',
            '06000000-0000-4000-8000-000000000006')$$,
  '0189: nobody can send an invitation under another person''s name');

select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, admin
insert into echo.join_invite (id, org_id, kind, target_id, invitee_id, invited_by)
values ('a7000000-0000-4000-8000-0000000000f1', echo.actor_org_id(), 'chat_channel',
        'a7000000-0000-4000-8000-0000000000c1',
        '03000000-0000-4000-8000-000000000003', echo.actor_id());
select t.ok(
  (select state from echo.join_invite
    where id = 'a7000000-0000-4000-8000-0000000000f1'::uuid) = 'pending',
  '0189: an admin invites a colleague to a room, and it waits');

/* ONLY THE INVITEE ANSWERS. Accepting on somebody's behalf is a membership
   they never agreed to — the entire thing this table exists to avoid — and
   the inviter is the person most likely to try. An UPDATE walled by USING is
   a legal no-op, so the assertion is on the RECORD as well as on the count. */
select t.writes_nothing(
  $$update echo.join_invite set state = 'accepted', responded_at = now()
     where id = 'a7000000-0000-4000-8000-0000000000f1'$$,
  '0189: the inviter cannot accept on the invitee''s behalf');
select t.ok(
  (select state from echo.join_invite
    where id = 'a7000000-0000-4000-8000-0000000000f1'::uuid) = 'pending',
  '0189: and the invitation is still waiting afterwards');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, OWNER
/* THE ONE THIS FILE MOST WANTS REFUSED. Alice is the most privileged person
   in the org and she is neither party: an invitation is addressed to one
   person, and an org's owner reading who is being pulled into what is
   surveillance wearing an administrator's hat. */
select t.ok(
  not exists (select 1 from echo.join_invite
               where id = 'a7000000-0000-4000-8000-0000000000f1'::uuid),
  '0189: the org owner cannot read an invitation she is not part of');
select t.writes_nothing(
  $$update echo.join_invite set state = 'declined'
     where id = 'a7000000-0000-4000-8000-0000000000f1'$$,
  '0189: nor answer one');

select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol, the invitee
select t.ok(
  (select count(*) from echo.join_invite
    where invitee_id = '03000000-0000-4000-8000-000000000003') = 2,
  '0189: the invitee sees both invitations addressed to her');
update echo.join_invite set state = 'accepted', responded_at = now()
 where id = 'a7000000-0000-4000-8000-0000000000f1'::uuid;
select t.ok(
  (select state from echo.join_invite
    where id = 'a7000000-0000-4000-8000-0000000000f1'::uuid) = 'accepted',
  '0189: the invitee answers her own invitation');

/* withdrawing is the INVITER's — and the invitee's "no" is the `declined`
   state rather than a delete, because a record that says nothing happened and
   a record that says they said no are different facts */
select t.writes_nothing(
  $$delete from echo.join_invite where id = 'a7000000-0000-4000-8000-0000000000f1'$$,
  '0189: the invitee cannot delete the invitation, only answer it');

select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, the inviter
delete from echo.join_invite where id = 'a7000000-0000-4000-8000-0000000000f1'::uuid;
select t.ok(
  not exists (select 1 from echo.join_invite
               where id = 'a7000000-0000-4000-8000-0000000000f1'::uuid),
  '0189: the inviter withdraws what they sent');

-- ═══ THE AGENT IS NOT IN THIS ROOM ══════════════════════════════════════
select t.ok(
  has_table_privilege('echo_agent', 'echo.chat_reaction', 'select')
  and not has_table_privilege('echo_agent', 'echo.chat_reaction', 'insert')
  and not has_table_privilege('echo_agent', 'echo.chat_reaction', 'update')
  and not has_table_privilege('echo_agent', 'echo.chat_reaction', 'delete'),
  '0189: the agent reads reactions and can never leave one');

/* a grant is not a policy (0178): the SELECT above is only real if a policy
   admits the role, and a table with a grant and no policy returns nothing
   while looking permitted */
select t.ok(
  exists (select 1 from pg_policies
           where schemaname = 'echo' and tablename = 'chat_reaction'
             and 'echo_agent' = any(roles)),
  '0189: and a policy admits it, not just a grant');

select t.ok(
  not has_table_privilege('echo_agent', 'echo.join_invite', 'select')
  and not has_table_privilege('echo_agent', 'echo.join_invite', 'insert')
  and not has_table_privilege('echo_agent', 'echo.join_invite', 'update')
  and not has_table_privilege('echo_agent', 'echo.join_invite', 'delete'),
  '0189: the agent cannot touch an invitation at all — an invitation is between two people');

-- ═══ THE REPLY'S FOREIGN KEY ════════════════════════════════════════════
/*
 * 0188's lesson, asserted as BEHAVIOUR rather than as constraint text. A
 * composite FK's cascade action applies to the whole key, so a plain
 * `set null` on `(reply_to_id, org_id)` would try to null a NOT NULL column
 * and could only ever raise — and the migration reads exactly the same
 * either way, which is why this is measured by deleting a parent.
 */
reset role;
insert into echo.chat_message (id, org_id, channel_id, author_kind, author_id, body, reply_to_id)
values ('a7000000-0000-4000-8000-0000000000d3', '0a000000-0000-4000-8000-00000000000a',
        'a7000000-0000-4000-8000-0000000000c1', 'user',
        '02000000-0000-4000-8000-000000000002', 'باشد', 'a7000000-0000-4000-8000-0000000000d2');

delete from echo.chat_message where id = 'a7000000-0000-4000-8000-0000000000d2'::uuid;
select t.ok(
  exists (select 1 from echo.chat_message where id = 'a7000000-0000-4000-8000-0000000000d3'::uuid)
  and (select org_id from echo.chat_message where id = 'a7000000-0000-4000-8000-0000000000d3'::uuid)
      = '0a000000-0000-4000-8000-00000000000a'::uuid
  and (select reply_to_id from echo.chat_message
        where id = 'a7000000-0000-4000-8000-0000000000d3'::uuid) is null,
  '0189: deleting the parent nulls the LINK, keeps the org, and keeps the answer');
