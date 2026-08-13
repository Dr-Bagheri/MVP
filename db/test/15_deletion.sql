-- M11's deletion rule, both halves.
--
-- "Admins may delete any recording, including members' private ones; members
-- delete only their own." The suite tested the admin half and the
-- members-cannot-touch-others half, and never the plain case — a member
-- deleting their own call — which turned out to be the broken one. A rule with
-- two halves needs two tests; asserting the privileged path and the refused
-- path leaves the ordinary path unproven, and the ordinary path is the product.

reset role;
set local role echo_app;

-- --- a member deletes their own call ---------------------------------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.ok(
  echo.soft_delete_call('c1000000-0000-4000-8000-000000000001'),
  'a member deletes their own call');

-- And it is then gone for them, per Q2 as ruled: deletion feels like deletion.
select t.ok(
  not exists (select 1 from echo.call where id = 'c1000000-0000-4000-8000-000000000001'),
  'and it disappears for them — only an admin sees it in the purge window');
select t.ok(
  not echo.soft_delete_call('c1000000-0000-4000-8000-000000000001'),
  'deleting it again is false, not an error — a retry is not a failure');

-- --- the admin sees it, with the stamp on it -------------------------------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select deleted_by = '02000000-0000-4000-8000-000000000002'
      and purge_after > now() + interval '29 days'
     from echo.call where id = 'c1000000-0000-4000-8000-000000000001'),
  'the record says who deleted it and when its window closes');

-- --- an admin deletes a call they do not own -------------------------------
select t.ok(
  echo.soft_delete_call('c3000000-0000-4000-8000-000000000003'),
  'an admin deletes a member''s private recording (M11)');

-- --- a member cannot delete anyone else's ----------------------------------
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.denied(
  $$select echo.soft_delete_call('c2000000-0000-4000-8000-000000000002')$$,
  'a member cannot delete an org-scoped call they can read but do not own');
select t.denied(
  $$select echo.soft_delete_call('c1000000-0000-4000-8000-000000000001')$$,
  'nor one they cannot see at all — and the refusal is the same either way, so it reveals nothing');

-- --- restoring is the admin's (Q2) -----------------------------------------
select t.denied(
  $$select echo.restore_call('c3000000-0000-4000-8000-000000000003')$$,
  'a member cannot restore, even their own');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  echo.restore_call('c3000000-0000-4000-8000-000000000003'),
  'an admin restores it');
select t.ok(
  not echo.restore_call('c3000000-0000-4000-8000-000000000003'),
  'restoring a live call is false, not an error');
select t.ok(
  (select deleted_by is null and purge_after is null
     from echo.call where id = 'c3000000-0000-4000-8000-000000000003'),
  'and the delete stamp is cleared with it, so nothing carries a stale claim');

-- --- one path, not two -----------------------------------------------------
-- The UPDATE route worked for admins and failed for owners, which is exactly
-- how the bug survived: a path that succeeds for the privileged caller looks
-- correct from wherever it was tested.
select t.denied(
  $$update echo.call set deleted_at = now()
     where id = 'c2000000-0000-4000-8000-000000000002'$$,
  'setting deleted_at directly is refused, for admins too — there is one door');
select t.denied(
  $$update echo.call set deleted_at = null
     where id = 'c5000000-0000-4000-8000-000000000005'$$,
  'and so is un-setting it');

-- --- the agent deletes nothing, ever ---------------------------------------
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select echo.soft_delete_call('c2000000-0000-4000-8000-000000000002')$$,
  'the agent has no execute on the delete path — a named operation is not a loophole');

reset role;
