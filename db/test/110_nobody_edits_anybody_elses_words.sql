-- db/0196 — a room message's BODY belongs to its author; the row may still be
-- tombstoned by an admin.
--
-- 0184's policy admitted "the author or an admin" on every column, so an
-- owner could rewrite a colleague's sentence under the colleague's name and
-- the room, the transcript the agents read, and the record all carried it.
-- The trigger of 0196 narrows the COLUMN; this file walks the matrix both
-- ways — rule 7's corollary: the privileged path, the refused path AND the
-- ordinary path (the author's own edit).
--
--   alice  owner,  org A   01000000-0000-4000-8000-000000000001
--   bob    member, org A   02000000-0000-4000-8000-000000000002

reset role;

insert into echo.chat_channel (id, org_id, name, created_by) values
  ('b1000000-0000-4000-8000-000000000110', '0a000000-0000-4000-8000-00000000000a',
   'اتاق ۱۱۰', '01000000-0000-4000-8000-000000000001');

insert into echo.chat_message (id, org_id, channel_id, author_kind, author_id, body) values
  ('b1000000-0000-4000-8000-000000000111', '0a000000-0000-4000-8000-00000000000a',
   'b1000000-0000-4000-8000-000000000110', 'user',
   '02000000-0000-4000-8000-000000000002', 'حرف باب');

-- ── the refused path: an owner changes a member's words ────────────────────
select set_config('role', 'echo_app', true);
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.denied(
  $$update echo.chat_message set body = 'حرف جعلی' where id = 'b1000000-0000-4000-8000-000000000111'$$,
  'an owner may not change a colleague''s words');

-- ── the privileged path: the same owner tombstones the same message ────────
update echo.chat_message set deleted_at = now()
 where id = 'b1000000-0000-4000-8000-000000000111';

reset role;
select t.ok(
  (select deleted_at from echo.chat_message where id = 'b1000000-0000-4000-8000-000000000111') is not null,
  'an owner may tombstone a colleague''s message — moderation is a real need');
select t.ok(
  (select body from echo.chat_message where id = 'b1000000-0000-4000-8000-000000000111') = 'حرف باب',
  'the tombstone left the words as the author wrote them');

update echo.chat_message set deleted_at = null
 where id = 'b1000000-0000-4000-8000-000000000111';

-- ── the ordinary path: the author edits their own ──────────────────────────
select set_config('role', 'echo_app', true);
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

update echo.chat_message set body = 'حرف باب، ویرایش‌شده', edited_at = now()
 where id = 'b1000000-0000-4000-8000-000000000111';

reset role;
select t.ok(
  (select body from echo.chat_message where id = 'b1000000-0000-4000-8000-000000000111') = 'حرف باب، ویرایش‌شده',
  'the author edits their own words');

-- ── an agent''s words are nobody''s to edit ─────────────────────────────────
insert into echo.chat_message (id, org_id, channel_id, author_kind, author_id, agent_handle, body) values
  ('b1000000-0000-4000-8000-000000000112', '0a000000-0000-4000-8000-00000000000a',
   'b1000000-0000-4000-8000-000000000110', 'agent', null, 'roya', 'حرف رؤیا');

select set_config('role', 'echo_app', true);
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.denied(
  $$update echo.chat_message set body = 'حرف جعلی' where id = 'b1000000-0000-4000-8000-000000000112'$$,
  'an owner may not put words in an agent''s mouth either');
reset role;

-- ── the control: the trigger is installed on the table ─────────────────────
select t.ok(
  exists (select 1 from pg_trigger where tgname = 'chat_message_body_is_the_authors'
             and tgrelid = 'echo.chat_message'::regclass and not tgisinternal),
  'the trigger that refuses a foreign edit exists on echo.chat_message');

delete from echo.chat_message where channel_id = 'b1000000-0000-4000-8000-000000000110';
delete from echo.chat_channel where id = 'b1000000-0000-4000-8000-000000000110';
