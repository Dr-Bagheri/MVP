-- 0093: admins may RENAME a voice; only the owner may LINK or UNLINK one.
--
-- The companion of 60_directory_privacy — that file proves the directory
-- rule (a voice joins when the OWNER links it); this one proves the label
-- amendment did not widen it. Walk the whole matrix (rule 7's M11 corollary:
-- the ordinary path is the product):
--
--   admin:  label ✓ · link ✗ · unlink ✗
--   member: label ✗ (readable is not editable)
--   owner:  label ✓ · link ✓ (unchanged)

reset role;
set local role echo_app;

-- --- the admin renames a voice on a member's PRIVATE call ------------------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

update echo.call_speaker set label = 'مدیر جلسه'
 where id = 'e1000000-0000-4000-8000-000000000001';
select t.ok(
  (select label = 'مدیر جلسه' from echo.call_speaker
    where id = 'e1000000-0000-4000-8000-000000000001'),
  'an admin can rename a voice on a call they can read (0093)');

-- --- but still cannot LINK it into the directory (M11, unchanged) ----------
select t.writes_nothing(
  $$update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
     where id = 'e1000000-0000-4000-8000-000000000001'$$,
  'the label amendment did not open the directory: admin link still refused');

-- --- nor UNLINK what the owner deliberately linked -------------------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.call_speaker set person_id = 'f1000000-0000-4000-8000-000000000001'
 where id = 'e2000000-0000-4000-8000-000000000002';

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.writes_nothing(
  $$update echo.call_speaker set person_id = null
     where id = 'e2000000-0000-4000-8000-000000000002'$$,
  'an admin cannot quietly undo the owner''s link either (0093 trigger)');
select t.ok(
  (select person_id is not null from echo.call_speaker
    where id = 'e2000000-0000-4000-8000-000000000002'),
  'the owner''s link survived the admin''s attempt');

-- --- a plain member with read cannot rename --------------------------------
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.writes_nothing(
  $$update echo.call_speaker set label = 'x'
     where id = 'e2000000-0000-4000-8000-000000000002'$$,
  'org scope shares the recording, not the pencil: member rename refused');

-- --- the owner keeps everything (and the fixture is put back) --------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.call_speaker set label = 'گوینده ۱', person_id = null
 where id = 'e2000000-0000-4000-8000-000000000002';
update echo.call_speaker set label = 'گوینده ۱'
 where id = 'e1000000-0000-4000-8000-000000000001';
select t.ok(
  (select label = 'گوینده ۱' and person_id is null from echo.call_speaker
    where id = 'e2000000-0000-4000-8000-000000000002'),
  'the owner renames and unlinks freely — 0093 changed nothing above them');
