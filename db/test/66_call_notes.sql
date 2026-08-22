-- 0079: call notes and chapters — reader-scoped, author-attributed,
-- append-only.

reset role;
set local role echo_app;

-- ── the owner notes their own call ────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
insert into echo.call_note (id, call_id, org_id, kind, at_ms, body, created_by)
values ('79000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
        'note', 65000, 'پیگیری: قرارداد تا پنج‌شنبه', '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select count(*) from echo.call_note where call_id = 'c2000000-0000-4000-8000-000000000002') = 1,
  'the owner adds a timestamped note to their call');

-- a chapter is the same table, second kind, and may be un-anchored... but a
-- CHAPTER always has a moment — the check permits null only for notes by
-- shape; pin that a chapter with a time and a plain note both land
insert into echo.call_note (call_id, org_id, kind, at_ms, body, created_by)
values ('c2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
        'chapter', 120000, 'بخش دوم: بودجه', '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select count(*) from echo.call_note
    where call_id = 'c2000000-0000-4000-8000-000000000002' and kind = 'chapter') = 1,
  'a named chapter lands as its own kind');

-- ── attribution cannot be forged (a fact must not be supplyable) ──────────
select t.denied(
  $$insert into echo.call_note (call_id, org_id, kind, body, created_by)
    values ('c2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
            'note', 'جعل هویت', '03000000-0000-4000-8000-000000000003')$$,
  'a note cannot claim another author');

-- ── an org-scoped call takes a COLLEAGUE''s note, attributed ───────────────
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
insert into echo.call_note (id, call_id, org_id, kind, body, created_by)
values ('79000000-0000-4000-8000-000000000002',
        'c2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
        'note', 'یادداشت همکار', '03000000-0000-4000-8000-000000000003');
select t.ok(
  (select created_by from echo.call_note
    where id = '79000000-0000-4000-8000-000000000002')
    = '03000000-0000-4000-8000-000000000003',
  'an org-scoped call takes a colleague''s note under their own name');

-- ── but a PRIVATE call of someone else is invisible and unwritable ────────
select t.denied(
  $$insert into echo.call_note (call_id, org_id, kind, body, created_by)
    values ('c1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
            'note', 'نفوذ', '03000000-0000-4000-8000-000000000003')$$,
  'a private call someone else owns takes no note — the note rides the call''s scope');

-- ── delete: the author''s own only ─────────────────────────────────────────
-- carol cannot delete bob's note (delete filters to own rows: zero touched)
delete from echo.call_note where id = '79000000-0000-4000-8000-000000000001';
select t.ok(
  exists (select 1 from echo.call_note where id = '79000000-0000-4000-8000-000000000001'),
  'deleting someone else''s note touches nothing');
delete from echo.call_note where id = '79000000-0000-4000-8000-000000000002';
select t.ok(
  not exists (select 1 from echo.call_note where id = '79000000-0000-4000-8000-000000000002'),
  'the author deletes their own');

-- ── no UPDATE path at all — append-only by grant ──────────────────────────
select t.denied(
  $$update echo.call_note set body = 'ویرایش' where id = '79000000-0000-4000-8000-000000000001'$$,
  'notes are append-only — no update grant exists');

-- ── the agent role sees nothing here (deliberate, on record in 0079) ──────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$select count(*) from echo.call_note$$,
  'the agent has no read on notes — whether the summarizer may see them is a decision not yet taken');

reset role;
-- sweep the seeds (B3's count trap)
delete from echo.call_note where call_id = 'c2000000-0000-4000-8000-000000000002';
