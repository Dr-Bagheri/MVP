-- 0081: voiceprints — whole-or-absent, non-degenerate, org-scoped.

reset role;
set local role echo_app;

-- ── seed a person to enroll (rule 9: self-seeding) ────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
insert into echo.person (id, org_id, display_name, created_by) values
  ('81000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   'گویندهٔ ثبت‌نام‌شده', '01000000-0000-4000-8000-000000000001');

-- ── the four columns move together ────────────────────────────────────────
select t.denied(
  $$update echo.person set voiceprint = array[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]
     where id = '81000000-0000-4000-8000-000000000001'$$,
  'a vector without its model and provenance is refused — the four move together');

-- ── a full enrollment lands ───────────────────────────────────────────────
update echo.person
   set voiceprint = array[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8],
       voiceprint_model = 'sherpa-3dspeaker-v1',
       voiceprint_at = now(),
       voiceprint_by = '01000000-0000-4000-8000-000000000001'
 where id = '81000000-0000-4000-8000-000000000001';
select t.ok(
  (select array_length(voiceprint, 1) = 8 and voiceprint_model = 'sherpa-3dspeaker-v1'
     from echo.person where id = '81000000-0000-4000-8000-000000000001'),
  'a whole enrollment lands, model name attached');

-- ── a degenerate vector is refused at the wall ────────────────────────────
select t.denied(
  $$update echo.person
       set voiceprint = array[0.1], voiceprint_model = 'x',
           voiceprint_at = now(), voiceprint_by = '01000000-0000-4000-8000-000000000001'
     where id = '81000000-0000-4000-8000-000000000001'$$,
  'a vector shorter than 8 is refused — it would match everyone a little');

-- ── clearing is whole too ─────────────────────────────────────────────────
update echo.person
   set voiceprint = null, voiceprint_model = null,
       voiceprint_at = null, voiceprint_by = null
 where id = '81000000-0000-4000-8000-000000000001';
select t.ok(
  (select voiceprint is null and voiceprint_at is null
     from echo.person where id = '81000000-0000-4000-8000-000000000001'),
  'un-enrolling clears the whole set');

-- ── another org sees nothing (existing person RLS, re-asserted here
--    because a voiceprint raises the stakes of the wall) ──────────────────
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.ok(
  not exists (select 1 from echo.person
    where id = '81000000-0000-4000-8000-000000000001'),
  'a voiceprinted person is invisible across the org wall like any other');

-- sweep
reset role;
delete from echo.person where id = '81000000-0000-4000-8000-000000000001';
