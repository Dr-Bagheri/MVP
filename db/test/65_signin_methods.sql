-- 0078: sign-in method toggles — pre-identity read, admin-walled write.

reset role;
set local role echo_app;

-- ── the pre-identity read: NO actor is set, and the sign-in page's
--    question still answers (this is the sign-in page's exact posture) ─────
select set_config('echo.actor_id', '', true);
select t.ok(
  (select count(*) from echo.signin_method) = 2,
  'both methods are readable with no actor at all — the sign-in page is pre-identity');
select t.ok(
  (select bool_and(enabled) from echo.signin_method),
  'and both start enabled');

-- ── a MEMBER is refused at the door ───────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select echo.set_signin_method('google', false)$$,
  'a member may not change sign-in methods');

-- ── direct writes are refused for everyone — one door ─────────────────────
select t.denied(
  $$update echo.signin_method set enabled = false where provider = 'google'$$,
  'direct UPDATE is refused — the door is the only write path');

-- ── an ADMIN flips one off, stamped ───────────────────────────────────────
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
select t.ok(
  echo.set_signin_method('google', false) = false,
  'an admin turns a method off');
select t.ok(
  (select enabled = false and updated_by = '06000000-0000-4000-8000-000000000006'
     from echo.signin_method where provider = 'google'),
  'the row records the new state and who set it');

-- ── the OWNER turns it back on ────────────────────────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  echo.set_signin_method('google', true),
  'the owner turns it back on');

-- ── an invented provider is a loud refusal, not a silent no-op ────────────
select t.denied(
  $$select echo.set_signin_method('facebook', true)$$,
  'an unknown method name raises — the catalogue is fixed');

-- ── the agent role has no door ────────────────────────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.denied(
  $$select echo.set_signin_method('github', false)$$,
  'the agent cannot flip how people enter the platform');

reset role;
