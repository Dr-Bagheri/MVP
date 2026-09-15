-- db/0221 — the conversation LIST is the conversations a person had.
--
-- 0074's post-call brief opens a session so its text has a home and its card
-- has something to point at. That session then appeared in the owner's
-- sidebar, one row per processed recording, titled after the meeting — four
-- of them in a single rehearsal, which is not the expected behaviour.
--
-- This file holds the two halves apart, because a fix that confused them
-- would pass a one-sided check either way:
--
--   · a brief is NOT in the list          — the defect
--   · a brief is still READABLE           — what makes exclusion the right
--                                           fix instead of deletion
--   · a person's own chat IS in the list  — the control without which
--                                           "excluded" is satisfied by a
--                                           predicate that empties every
--                                           sidebar in the product
--   · a brief they REPLIED to is in the list — the second arm; without it,
--                                           «می‌توانید همین‌جا درباره‌اش
--                                           بپرسید» invites somebody to
--                                           start a conversation that is
--                                           then buried forever
--
-- 0221's own self-checks ran once, on the day it was applied. They cannot see
-- the function replaced or the column's check widened two migrations from now,
-- which is the edit they exist for (the 0189 lesson). This is that standing
-- test, and it calls the SAME function core/'s `sessions.list()` calls — one
-- spelling of the rule, never a copy that agrees with itself (db/0048).

reset role;

-- Three sessions for ALICE, differing in exactly what the rule reads. B and C
-- both carry a delivered brief, so "has any message" cannot pass for the rule:
-- only the human turn separates them.
insert into echo.agent_session (id, org_id, actor_id, title, origin) values
  ('c0000000-0000-4000-8000-00000000000a',
   '0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001',
   'یک گفت‌وگوی تازه', 'user'),
  ('c0000000-0000-4000-8000-00000000000b',
   '0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001',
   'خلاصهٔ آمادهٔ «جلسهٔ هفتگی»', 'agent'),
  ('c0000000-0000-4000-8000-00000000000c',
   '0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001',
   'خلاصهٔ آمادهٔ «جلسهٔ فروش»', 'agent');

insert into echo.agent_message (session_id, org_id, seq, role, content) values
  ('c0000000-0000-4000-8000-00000000000b',
   '0a000000-0000-4000-8000-00000000000a', 0, 'assistant', 'خلاصه آماده است.'),
  ('c0000000-0000-4000-8000-00000000000c',
   '0a000000-0000-4000-8000-00000000000a', 0, 'assistant', 'خلاصه آماده است.'),
  -- C is the one she answered, so C is a conversation she had.
  ('c0000000-0000-4000-8000-00000000000c',
   '0a000000-0000-4000-8000-00000000000a', 1, 'user', 'دربارهٔ قیمت چه گفتند؟');

-- The card is what makes the excluded row reachable. Without it the honest
-- answer would be "do not create the session at all", and this row is the
-- reason that answer is wrong.
insert into echo.agent_card (org_id, owner_id, kind, title, session_id) values
  ('0a000000-0000-4000-8000-00000000000a', '01000000-0000-4000-8000-000000000001',
   'post_call_brief', 'خلاصهٔ آمادهٔ «جلسهٔ هفتگی»',
   'c0000000-0000-4000-8000-00000000000b');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0221 tests run under a non-bypass product role');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice

-- ─── the rule, all three arms ───────────────────────────────────────────────
select t.ok(
  (select echo.session_belongs_in_history(origin, id) from echo.agent_session
    where id = 'c0000000-0000-4000-8000-00000000000a'),
  '0221: a conversation she opened is in her list, even with nothing said in it yet');

select t.ok(
  not (select echo.session_belongs_in_history(origin, id) from echo.agent_session
        where id = 'c0000000-0000-4000-8000-00000000000b'),
  '0221: a brief she never answered is NOT in her list — the defect');

select t.ok(
  (select echo.session_belongs_in_history(origin, id) from echo.agent_session
    where id = 'c0000000-0000-4000-8000-00000000000c'),
  '0221: a brief she DID answer is in her list — the reply the brief invites is a conversation');

-- ─── excluded is not gone ───────────────────────────────────────────────────
-- The whole argument for filtering rather than deleting. If any of these three
-- stopped holding, the sidebar would be tidy and the brief would be lost.
select t.ok(
  exists (select 1 from echo.agent_session
           where id = 'c0000000-0000-4000-8000-00000000000b'),
  '0221: the excluded session is still her row — a filter, not a delete');

select t.ok(
  exists (select 1 from echo.agent_message
           where session_id = 'c0000000-0000-4000-8000-00000000000b'),
  '0221: the excluded session''s brief still reads — the card opens onto text, not onto nothing');

select t.ok(
  exists (select 1 from echo.agent_card
           where session_id = 'c0000000-0000-4000-8000-00000000000b'),
  '0221: the card still points at it — the notification surface is unchanged');

-- ─── the column refuses a third value ───────────────────────────────────────
-- Named by SQLSTATE rather than t.denied: a typo in the statement also raises,
-- and would be recorded as the constraint doing its job.
select t.raises(
  $$insert into echo.agent_session (org_id, actor_id, origin)
    values ('0a000000-0000-4000-8000-00000000000a',
            '01000000-0000-4000-8000-000000000001', 'machine')$$,
  '23514',
  '0221: origin refuses a value that is neither user nor agent');

-- ─── the door is the caller's, not a definer's ──────────────────────────────
-- The function reads agent_message, so if it ever became SECURITY DEFINER it
-- would answer about threads its caller cannot see. Structure, asserted before
-- somebody adds the words to make an EXISTS cheaper.
reset role;
select t.ok(
  (select prosecdef = false from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'echo' and p.proname = 'session_belongs_in_history'),
  '0221: the history rule runs as its CALLER — a list predicate is not a door');
