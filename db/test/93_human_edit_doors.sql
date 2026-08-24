-- 0092: human edit doors — versioned summary edits, corrected lines, the
-- 0077 hierarchy at both doors. Ordinary path first: the owner of the
-- record edits their own material (the ordinary path is the product).

reset role;
-- a visible-but-outranked row for the refusal case (org-scoped, admin-owned):
-- an invisible row refuses by matching nothing, which raises nothing
insert into echo.call (id, org_id, owner_id, title, scope, status) values
  ('c9200000-0000-4000-8000-000000000092', '0a000000-0000-4000-8000-00000000000a',
   '06000000-0000-4000-8000-000000000006', 'جلسهٔ مدیر', 'org', 'ready');
insert into echo.transcript_segment
  (id, call_id, org_id, part_id, seq, start_ms, end_ms, call_speaker_id, text) values
  ('a9200000-0000-4000-8000-000000000092', 'c9200000-0000-4000-8000-000000000092',
   '0a000000-0000-4000-8000-00000000000a', null, 0, 0, 1000, null, 'متن مدیر');
set local role echo_app;

-- ── summary: bob edits his own record — a NEW version, authored human ─────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  echo.edit_summary('c1000000-0000-4000-8000-000000000001', 'خلاصهٔ ویرایش‌شده توسط باب') >= 1,
  'the owner writes a summary edit and gets a version number back');
select t.ok(
  exists (select 1 from echo.summary s
           where s.call_id = 'c1000000-0000-4000-8000-000000000001'
             and s.body = 'خلاصهٔ ویرایش‌شده توسط باب'
             and s.model = 'human'
             and s.created_by = '02000000-0000-4000-8000-000000000002'),
  'the version records human authorship and the editor');
select t.ok(
  (select s.body from echo.summary s
    join echo.call c on c.current_summary_id = s.id
   where c.id = 'c1000000-0000-4000-8000-000000000001')
    = 'خلاصهٔ ویرایش‌شده توسط باب',
  'the current pointer moved to the edit — the 0008 trigger fired');

-- a second edit stacks a HIGHER version, never overwrites
select t.ok(
  echo.edit_summary('c1000000-0000-4000-8000-000000000001', 'نسخهٔ دوم')
    > (select min(s.version) from echo.summary s
        where s.call_id = 'c1000000-0000-4000-8000-000000000001'),
  'a second edit is a higher version; nothing is overwritten');

-- ── transcript: bob corrects his own line — words cleared, edit stamped ───
select t.ok(
  echo.edit_transcript_segment('a1000000-0000-4000-8000-000000000001', 'متن اصلاح‌شده'),
  'the owner corrects a line of their own transcript');
select t.ok(
  exists (select 1 from echo.transcript_segment s
           where s.id = 'a1000000-0000-4000-8000-000000000001'
             and s.text = 'متن اصلاح‌شده'
             and s.words = '[]'::jsonb
             and s.edited_at is not null
             and s.edited_by = '02000000-0000-4000-8000-000000000002'),
  'text replaced, words cleared, edited_at/edited_by stamped');

-- ── the wall: a member cannot edit an outranking owner''s material ─────────
select t.denied(
  $$select echo.edit_summary('c9200000-0000-4000-8000-000000000092', 'نفوذ')$$,
  'a member cannot write a summary version onto the admin''s record');
select t.denied(
  $$select echo.edit_transcript_segment('a9200000-0000-4000-8000-000000000092', 'نفوذ')$$,
  'nor correct a line of it');

-- the OWNER (alice) outranks the admin — allowed, same rule as rename
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  echo.edit_transcript_segment('a9200000-0000-4000-8000-000000000092', 'اصلاح توسط مالک'),
  'the org owner corrects the admin''s line — outranking decides');

-- ── shape wall ────────────────────────────────────────────────────────────
select t.denied(
  $$select echo.edit_summary('c1000000-0000-4000-8000-000000000001', '   ')$$,
  'a blank summary body is refused');

-- sweep
reset role;
delete from echo.transcript_segment where id = 'a9200000-0000-4000-8000-000000000092';
delete from echo.call where id = 'c9200000-0000-4000-8000-000000000092';
set local role echo_app;
