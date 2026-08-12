-- Fixture: two orgs, five people, six calls. Committed once; every test file
-- runs against it inside a transaction that is rolled back.
--
-- Applied as the superuser, which bypasses RLS on purpose — this is the only
-- place in the suite that does. Everything a test asserts afterwards is done
-- as echo_app / echo_agent / echo_purge with an identity attached.
--
--   org A ─ alice  admin,  active
--         ├ bob    member, active   owns c1 (private), c2 (org), c4, c5
--         ├ carol  member, active   owns c3 (private)
--         └ dan    member, PENDING  owns nothing, must see nothing
--   org B ─ erin   admin,  active   owns c6 — and must never see any of org A

insert into auth.users (id, email) values
  ('01000000-0000-4000-8000-000000000001', 'alice@example.com'),
  ('02000000-0000-4000-8000-000000000002', 'bob@example.com'),
  ('03000000-0000-4000-8000-000000000003', 'carol@example.com'),
  ('04000000-0000-4000-8000-000000000004', 'dan@example.com'),
  ('05000000-0000-4000-8000-000000000005', 'erin@example.com');

insert into echo.org (id, name) values
  ('0a000000-0000-4000-8000-00000000000a', 'شرکت الف'),
  ('0b000000-0000-4000-8000-00000000000b', 'شرکت ب');

insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at) values
  ('01000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   'alice@example.com', 'آلیس', 'admin',  'active',  now()),
  ('02000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
   'bob@example.com',   'باب',  'member', 'active',  now()),
  ('03000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a',
   'carol@example.com', 'کارول','member', 'active',  now()),
  ('04000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-00000000000a',
   'dan@example.com',   'دن',   'member', 'pending', null),
  ('05000000-0000-4000-8000-000000000005', '0b000000-0000-4000-8000-00000000000b',
   'erin@example.com',  'ارین', 'admin',  'active',  now());

insert into echo.call (id, org_id, owner_id, title, scope, status,
                       deleted_at, deleted_by, purge_after) values
  ('c1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'مذاکره قرارداد', 'private', 'ready',
   null, null, null),
  ('c2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'جلسه تیم',       'org',     'ready',
   null, null, null),
  ('c3000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a',
   '03000000-0000-4000-8000-000000000003', 'تماس با مشتری',  'private', 'ready',
   null, null, null),
  -- Deleted 40 days ago: its purge window has expired.
  ('c4000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'حذف‌شده قدیمی',  'private', 'ready',
   now() - interval '40 days', '02000000-0000-4000-8000-000000000002',
   now() - interval '10 days'),
  -- Deleted yesterday: still inside the window, must survive the purge job.
  ('c5000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'حذف‌شده تازه',   'private', 'ready',
   now() - interval '1 day', '02000000-0000-4000-8000-000000000002',
   now() + interval '29 days'),
  ('c6000000-0000-4000-8000-000000000006', '0b000000-0000-4000-8000-00000000000b',
   '05000000-0000-4000-8000-000000000005', 'تماس سازمان ب',  'private', 'ready',
   null, null, null);

insert into echo.call_part (id, call_id, org_id, idx, offset_ms, duration_ms, status) values
  ('d1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-00000000000a', 0, 0, 1800000, 'diarized'),
  ('d4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000004',
   '0a000000-0000-4000-8000-00000000000a', 0, 0,  600000, 'diarized');

insert into echo.call_speaker (id, call_id, org_id, label) values
  ('e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-00000000000a', 'گوینده ۱'),
  ('e2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002',
   '0a000000-0000-4000-8000-00000000000a', 'گوینده ۱');

-- Deliberately unlinked: diarization produces voices, never directory entries
-- (M11). Linking is a separate act by the owner, and 60_directory_privacy
-- proves only the owner can perform it.
insert into echo.person (id, org_id, display_name, created_by) values
  ('f1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   'رضا محمدی', '02000000-0000-4000-8000-000000000002');

insert into echo.transcript_segment
  (id, call_id, org_id, part_id, seq, start_ms, end_ms, call_speaker_id, text) values
  ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001',
   0, 0, 2500, 'e1000000-0000-4000-8000-000000000001',
   -- Arabic yeh/kaf and Arabic-Indic digits on purpose: the fold must make
   -- this findable by someone typing the Persian forms.
   'سلام، قيمت كتاب ٥ ميليون تومان است'),
  ('a2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001',
   1, 2500, 5000, 'e1000000-0000-4000-8000-000000000001',
   'قرارداد را هفته آینده امضا می‌کنیم'),
  ('a3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002',
   '0a000000-0000-4000-8000-00000000000a', null,
   0, 0, 3000, 'e2000000-0000-4000-8000-000000000002',
   'گزارش هفتگی تیم فروش'),
  ('a4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000004',
   '0a000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000004',
   0, 0, 1000, null,
   'این باید پاک شود');

insert into echo.summary (id, call_id, org_id, version, body, model, created_by) values
  ('b2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002',
   '0a000000-0000-4000-8000-00000000000a', 1, 'خلاصه نسخه یک', 'test/model',
   '02000000-0000-4000-8000-000000000002'),
  ('b4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000004',
   '0a000000-0000-4000-8000-00000000000a', 1, 'خلاصه حذف‌شده', 'test/model',
   '02000000-0000-4000-8000-000000000002');

insert into echo.agent_run (id, org_id, actor_id, call_id, kind, status, model, finished_at) values
  ('11000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002',
   'summarizer', 'ok', 'test/model', now()),
  ('14000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000004',
   'summarizer', 'ok', 'test/model', now());

-- The combination that broke the purge job: someone asked the assistant about
-- a call, so a message points at a run that points at that call — and the call
-- later expires. Without ON DELETE SET NULL (0018) the purge dies on a foreign
-- key and the call outlives its window. The fixture carries it so the suite
-- cannot go green on that again.
insert into echo.agent_session (id, org_id, actor_id, title) values
  ('52000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'پرسش درباره تماس حذف‌شده');

insert into echo.agent_message
  (id, session_id, org_id, seq, role, content, agent_run_id) values
  ('53000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000002',
   '0a000000-0000-4000-8000-00000000000a', 0, 'assistant', 'پاسخ درباره آن تماس',
   '14000000-0000-4000-8000-000000000004');

-- Gateway keys: one live, one revoked, one acting as the pending user.
insert into echo.api_key (id, org_id, actor_id, name, token_sha256, token_prefix,
                          created_by, revoked_at, revoked_by) values
  ('21000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'live', 'sha-live', 'ech_live',
   '01000000-0000-4000-8000-000000000001', null, null),
  ('22000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
   '02000000-0000-4000-8000-000000000002', 'revoked', 'sha-revoked', 'ech_revk',
   '01000000-0000-4000-8000-000000000001', now(), '01000000-0000-4000-8000-000000000001'),
  ('23000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a',
   '04000000-0000-4000-8000-000000000004', 'pending-owner', 'sha-pending', 'ech_pend',
   '01000000-0000-4000-8000-000000000001', null, null);
