-- db/0112 — the personal-settings walls: the assistant's per-person voice,
-- the caller's-own-sessions door, consent withdrawal, the domain wall.

reset role;

-- seed auth sessions for two people (owner altitude — auth is Supabase's)
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent, ip)
values ('96000000-0000-4000-8000-000000000001',
        '02000000-0000-4000-8000-000000000002', now(), now(),
        'Mozilla/5.0 Chrome/126', '203.0.113.7'),
       ('96000000-0000-4000-8000-000000000002',
        '03000000-0000-4000-8000-000000000003', now(), now(),
        'Mozilla/5.0 Firefox/127', '203.0.113.9');

-- a directory person LINKED to bob, with a voice print to withdraw
insert into echo.person (id, org_id, display_name, app_user_id, created_by,
                         voiceprint, voiceprint_model, voiceprint_at, voiceprint_by)
values ('96000000-0000-4000-8000-000000000011',
        '0a000000-0000-4000-8000-00000000000a', 'باب (عضو)',
        '02000000-0000-4000-8000-000000000002',
        '02000000-0000-4000-8000-000000000002',
        array[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]::float8[] /* >=8 dims (0081's degenerate-vector wall) */, 'test-model', now(),
        '02000000-0000-4000-8000-000000000002');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0112 policy tests run under a non-bypass product role');

-- ─── the assistant columns hold their shape ─────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
update echo.app_user
   set assistant_reply_language = 'fa',
       assistant_reply_length = 'short',
       assistant_instructions = 'همیشه مثال بزن.',
       post_call_brief = false
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select assistant_reply_language from echo.app_user
    where id = '02000000-0000-4000-8000-000000000002') = 'fa',
  '0112: the standing voice persists');
select t.denied(
  $$update echo.app_user set assistant_reply_language = 'de'
     where id = '02000000-0000-4000-8000-000000000002'$$,
  '0112: the reply language is a closed set');
select t.denied(
  $$update echo.app_user set assistant_instructions = repeat('x', 2001)
     where id = '02000000-0000-4000-8000-000000000002'$$,
  '0112: standing instructions are bounded at 2000');

-- ─── the sessions door: the caller's own, and NOBODY else's ─────────────
select t.ok(
  (select count(*) from echo.my_auth_sessions()) = 1
  and exists (select 1 from echo.my_auth_sessions() where ip = '203.0.113.7'),
  '0112: bob''s door shows exactly bob''s session');
-- the discriminating pair: carol's door shows HERS, not bob's — proof the
-- door filters by actor rather than returning everything or nothing
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  (select count(*) from echo.my_auth_sessions()) = 1
  and exists (select 1 from echo.my_auth_sessions() where ip = '203.0.113.9'),
  '0112: carol''s door shows exactly carol''s session — actor-filtered, both directions');

-- ─── consent withdrawal: self-service, own-row-only ─────────────────────
select t.ok(
  echo.clear_my_voiceprint() is null,
  '0112: carol has no linked print — the door answers empty, not somebody else''s row');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  echo.clear_my_voiceprint() is true,
  '0112: bob withdraws his own print');
select t.ok(
  echo.clear_my_voiceprint() is null,
  '0112: a second withdrawal finds nothing — the first one was real');
reset role;
select t.ok(
  (select voiceprint is null and voiceprint_model is null
     from echo.person where id = '96000000-0000-4000-8000-000000000011'),
  '0112: the print and its provenance are gone together (owner-altitude read)');
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice

-- ─── the domain wall's bound ────────────────────────────────────────────
select t.denied(
  $$update echo.org set allowed_email_domains =
      (select array_agg('d' || g || '.example.com') from generate_series(1, 21) g)
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '0112: at most 20 allowed domains — the wall cannot become a text dump');
update echo.org set allowed_email_domains = array['neurai.pt']
 where id = '0a000000-0000-4000-8000-00000000000a';
select t.ok(
  (select allowed_email_domains from echo.org
    where id = '0a000000-0000-4000-8000-00000000000a') = array['neurai.pt'],
  '0112: an admin sets the invitation domain wall');

reset role;
