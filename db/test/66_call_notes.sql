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

-- ── THE DECISION 0079 DEFERRED, TAKEN (0176) ─────────────────────────────
--
-- 0079 wrote: "the AGENT has no grants on this table for now. Whether the
-- summarizer may read a call's notes is a real product decision (notes could
-- steer or contaminate a summary) — deliberately not smuggled in with the
-- table. When wanted, it is one grant + one policy, decided on record."
--
-- It is wanted (user directive, 2026-09-04: the agents must be able to do
-- anything a person can), and this is the record. What makes it safe is that
-- the concern was never really about the GRANT:
--
--   · A note is content the ASKING PERSON can already read, and RLS gives the
--     agent exactly the caller's view — `call_note_read` is unchanged, so the
--     agent sees a note if and only if the person who asked would.
--   · The contamination path 0079 named is the SUMMARIZER, an unattended run.
--     It is closed by the TOOLSET, not by the grant: the worker builds its
--     runs with `createDomainTools()` and no platform tools at all, so no
--     summarizer has a way to ask for a note. That is asserted in core's
--     suite, where the toolset lives; a grant cannot express "except in this
--     kind of run" and pretending otherwise would be the wrong altitude.
--
-- So: the read is open, the write is not, and the summarizer still cannot see
-- a note because nothing offers it one.
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  (select count(*) from echo.call_note) >= 0,
  'the agent may READ notes — 0079 deferred this and 0176 decided it');

-- and RLS still decides WHICH notes: the grant did not widen the view, it
-- opened the table. Without this the line above passes identically against a
-- policy that shows the agent every org's notes.
--
-- AGAINST THE ACTOR'S OWN ORG, not a literal. This assertion carried the id
-- `01000000-…-0001`, which is not the org the fixture's notes are in — so it
-- asked "is there a note outside an organization nobody here belongs to", and
-- the answer was yes the moment the agent could see anything. It never failed
-- because until db/0178 the agent had a GRANT and no policy and saw zero rows:
-- the check could not fail, so its wrong constant could not be noticed. A
-- hardcoded id in a scoping assertion is a second copy of the fixture that
-- nothing keeps in step; `actor_org_id()` is the fact being tested.
select t.ok(
  not exists (
    select 1 from echo.call_note n where n.org_id <> echo.actor_org_id()
  ),
  'a note from another organization is still invisible to the agent');

-- and it is NOT seeing nothing, which is what made the line above vacuous for
-- as long as it existed: the agent reads its own org's notes.
select t.ok(
  (select count(*) from echo.call_note) > 0,
  'the agent actually sees the notes it is allowed to — the check above has a subject');

-- the half that must stay shut: reading is not writing.
select t.denied(
  $$insert into echo.call_note (call_id, org_id, author_id, kind, body)
    values ('c2000000-0000-4000-8000-000000000002',
            '01000000-0000-4000-8000-000000000001',
            '02000000-0000-4000-8000-000000000002', 'note', 'ساخته‌شده توسط عامل')$$,
  'the agent may read a note and may never write one');

reset role;
-- sweep the seeds (B3's count trap)
delete from echo.call_note where call_id = 'c2000000-0000-4000-8000-000000000002';
