-- db/0207 — a voiceprint keeps its takes, and the count cannot lie about them.
--
-- The migration's own self-checks ran once, on the day it was applied. What
-- they cannot see is a later migration dropping a check, or a column widening
-- until "voiceprint_samples" stops meaning "how many takes there are" — which
-- is exactly the drift these two constraints exist to prevent, since the
-- directory renders that number to a person deciding whether to record again.
--
-- The matrix:
--   · takes without a print are refused (a voice nothing can match);
--   · a count that disagrees with the takes is refused, BOTH ways;
--   · a print with matching takes is accepted — the ordinary path, without
--     which every refusal above is equally satisfied by a wall that refuses
--     everything;
--   · a ragged take list is unrepresentable, which is the property that made
--     a 2-D column the right shape;
--   · and withdrawing a voice clears both, or the delete raises and a person
--     cannot take their consent back.

reset role;

insert into echo.person (id, org_id, display_name, created_by)
values ('e1180000-0000-4000-8000-000000000118',
        '0a000000-0000-4000-8000-00000000000a',
        'صدای آزمایشی ۱۱۸',
        '01000000-0000-4000-8000-000000000001');

-- ─── the shape is there at all ───────────────────────────────────────────
select t.ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'echo' and table_name = 'person'
             and column_name = 'voiceprint_takes'),
  '0207: person.voiceprint_takes exists');

-- ─── takes require a print ───────────────────────────────────────────────
select t.raises(
  $$update echo.person
       set voiceprint_takes = array[array[1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0]]
     where id = 'e1180000-0000-4000-8000-000000000118'$$,
  '23514',
  '0207: takes with no voiceprint are refused');

-- ─── the count must equal the number of takes ────────────────────────────
select t.raises(
  $$update echo.person
       set voiceprint = array[1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0],
           voiceprint_model = 'test-118', voiceprint_at = now(),
           voiceprint_by = '01000000-0000-4000-8000-000000000001',
           voiceprint_samples = 5,
           voiceprint_takes = array[array[1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0],
                                    array[8.0,7.0,6.0,5.0,4.0,3.0,2.0,1.0]]
     where id = 'e1180000-0000-4000-8000-000000000118'$$,
  '23514',
  '0207: a count of 5 over 2 takes is refused');

-- the OTHER direction: a count SHORT of the takes is the same lie
select t.raises(
  $$update echo.person
       set voiceprint = array[1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0],
           voiceprint_model = 'test-118', voiceprint_at = now(),
           voiceprint_by = '01000000-0000-4000-8000-000000000001',
           voiceprint_samples = 1,
           voiceprint_takes = array[array[1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0],
                                    array[8.0,7.0,6.0,5.0,4.0,3.0,2.0,1.0]]
     where id = 'e1180000-0000-4000-8000-000000000118'$$,
  '23514',
  '0207: a count of 1 over 2 takes is refused');

-- ─── THE ORDINARY PATH ───────────────────────────────────────────────────
update echo.person
   set voiceprint = array[1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0],
       voiceprint_model = 'test-118', voiceprint_at = now(),
       voiceprint_by = '01000000-0000-4000-8000-000000000001',
       voiceprint_samples = 2,
       voiceprint_takes = array[array[1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0],
                                array[8.0,7.0,6.0,5.0,4.0,3.0,2.0,1.0]]
 where id = 'e1180000-0000-4000-8000-000000000118';

select t.ok(
  (select array_length(voiceprint_takes, 1) from echo.person
    where id = 'e1180000-0000-4000-8000-000000000118') = 2,
  '0207: two takes read back as two');
select t.ok(
  (select array_length(voiceprint_takes, 2) from echo.person
    where id = 'e1180000-0000-4000-8000-000000000118') = 8,
  '0207: each take reads back at its full width');

-- ─── a ragged list cannot be written at all ──────────────────────────────
-- Postgres refuses the LITERAL — this is the property that makes a column the
-- right shape for a list of same-model embeddings, and it is asserted rather
-- than assumed because it is the whole argument against a table.
select t.raises(
  $$update echo.person
       set voiceprint_takes = array[array[1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0], array[3.0]]
     where id = 'e1180000-0000-4000-8000-000000000118'$$,
  '2202E',
  '0207: a ragged take list is unrepresentable');

-- ─── withdrawal clears both ──────────────────────────────────────────────
-- If clearing the print left the takes behind, 0207's own check would refuse
-- the update and a person could not withdraw their voice — the one operation
-- that must never be blocked by a feature about improving prints.
update echo.person
   set voiceprint = null, voiceprint_model = null, voiceprint_at = null,
       voiceprint_by = null, voiceprint_samples = null, voiceprint_takes = null
 where id = 'e1180000-0000-4000-8000-000000000118';
select t.ok(
  (select voiceprint_takes is null and voiceprint is null from echo.person
    where id = 'e1180000-0000-4000-8000-000000000118'),
  '0207: withdrawing a voice clears the takes with the print');

delete from echo.person where id = 'e1180000-0000-4000-8000-000000000118';
