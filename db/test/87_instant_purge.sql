-- 0083: instant purge from the console trash — users and organizations.
-- Runs AFTER 85 (alice 01…01 is the platform root).

reset role;

-- ── a disposable tenancy with REAL content, so every delete has a row to
--    move (a zero-row delete passes any ordering vacuously — rule 9) ──────
insert into auth.users (id, email) values
  ('87000000-0000-4000-8000-000000000087', 'doomed@example.com');
insert into echo.org (id, name) values
  ('87b00000-0000-4000-8000-000000000087', 'سازمان پاک‌شدنی');
insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at) values
  ('87000000-0000-4000-8000-000000000087', '87b00000-0000-4000-8000-000000000087',
   'doomed@example.com', 'محکوم', 'owner', 'active', now());
insert into echo.call (id, org_id, owner_id, title, scope, status) values
  ('87c00000-0000-4000-8000-000000000087', '87b00000-0000-4000-8000-000000000087',
   '87000000-0000-4000-8000-000000000087', 'تماس محکوم', 'private', 'ready');
insert into echo.call_part (id, call_id, org_id, idx, offset_ms, duration_ms, status,
                            storage_bucket, storage_path) values
  ('87d00000-0000-4000-8000-000000000087', '87c00000-0000-4000-8000-000000000087',
   '87b00000-0000-4000-8000-000000000087', 0, 0, 1000, 'transcribed',
   'call-audio', '87c00000/0-doomed.webm');
insert into echo.transcript_segment (call_id, org_id, part_id, seq, start_ms, end_ms, text) values
  ('87c00000-0000-4000-8000-000000000087', '87b00000-0000-4000-8000-000000000087',
   '87d00000-0000-4000-8000-000000000087', 0, 0, 900, 'متن محکوم');
-- the run is what makes the delete ORDER real: without it, `delete call`
-- succeeds even if the ordering were wrong
insert into echo.agent_run (id, org_id, actor_id, call_id, kind, model) values
  ('87e00000-0000-4000-8000-000000000087', '87b00000-0000-4000-8000-000000000087',
   '87000000-0000-4000-8000-000000000087', '87c00000-0000-4000-8000-000000000087',
   'summarizer', 'test/model');

set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

-- ── purge finishes a deletion, never starts one ───────────────────────────
select t.denied(
  $$select echo.platform_purge_user('01000000-0000-4000-8000-000000000001',
      '87000000-0000-4000-8000-000000000087', 'too soon')$$,
  'a LIVE user cannot be instantly purged — the trash is the only door');

-- ── the objects-first support answers before anything is deleted ──────────
select t.ok(
  exists (select 1 from echo.platform_call_storage_paths(
            '01000000-0000-4000-8000-000000000001',
            null, '87000000-0000-4000-8000-000000000087')
          where path = '87c00000/0-doomed.webm'),
  'the storage-path read names the audio the api must delete FIRST');

-- ── soft-delete then purge the USER ───────────────────────────────────────
select t.ok(
  echo.platform_soft_delete_user('01000000-0000-4000-8000-000000000001',
    '87000000-0000-4000-8000-000000000087', 'winding the org down'),
  'the user is soft-deleted into the trash');
select t.ok(
  echo.platform_purge_user('01000000-0000-4000-8000-000000000001',
    '87000000-0000-4000-8000-000000000087', 'instant purge requested'),
  'the root purges them NOW');
select t.ok(
  not exists (select 1 from echo.call where owner_id = '87000000-0000-4000-8000-000000000087'),
  'their calls, parts, transcripts and runs are gone');
select t.ok(
  (select email like 'deleted-%@tombstone.invalid' and deleted_at is null and status = 'disabled'
     from echo.app_user where id = '87000000-0000-4000-8000-000000000087'),
  'the row remains as a tombstone — identity erased, trash cleared, FKs intact');

-- ── the ORG goes whole ────────────────────────────────────────────────────
select t.ok(
  echo.platform_soft_delete_org('01000000-0000-4000-8000-000000000001',
    '87b00000-0000-4000-8000-000000000087', 'org wound down'),
  'the org is soft-deleted into the trash');
select t.ok(
  echo.platform_purge_org('01000000-0000-4000-8000-000000000001',
    '87b00000-0000-4000-8000-000000000087', 'instant purge requested'),
  'the root purges the organization NOW');
select t.ok(
  not exists (select 1 from echo.org where id = '87b00000-0000-4000-8000-000000000087'),
  'the org row is gone');
select t.ok(
  not exists (select 1 from echo.app_user where org_id = '87b00000-0000-4000-8000-000000000087'),
  'and its members with it');
select t.ok(
  exists (select 1 from echo.platform_audit
           where action = 'org_purged' and reason like '%سازمان پاک‌شدنی%'),
  'the audit keeps the FACT with the org''s name in the reason — references severed, record kept');

-- ── the walls ─────────────────────────────────────────────────────────────
select t.denied(
  $$select echo.platform_purge_user('01000000-0000-4000-8000-000000000001',
      '01000000-0000-4000-8000-000000000001', 'self')$$,
  'a platform root is never purged through this door');
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.denied(
  $$select echo.platform_purge_org('05000000-0000-4000-8000-000000000005',
      '0b000000-0000-4000-8000-00000000000b', 'trying')$$,
  'a non-root cannot purge anything');
