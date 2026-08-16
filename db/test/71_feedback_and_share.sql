-- Feedback and share (0058, M27) — the whole matrix, not just the edges.
--
-- The M11 lesson applies verbatim here: the PRIVILEGED refusal (an admin
-- can't read) and the STRANGER refusal (another org can't read) are easy to
-- assert and don't prove the product. The ordinary paths — the owner judging
-- their own answer, a colleague reading a conversation that WAS shared —
-- are the product, and every one is walked below.

reset role;
set local role echo_app;

-- Self-seeded (rule 9 binds harnesses): this file creates the session it
-- tests rather than borrowing 70's — files each get the FIXTURE, not their
-- siblings' leftovers, and the first draft of this file learned that by
-- failing on a session another file had created.
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

insert into echo.agent_session (id, org_id, actor_id, title)
values ('61000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002', 'گفتگوی بازخورد');

insert into echo.agent_message (session_id, org_id, seq, role, content)
values ('61000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        0, 'user', 'خلاصه جلسه دیروز چه بود؟');

-- An assistant turn to judge: feedback is about answers, not questions.
insert into echo.agent_message (id, session_id, org_id, seq, role, content)
values ('62000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        1, 'assistant', 'سه موضوع مطرح شد.');

-- --- feedback: the ordinary path -------------------------------------------

insert into echo.agent_message_feedback (message_id, session_id, org_id, verdict, created_by)
values ('62000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        'up', '02000000-0000-4000-8000-000000000002');

select t.ok(
  (select verdict from echo.agent_message_feedback
    where message_id = '62000000-0000-4000-8000-000000000001') = 'up',
  'the owner judges their own answer');

-- Changing your mind is an UPDATE — the PK makes a second opinion a 23505,
-- so "one feedback per message" is structure, not discipline.
update echo.agent_message_feedback set verdict = 'down'
 where message_id = '62000000-0000-4000-8000-000000000001';
select t.ok(
  (select verdict from echo.agent_message_feedback
    where message_id = '62000000-0000-4000-8000-000000000001') = 'down',
  'changing your mind is an update, not a second row');

select t.denied(
  $q$ insert into echo.agent_message_feedback (message_id, session_id, org_id, verdict, created_by)
      values ('62000000-0000-4000-8000-000000000001',
              '61000000-0000-4000-8000-000000000001',
              '0a000000-0000-4000-8000-00000000000a',
              'up', '02000000-0000-4000-8000-000000000002') $q$,
  'a second feedback row on one message trips the primary key');

select t.denied(
  $q$ insert into echo.agent_message_feedback (message_id, session_id, org_id, verdict, created_by)
      values ('62000000-0000-4000-8000-000000000001',
              '61000000-0000-4000-8000-000000000001',
              '0a000000-0000-4000-8000-00000000000a',
              'meh', '02000000-0000-4000-8000-000000000002') $q$,
  'the verdict vocabulary is closed');

-- --- feedback: the walls ----------------------------------------------------

-- carol, same org, not the owner: the session is private, so its feedback is.
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok((select count(*) from echo.agent_message_feedback) = 0,
  'a colleague sees no feedback on a private conversation');
select t.writes_nothing(
  $q$ insert into echo.agent_message_feedback (message_id, session_id, org_id, verdict, created_by)
      values ('62000000-0000-4000-8000-000000000001',
              '61000000-0000-4000-8000-000000000001',
              '0a000000-0000-4000-8000-00000000000a',
              'up', '03000000-0000-4000-8000-000000000003') $q$,
  'and cannot judge a colleague''s answers');

-- --- share: nothing before the owner says so --------------------------------

select t.ok(
  (select count(*) from echo.shared_session_thread('61000000-0000-4000-8000-000000000001')) = 0,
  'the door answers nothing while no share exists');

-- carol cannot share bob's conversation for him.
select t.writes_nothing(
  $q$ insert into echo.agent_session_share (session_id, org_id, created_by)
      values ('61000000-0000-4000-8000-000000000001',
              '0a000000-0000-4000-8000-00000000000a',
              '03000000-0000-4000-8000-000000000003') $q$,
  'only the owner can share a conversation');

-- --- share: the ordinary path ----------------------------------------------

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
insert into echo.agent_session_share (session_id, org_id, created_by)
values ('61000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002');

-- carol, same org: the door opens exactly this wide.
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok(
  (select count(*) from echo.shared_session_meta('61000000-0000-4000-8000-000000000001')) = 1,
  'a colleague can see a shared conversation exists');
select t.ok(
  (select count(*) from echo.shared_session_thread('61000000-0000-4000-8000-000000000001')) = 2,
  'and read its thread through the door');
select t.ok(
  -- `is distinct from true`, not `= false`: a turn with no run at all derives
  -- NULL (both coalesce arms empty), and core maps that to false at the
  -- boundary — the invariant here is "no row CLAIMS truncation", because a
  -- false 'cut off' on a complete answer is its own lie.
  (select bool_and(truncated is distinct from true)
     from echo.shared_session_thread('61000000-0000-4000-8000-000000000001')),
  'the derived truncation marker travels through the door without lying');

-- The door is a READ: carol still cannot touch the rows themselves.
select t.ok((select count(*) from echo.agent_message) = 0,
  'the door does not open the table');

-- --- share: the other kinds of nobody --------------------------------------

-- erin, another org entirely.
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.ok(
  (select count(*) from echo.shared_session_thread('61000000-0000-4000-8000-000000000001')) = 0,
  'another org reads nothing through the door');

-- dan, same org but pending: not active, not anyone yet.
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true);
select t.ok(
  (select count(*) from echo.shared_session_thread('61000000-0000-4000-8000-000000000001')) = 0,
  'a pending member reads nothing through the door');

-- --- revocation --------------------------------------------------------------

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.agent_session_share set revoked_at = now()
 where session_id = '61000000-0000-4000-8000-000000000001';

select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok(
  (select count(*) from echo.shared_session_thread('61000000-0000-4000-8000-000000000001')) = 0,
  'a revoked share reads as no share at all');

-- --- the agent's nothing -----------------------------------------------------

reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $q$ select count(*) from echo.agent_message_feedback $q$,
  'the agent cannot read the human''s verdicts — a verdict must never become a prompt');
select t.denied(
  $q$ select count(*) from echo.agent_session_share $q$,
  'nor see who shared what');

reset role;
