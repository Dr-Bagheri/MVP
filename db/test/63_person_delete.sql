-- 0076: deleting a directory person is a NAMED DOOR with the role wall in
-- SQL — admin/owner delete, a member is refused, cross-org is invisible,
-- and linked speakers are unlinked (three columns together), never orphaned.

reset role;
set local role echo_app;

-- ── the fixture this test SEEDS for itself (rule 9: self-seeding) ─────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);  -- alice, owner

insert into echo.person (id, org_id, display_name, title, created_by) values
  ('76000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   'گویندهٔ حذف‌شدنی', 'ceo', '01000000-0000-4000-8000-000000000001'),
  ('76000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
   'گویندهٔ ماندنی', '', '01000000-0000-4000-8000-000000000001');

-- link the doomed person to a speaker on an org-scoped call, so the unlink
-- half has something REAL to prove (a delete that only works on unlinked
-- people would pass a lazier fixture)
insert into echo.call_speaker (id, call_id, org_id, label, person_id, linked_by, linked_at)
values ('76100000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
        '0a000000-0000-4000-8000-00000000000a', 'S9',
        '76000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000001', now());

-- ── a MEMBER is refused at the door ───────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);  -- bob, member
select t.denied(
  $$select echo.delete_person('76000000-0000-4000-8000-000000000001')$$,
  'a member may not delete a person — the wall is in the FUNCTION, not the api');
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select count(*) from echo.person where id = '76000000-0000-4000-8000-000000000001') = 1,
  'the refused delete removed nothing');

-- ── cross-org: another org''s admin sees "no such person" ─────────────────
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);  -- erin, owner of org B
select t.denied(
  $$select echo.delete_person('76000000-0000-4000-8000-000000000001')$$,
  'another org''s owner gets the one indistinguishable no-such-person answer');

-- ── an ADMIN (dave) deletes: person gone, speaker unlinked, not orphaned ──
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);  -- dave, admin
select echo.delete_person('76000000-0000-4000-8000-000000000001');
select t.ok(
  (select count(*) from echo.person where id = '76000000-0000-4000-8000-000000000001') = 0,
  'an admin''s delete removes the directory person');
select t.ok(
  (select person_id is null and linked_by is null and linked_at is null
     from echo.call_speaker where id = '76100000-0000-4000-8000-000000000001'),
  'the linked speaker was UNLINKED — all three link columns together — and survives');
select t.ok(
  (select count(*) from echo.person where id = '76000000-0000-4000-8000-000000000002') = 1,
  'the neighbour person is untouched');

-- ── the raw wall still stands: no DELETE policy grew alongside the door ───
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.writes_nothing(
  $$delete from echo.person where id = '76000000-0000-4000-8000-000000000002'$$,
  'a bare DELETE on echo.person still touches nothing, even for the owner — the function is the only door');

-- sweep this test''s own residue (the door itself is the sweeper)
select echo.delete_person('76000000-0000-4000-8000-000000000002');
