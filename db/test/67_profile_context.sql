-- 0080: profile context — self-editable, consent defaults OFF, length caps.

reset role;
set local role echo_app;

-- ── a person writes their own context ─────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.app_user
   set job_title = 'مدیر محصول', about = 'به تحلیل جلسات علاقه دارم'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select job_title = 'مدیر محصول' and assistant_context = false
     from echo.app_user where id = '02000000-0000-4000-8000-000000000002'),
  'a person writes their own context, and CONSENT stays off until switched — sharing is an explicit act');

update echo.app_user set assistant_context = true
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select assistant_context from echo.app_user
    where id = '02000000-0000-4000-8000-000000000002'),
  'they flip consent on themselves');

-- ── nobody writes someone else''s story ────────────────────────────────────
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
update echo.app_user set about = 'جعل'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select about = 'به تحلیل جلسات علاقه دارم' from echo.app_user
    where id = '02000000-0000-4000-8000-000000000002'),
  'another member''s update touches nothing — the row is not theirs to reach');

-- ── the caps are constraints, not api courtesy ────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$update echo.app_user set job_title = repeat('x', 121)
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'job_title beyond 120 characters is refused by the CONSTRAINT');
select t.denied(
  $$update echo.app_user set about = repeat('x', 2001)
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'about beyond 2000 characters likewise');

-- ── sweep: leave the fixture person as found ──────────────────────────────
update echo.app_user
   set job_title = null, about = null, assistant_context = false
 where id = '02000000-0000-4000-8000-000000000002';
