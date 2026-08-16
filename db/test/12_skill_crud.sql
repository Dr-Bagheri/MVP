-- Skill CRUD walls (0007/0013/0018/0059, M29) — the whole matrix.
--
-- The write policies predate the management surface by a milestone; now that
-- an editor is about to drive them, the ordinary paths get walked the way
-- M11 taught: the privileged case and the refusal prove nothing about the
-- path the product actually takes.

reset role;
set local role echo_app;

-- --- an admin authors an org skill (the editor's main path) -----------------

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

insert into echo.skill (id, level, org_id, slug, name, prompt, starter_questions)
values ('71000000-0000-4000-8000-000000000001', 'org',
        '0a000000-0000-4000-8000-00000000000a',
        'weekly-recap', 'جمع‌بندی هفتگی', 'خلاصهٔ هفتگی بساز.',
        '["مهم‌ترین تصمیم‌های این هفته چه بود؟"]');

select t.ok(
  (select count(*) from echo.skill where id = '71000000-0000-4000-8000-000000000001') = 1,
  'an admin authors an org skill');

update echo.skill set description = 'به‌روز شد'
 where id = '71000000-0000-4000-8000-000000000001';
select t.ok(
  (select description from echo.skill where id = '71000000-0000-4000-8000-000000000001') = 'به‌روز شد',
  'and edits it');

select t.denied(
  $q$ insert into echo.skill (level, org_id, slug, name, prompt, starter_questions)
      values ('org', '0a000000-0000-4000-8000-00000000000a',
              'bad-shape', 'بد', 'x', '{"not":"an array"}') $q$,
  'starter_questions must be an array — the wall''s half of the discipline');

-- --- a member: reads org skills, writes only their own ----------------------

select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.ok(
  (select count(*) from echo.skill where id = '71000000-0000-4000-8000-000000000001') = 1,
  'a member sees the org skill (the picker''s read)');

select t.writes_nothing(
  $q$ update echo.skill set prompt = 'دستکاری'
       where id = '71000000-0000-4000-8000-000000000001' $q$,
  'but cannot edit it');

insert into echo.skill (id, level, org_id, user_id, slug, name, prompt)
values ('72000000-0000-4000-8000-000000000002', 'user',
        '0a000000-0000-4000-8000-00000000000a',
        '02000000-0000-4000-8000-000000000002',
        'my-notes', 'یادداشت‌های من', 'کوتاه بنویس.');
select t.ok(
  (select count(*) from echo.skill where id = '72000000-0000-4000-8000-000000000002') = 1,
  'a member authors their own user skill');

-- carol cannot see or touch bob's user skill.
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok(
  (select count(*) from echo.skill where id = '72000000-0000-4000-8000-000000000002') = 0,
  'a colleague''s user skill is invisible');

-- --- nobody writes system rows ----------------------------------------------

select t.writes_nothing(
  $q$ update echo.skill set prompt = 'دستکاری' where level = 'system' $q$,
  'system skills are read-only to the org (an admin included)');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.denied(
  $q$ insert into echo.skill (level, slug, name, prompt)
      values ('system', 'fake-floor', 'x', 'x') $q$,
  'and cannot be minted from the api role');

-- --- archive frees the slug (0018), and that is the delete ------------------

update echo.skill set archived_at = now()
 where id = '71000000-0000-4000-8000-000000000001';
insert into echo.skill (level, org_id, slug, name, prompt)
values ('org', '0a000000-0000-4000-8000-00000000000a',
        'weekly-recap', 'جمع‌بندی هفتگی ۲', 'نسخهٔ دوم.');
select t.ok(
  (select count(*) from echo.skill
    where slug = 'weekly-recap' and level = 'org') = 2,
  'archiving frees the slug for a second attempt while the first stays attached to its runs');

reset role;
