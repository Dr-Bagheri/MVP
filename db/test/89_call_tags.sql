-- 0086: tags — shape wall + the 0077 hierarchy governing them.

-- an ORG-SCOPED call owned by dave (admin): the refusal case below needs a
-- row bob can SEE but not outrank — on an invisible row, writes-nothing
-- would only re-prove invisibility; on a readable one it proves the UPDATE
-- policy itself (0013: owner-or-admin) is what filters below admin rank
reset role;
insert into echo.call (id, org_id, owner_id, title, scope, status) values
  ('c8600000-0000-4000-8000-000000000086', '0a000000-0000-4000-8000-00000000000a',
   '06000000-0000-4000-8000-000000000006', 'جلسهٔ مدیران', 'org', 'ready');
set local role echo_app;

-- ── the ORDINARY path first (the ordinary path is the product):
--    a member tags their own record ─────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.call set tags = array['پروژهٔ الف', 'client-x']
 where id = 'c1000000-0000-4000-8000-000000000001';
select t.ok(
  (select tags from echo.call where id = 'c1000000-0000-4000-8000-000000000001')
    = array['پروژهٔ الف', 'client-x'],
  'a member tags their own record and reads the tags back');

-- and the filter shape the index serves: array-contains
select t.ok(
  exists (select 1 from echo.call
           where id = 'c1000000-0000-4000-8000-000000000001'
             and tags @> array['client-x']),
  'array-contains finds the tagged record — the filter''s own operator');

-- ── shape wall ─────────────────────────────────────────────────────────────
select t.denied(
  $$update echo.call set tags = array['', 'ok']
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'an empty tag is refused');
select t.denied(
  $$update echo.call set tags = array[' padded ']
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'an untrimmed tag is refused');
select t.denied(
  $$update echo.call set tags = array[repeat('x', 41)]
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'a 41-character tag is refused');
select t.denied(
  $$update echo.call set tags = array['dup', 'dup']
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'duplicate tags are refused');
select t.denied(
  $$update echo.call
      set tags = array['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11']
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'an eleventh tag is refused — the bound is 10');

-- ── the hierarchy governs tags like every other column ────────────────────
-- bob (member) on the ADMIN's org-scoped call: readable, yet the update
-- policy filters it — below admin rank the denial is zero rows; from admin
-- rank up the 0077 guard raises (64_call_role_hierarchy proves that side)
select t.ok(
  exists (select 1 from echo.call where id = 'c8600000-0000-4000-8000-000000000086'),
  'a member can SEE the admin''s org-scoped record...');
select t.writes_nothing(
  $$update echo.call set tags = array['نفوذ']
     where id = 'c8600000-0000-4000-8000-000000000086'$$,
  '...and still cannot tag it — a record whose owner outranks you is not yours to tag (0077, filtered not raised)');

-- the owner (alice) tags bob's record: outranks, allowed
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
update echo.call set tags = array['بازبینی']
 where id = 'c1000000-0000-4000-8000-000000000001';
select t.ok(
  (select tags from echo.call where id = 'c1000000-0000-4000-8000-000000000001')
    = array['بازبینی'],
  'the owner re-tags a member''s record — outranking, the same rule as rename');

-- sweep: leave the fixture as we found it
update echo.call set tags = '{}'
 where id = 'c1000000-0000-4000-8000-000000000001';
reset role;
delete from echo.call where id = 'c8600000-0000-4000-8000-000000000086';
set local role echo_app;
