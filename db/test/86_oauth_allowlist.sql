-- 0082: the OAuth allow-list — root-managed, gate answers one bit.
-- Runs AFTER 85: alice (01…01) became the platform root there; the
-- bootstrap is one-shot, so this file deliberately rides that state.

reset role;
set local role echo_app;

-- ── the seed: the platform root's own address is already on the list ──────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  echo.oauth_email_allowed('neurai.git.acc@gmail.com'),
  'the migration seeds the platform root''s address — turning the feature on cannot lock the owner out');
select t.ok(
  echo.oauth_email_allowed('NEURAI.GIT.ACC@GMAIL.COM'),
  'the check is case-insensitive — an email is citext, not a string');
select t.ok(
  not echo.oauth_email_allowed('stranger@example.com'),
  'an unlisted address is refused — the gate can say no');

-- ── root manages the list ─────────────────────────────────────────────────
select t.ok(
  echo.platform_oauth_allow('01000000-0000-4000-8000-000000000001',
    'guest@example.com', 'invited demo account', 'adding the demo guest'),
  'the root allows an address');
select t.ok(
  echo.oauth_email_allowed('guest@example.com'),
  'and the gate opens for it');
select t.ok(
  (select count(*) from echo.platform_oauth_allowlist('01000000-0000-4000-8000-000000000001')) >= 2,
  'the root reads the list back');

select t.ok(
  echo.platform_oauth_disallow('01000000-0000-4000-8000-000000000001',
    'guest@example.com', 'demo over'),
  'the root removes an address');
select t.ok(
  not echo.oauth_email_allowed('guest@example.com'),
  'and the gate closes for it again');
select t.denied(
  $$select echo.platform_oauth_disallow('01000000-0000-4000-8000-000000000001',
      'guest@example.com', 'again')$$,
  'removing an address that is not there raises, never a silent no-op');

-- ── the wall: a NON-root (even an org owner) manages nothing ──────────────
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.denied(
  $$select echo.platform_oauth_allow('05000000-0000-4000-8000-000000000005',
      'intruder@example.com', '', 'self-service')$$,
  'an org owner who is not platform root cannot add addresses');
select t.denied(
  $$select * from echo.platform_oauth_allowlist('05000000-0000-4000-8000-000000000005')$$,
  'nor read the list');
select t.denied(
  $$select * from echo.oauth_allowlist$$,
  'and the table itself is unreadable to app roles — FORCE RLS, no policies, definers only');

-- ── the gate stays answerable actor-less (the callback's posture) ─────────
select set_config('echo.actor_id', '', true);
select t.ok(
  not echo.oauth_email_allowed('nobody@example.com'),
  'the gate answers with no actor at all — the OAuth callback runs pre-membership');
