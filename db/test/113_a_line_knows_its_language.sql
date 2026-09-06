-- 0200: a transcript line's language — written by the owner's app role with
-- the rest of the row, read back by a call reader, refused as anything but
-- a language tag, and never a column the agent role may rewrite.
--
-- The wall did not move: the same policies (0013) admit the same actors.
-- What this file adds is the column's own contract, at the altitude it is
-- promised — the CHECK is the enforcer, and a sentence in the column would
-- render as a language on every screen that reads it.

reset role;
set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0200 policy test runs under a non-bypass product role');
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

-- bob's own call and part, as the fixture seeds them
select t.ok(
  exists (select 1 from echo.call where id = 'c1000000-0000-4000-8000-000000000001'),
  'the fixture call is visible to its owner');

insert into echo.transcript_segment
  (id, call_id, org_id, part_id, seq, start_ms, end_ms, text, language)
select '99200000-0000-4000-8000-000000000001', c.id, c.org_id, null, 990001, 1000, 2000, 'this line is english', 'en'
  from echo.call c where c.id = 'c1000000-0000-4000-8000-000000000001';
insert into echo.transcript_segment
  (id, call_id, org_id, part_id, seq, start_ms, end_ms, text)
select '99200000-0000-4000-8000-000000000002', c.id, c.org_id, null, 990002, 2000, 3000, 'این خط فارسی است'
  from echo.call c where c.id = 'c1000000-0000-4000-8000-000000000001';

select t.ok(
  (select language from echo.transcript_segment where id = '99200000-0000-4000-8000-000000000001') = 'en',
  'the owner writes a line''s language with the row and reads it back');
select t.ok(
  (select language from echo.transcript_segment where id = '99200000-0000-4000-8000-000000000002') is null,
  'a line written without a language is null — not said, never defaulted');

-- the CHECK is the enforcer: a word is not a tag, an upper-case tag is not the provider's
select t.denied(
  $$insert into echo.transcript_segment (call_id, org_id, seq, start_ms, end_ms, text, language)
    select c.id, c.org_id, 990003, 3000, 4000, 'x', 'English' from echo.call c where c.id = 'c1000000-0000-4000-8000-000000000001'$$,
  'a sentence cannot land in the language column');
select t.denied(
  $$insert into echo.transcript_segment (call_id, org_id, seq, start_ms, end_ms, text, language)
    select c.id, c.org_id, 990004, 4000, 5000, 'x', 'FA' from echo.call c where c.id = 'c1000000-0000-4000-8000-000000000001'$$,
  'an upper-case tag is refused — one spelling');

-- the agent role's column grant (0014) is text and words: the language is not its to rewrite
reset role;
set local role echo_agent;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  (select language from echo.transcript_segment where id = '99200000-0000-4000-8000-000000000001') = 'en',
  'the agent reads the language like any call reader');
select t.denied(
  $$update echo.transcript_segment set language = 'fa' where id = '99200000-0000-4000-8000-000000000001'$$,
  'the agent role cannot rewrite a line''s language');

reset role;
