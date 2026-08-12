-- M11: the org's speaker directory is built from deliberate acts, never from
-- passive capture.
--
-- The subtle case is the admin. An admin can READ every call in the org,
-- including private ones. If reading were enough to link a voice, then simply
-- recording a private conversation would eventually put that person's voice
-- in the shared directory — exactly what the ruling forbids. So the link is
-- gated on ownership, not on readability.

reset role;
set local role echo_app;

-- --- the admin can read the call, and still cannot link its voices ---------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.ok(
  exists (select 1 from echo.call_speaker where id = 'e1000000-0000-4000-8000-000000000001'),
  'the admin can see the voices in a member''s private call');
-- Note the asymmetry: readable, but not addressable for writing. The row is
-- filtered out of the UPDATE entirely, so this is refused by RLS before the
-- ownership trigger is ever consulted. Both layers are tested — the trigger
-- on its own at the end of this file.
select t.writes_nothing(
  $$update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
     where id = 'e1000000-0000-4000-8000-000000000001'$$,
  'but cannot link one into the org directory — only the owner may (M11)');

-- --- another member who can read the org-scoped call cannot either ---------
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok(
  exists (select 1 from echo.call_speaker where id = 'e2000000-0000-4000-8000-000000000002'),
  'carol can see the voices in the org-scoped call');
select t.writes_nothing(
  $$update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
     where id = 'e2000000-0000-4000-8000-000000000002'$$,
  'org scope shares the recording, not the right to name its voices');

-- --- the owner links, and the act is recorded -----------------------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
 where id = 'e1000000-0000-4000-8000-000000000001';
select t.ok(
  (select person_id = 'f1000000-0000-4000-8000-000000000001'
      and linked_by = '02000000-0000-4000-8000-000000000002'
      and linked_at is not null
     from echo.call_speaker where id = 'e1000000-0000-4000-8000-000000000001'),
  'the owner links the voice, and the database stamps who did it and when');

-- Unlinking clears the record of the link with it.
update echo.call_speaker set person_id = null
 where id = 'e1000000-0000-4000-8000-000000000001';
select t.ok(
  (select linked_by is null and linked_at is null
     from echo.call_speaker where id = 'e1000000-0000-4000-8000-000000000001'),
  'unlinking a voice removes it from the directory cleanly');

-- --- the agent, acting for the owner, may link; for anyone else, may not ---
reset role;
set local role echo_agent;

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
 where id = 'e1000000-0000-4000-8000-000000000001';
select t.ok(
  (select linked_by from echo.call_speaker where id = 'e1000000-0000-4000-8000-000000000001')
    = '02000000-0000-4000-8000-000000000002',
  'the agent running as the owner may link — it borrows exactly that authority');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.writes_nothing(
  $$update echo.call_speaker set person_id = null
     where id = 'e1000000-0000-4000-8000-000000000001'$$,
  'the agent running as the admin cannot unlink a voice on a call the admin does not own');

-- --- a voice cannot be linked across org boundaries -----------------------
reset role;
set local role echo_app;
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.writes_nothing(
  $$update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
     where id = 'e1000000-0000-4000-8000-000000000001'$$,
  'and org B cannot reach into org A''s roster at all');

-- --- the ownership trigger, on its own -------------------------------------
-- Above, RLS refused these writes before the trigger was reached, so the
-- trigger's own rule is untested by them. Here we drop RLS out of the picture
-- (the migration role bypasses it) and leave only the trigger standing, so a
-- future loosening of the policy cannot quietly remove the M11 guarantee.
reset role;
-- Clear the link first, as its owner: the guard only fires on an actual
-- change, so re-setting person_id to the value it already holds would prove
-- nothing.
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.call_speaker set person_id = null
 where id = 'e1000000-0000-4000-8000-000000000001';

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.denied(
  $$update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
     where id = 'e1000000-0000-4000-8000-000000000001'$$,
  'with RLS out of the way, the trigger alone still refuses a non-owner the link');

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
 where id = 'e1000000-0000-4000-8000-000000000001';
select t.ok(
  (select linked_by from echo.call_speaker where id = 'e1000000-0000-4000-8000-000000000001')
    = '02000000-0000-4000-8000-000000000002',
  'and lets the owner through, so the guard is discriminating rather than merely strict');

select set_config('echo.actor_id', '', true);
reset role;
