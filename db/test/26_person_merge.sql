-- 0096: merging two directory people — 0005's design, finally performed.
--
-- The matrix, and the properties that make a merge safe:
--   member: refused · admin: allowed
--   the loser KEEPS its id and points at the winner (nothing that
--   referenced it breaks) · its voices move to the winner · a chain never
--   forms (a person merged into the loser follows to the winner).

reset role;
set local role echo_app;

-- --- a second person, and a voice pointing at them ------------------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
insert into echo.person (id, org_id, display_name, created_by) values
  ('f2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
   'رضا محمّدی', '02000000-0000-4000-8000-000000000002');
-- bob owns c1, so bob may link its voice (M11)
update echo.call_speaker set person_id = 'f2000000-0000-4000-8000-000000000002'
 where id = 'e1000000-0000-4000-8000-000000000001';

-- --- a member cannot merge ------------------------------------------------
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.writes_nothing(
  $$select echo.merge_person(
      'f2000000-0000-4000-8000-000000000002',
      'f1000000-0000-4000-8000-000000000001')$$,
  'a member cannot merge two people (the role wall lives in the door)');

-- --- nor can anyone merge a person into themselves ------------------------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.writes_nothing(
  $$select echo.merge_person(
      'f1000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000001')$$,
  'a person cannot be merged into themselves');

-- --- the admin merges, and the voice follows ------------------------------
select echo.merge_person(
  'f2000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000001');

select t.ok(
  (select merged_into = 'f1000000-0000-4000-8000-000000000001'
      and merged_by = '01000000-0000-4000-8000-000000000001'
      and merged_at is not null
     from echo.person where id = 'f2000000-0000-4000-8000-000000000002'),
  'the loser keeps its id and points at the winner (0005''s shape)');

select t.ok(
  (select person_id = 'f1000000-0000-4000-8000-000000000001'
     from echo.call_speaker where id = 'e1000000-0000-4000-8000-000000000001'),
  'the voice that pointed at the loser now points at the winner');

select t.ok(
  (select linked_by = '01000000-0000-4000-8000-000000000001'
     from echo.call_speaker where id = 'e1000000-0000-4000-8000-000000000001'),
  'and the link''s provenance names the merge''s actor, not the old linker');

-- --- a second merge does not build a CHAIN --------------------------------
insert into echo.person (id, org_id, display_name, created_by) values
  ('f3000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a',
   'reza m', '01000000-0000-4000-8000-000000000001');
select echo.merge_person(
  'f1000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000003');
select t.ok(
  (select merged_into = 'f3000000-0000-4000-8000-000000000003'
     from echo.person where id = 'f2000000-0000-4000-8000-000000000002'),
  'the first loser follows the chain forward — merged_into is always one hop');

-- --- the merged-away are gone from the directory's own view ---------------
select t.ok(
  (select count(*)::int from echo.person
    where org_id = '0a000000-0000-4000-8000-00000000000a' and merged_into is null) = 1,
  'only the surviving person remains listable in that org');
