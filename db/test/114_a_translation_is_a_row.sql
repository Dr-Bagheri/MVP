-- 0201: a transcript translation — asked for by a reader, written by the
-- owner's job, read by the call's readers, invisible past the call's wall,
-- and never the agent role's to write.
--
-- The matrix is walked whole (rule 7's authorization-matrix corollary): the
-- ORDINARY path (a reader asks, the owner writes, a reader reads) is the
-- product, and the refusals are the wall's.

reset role;
set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0201 policy test runs under a non-bypass product role');

-- ── bob owns c1 (private); he writes a line to translate ───────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
insert into echo.transcript_segment
  (id, call_id, org_id, part_id, seq, start_ms, end_ms, text, language)
select '99210000-0000-4000-8000-000000000001', c.id, c.org_id, null, 991001, 1000, 2000, 'سلام دنیا', 'fa'
  from echo.call c where c.id = 'c1000000-0000-4000-8000-000000000001';

-- ── alice (org owner, an admin) can READ c1 and therefore ASK ──────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
insert into echo.call_translation (call_id, language, org_id, requested_by)
values ('c1000000-0000-4000-8000-000000000001', 'en', '0a000000-0000-4000-8000-00000000000a',
        '01000000-0000-4000-8000-000000000001');
select t.ok(
  (select status from echo.call_translation
    where call_id = 'c1000000-0000-4000-8000-000000000001' and language = 'en') = 'queued',
  'a reader of the call requests its translation and sees it queued');

-- a reader is not the owner: the LINES are not hers to write
select t.denied(
  $$insert into echo.transcript_translation (segment_id, language, call_id, org_id, text)
    values ('99210000-0000-4000-8000-000000000001', 'en', 'c1000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a', 'Hello world')$$,
  'a reader who is not the owner cannot write a translated line');

-- ── the owner's job writes the lines and moves the status ──────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
insert into echo.transcript_translation (segment_id, language, call_id, org_id, text)
values ('99210000-0000-4000-8000-000000000001', 'en', 'c1000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a', 'Hello world');
update echo.call_translation set status = 'ready', finished_at = now(), model = 'stt-async-v5'
 where call_id = 'c1000000-0000-4000-8000-000000000001' and language = 'en';
select t.ok(
  (select status from echo.call_translation
    where call_id = 'c1000000-0000-4000-8000-000000000001' and language = 'en') = 'ready',
  'the owner moves the request to ready');
-- the same line asked again in the same language is one row (the job upserts)
select t.denied(
  $$insert into echo.transcript_translation (segment_id, language, call_id, org_id, text)
    values ('99210000-0000-4000-8000-000000000001', 'en', 'c1000000-0000-4000-8000-000000000001',
            '0a000000-0000-4000-8000-00000000000a', 'again')$$,
  'one translated text per line and language — the key is the wall against doubles');

-- ── alice reads the translation beside the line ────────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
select t.ok(
  (select tt.text from echo.transcript_translation tt
    where tt.segment_id = '99210000-0000-4000-8000-000000000001' and tt.language = 'en') = 'Hello world',
  'a reader of the call reads the translated line');

-- ── carol (a member, not an admin) cannot read private c1: nothing, and no request ──
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true); -- carol
select t.ok(
  not exists (select 1 from echo.call_translation where call_id = 'c1000000-0000-4000-8000-000000000001'),
  'past the call''s wall the request row is not there');
select t.ok(
  not exists (select 1 from echo.transcript_translation where call_id = 'c1000000-0000-4000-8000-000000000001'),
  'past the call''s wall the translated lines are not there');
select t.denied(
  $$insert into echo.call_translation (call_id, language, org_id, requested_by)
    values ('c1000000-0000-4000-8000-000000000001', 'de', '0a000000-0000-4000-8000-00000000000a',
            '03000000-0000-4000-8000-000000000003')$$,
  'a member who cannot read the call cannot ask for its translation');

-- ── the language is a tag, the status a known word ─────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.denied(
  $$insert into echo.call_translation (call_id, language, org_id)
    values ('c2000000-0000-4000-8000-000000000002', 'English', '0a000000-0000-4000-8000-00000000000a')$$,
  'a word is not a language tag');
select t.denied(
  $$insert into echo.call_translation (call_id, language, org_id, status)
    values ('c2000000-0000-4000-8000-000000000002', 'en', '0a000000-0000-4000-8000-00000000000a', 'done')$$,
  'a status outside queued/ready/failed is refused');

-- ── the agent role reads and never writes ──────────────────────────────
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
select t.ok(
  (select tt.text from echo.transcript_translation tt
    where tt.segment_id = '99210000-0000-4000-8000-000000000001' and tt.language = 'en') = 'Hello world',
  'the agent reads a translation like any call reader');
select t.denied(
  $$update echo.transcript_translation set text = 'rewritten'
     where segment_id = '99210000-0000-4000-8000-000000000001' and language = 'en'$$,
  'the agent role cannot rewrite a translated line');
select t.denied(
  $$insert into echo.call_translation (call_id, language, org_id)
    values ('c2000000-0000-4000-8000-000000000002', 'fr', '0a000000-0000-4000-8000-00000000000a')$$,
  'the agent role cannot request a translation');

reset role;
