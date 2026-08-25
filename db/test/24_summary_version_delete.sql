-- 0095: the delete_summary_version door — the whole matrix, and the pointer.
--
-- Versions stay append-only for writers; the door is the ONLY exit. Walk it:
--   member with read: refused · admin: allowed · owner: allowed
--   pointer: deleting the current version repoints to the newest survivor,
--   and deleting the last one leaves an honest NULL.

reset role;
set local role echo_app;

-- --- seed: give bob's org-scoped call c2 a second, newer version ----------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
insert into echo.summary (id, call_id, org_id, version, body, model, created_by) values
  ('b2000000-0000-4000-8000-00000000002b', 'c2000000-0000-4000-8000-000000000002',
   '0a000000-0000-4000-8000-00000000000a', 2, 'خلاصه نسخه دو', 'test/model',
   '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select current_summary_id = 'b2000000-0000-4000-8000-00000000002b'
     from echo.call where id = 'c2000000-0000-4000-8000-000000000002'),
  'the 0008 trigger moved the pointer to the new version');

-- --- carol (member, can read the org call) is refused ---------------------
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.writes_nothing(
  $$select echo.delete_summary_version(
      'c2000000-0000-4000-8000-000000000002', 2)$$,
  'org scope shares the summary, not the knife: member delete refused');

-- --- the ADMIN may delete (call-edit shape, 0093 family) ------------------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select echo.delete_summary_version('c2000000-0000-4000-8000-000000000002', 2);
select t.ok(
  not exists (select 1 from echo.summary
               where id = 'b2000000-0000-4000-8000-00000000002b'),
  'an admin deletes a version through the door');
select t.ok(
  (select current_summary_id = 'b2000000-0000-4000-8000-000000000002'
     from echo.call where id = 'c2000000-0000-4000-8000-000000000002'),
  'the pointer repointed to the newest survivor in the same act');

-- --- a version that does not exist is a loud nothing ----------------------
select t.writes_nothing(
  $$select echo.delete_summary_version(
      'c2000000-0000-4000-8000-000000000002', 9)$$,
  'deleting a version that never existed raises rather than shrugs');

-- --- the OWNER deletes the last one; the pointer goes honestly null -------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select echo.delete_summary_version('c2000000-0000-4000-8000-000000000002', 1);
select t.ok(
  (select current_summary_id is null
     from echo.call where id = 'c2000000-0000-4000-8000-000000000002'),
  'no versions left = no current summary — null, never a stale pointer');
