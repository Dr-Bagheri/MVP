-- 0196 — nobody edits anybody else's words: the wall for a room message's BODY.
--
-- 0184 wrote the rule in its own comment — "an admin may tombstone anybody's;
-- nobody may edit anybody else's words, which is the distinction that
-- matters: removing a message and putting words in somebody's mouth are not
-- the same power" — and then enforced HALF of it: `chat_message_update`
-- admits the author OR an admin, on every column. Found by the 2026-09-06
-- check-up: an admin's `PATCH /v1/chat/messages/<id> {body}` on a
-- colleague's message answered 200, the row kept the colleague's name, gained
-- only `edited_at`, and `roomTranscript()` — what the agents read as "B
-- said" — carried the admin's sentence under B's name. It worked on an
-- agent's row too (author_id null), undoing "an agent impersonating a
-- colleague is unrepresentable" one hop over.
--
-- The policy STAYS as it is, because it is right about the row: an admin may
-- reach a colleague's message to tombstone it. What narrows is the COLUMN,
-- and a column rule is a trigger, not a policy — RLS decides which rows a
-- statement may touch, never which columns. The trigger refuses any UPDATE
-- that changes `body` unless the row's author is the actor; every other
-- column (deleted_at, edited_at as part of an author's own edit) is
-- untouched. core/src/api/chat.ts adds the author predicate on the edit
-- statement as well, so the ordinary refusal is a clean 404 and the trigger is
-- the wall behind it, for any writer that forgets.
--
-- Agent rows have no author_id; nobody edits them (an agent's words are the
-- record of what it said), so `is distinct from` refuses those too.

begin;

create or replace function echo.tg_chat_message_body_is_the_authors()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body
     and old.author_id is distinct from echo.actor_id() then
    raise exception 'only the author may edit a message''s words'
      using errcode = '42501', hint = 'chat_body_not_yours';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_message_body_is_the_authors on echo.chat_message;
create trigger chat_message_body_is_the_authors
  before update on echo.chat_message
  for each row execute function echo.tg_chat_message_body_is_the_authors();

-- ── self-check: the refusal and the ordinary path, at owner altitude with
--    the actor set by hand (the guard reads echo.actor_id()) ────────────────
do $chk$
declare
  v_org     uuid;
  v_alice   uuid;
  v_bob     uuid;
  v_channel uuid;
  v_msg     uuid;
  v_refused boolean := false;
begin
  select u.org_id, u.id into v_org, v_alice
    from echo.app_user u where u.status = 'active' order by u.created_at limit 1;
  select u.id into v_bob
    from echo.app_user u where u.status = 'active' and u.org_id = v_org and u.id <> v_alice
    order by u.created_at limit 1;
  if v_org is null or v_bob is null then
    raise notice '0196: fewer than two active members in one org — trigger installed, path unproven here';
    return;
  end if;

  insert into echo.chat_channel (org_id, name, created_by)
  values (v_org, '__0196_probe__', v_alice) returning id into v_channel;
  insert into echo.chat_message (org_id, channel_id, author_kind, author_id, body)
  values (v_org, v_channel, 'user', v_bob, '__0196_probe__') returning id into v_msg;

  /* alice, an owner, changes bob's words: refused */
  perform set_config('echo.actor_id', v_alice::text, true);
  begin
    update echo.chat_message set body = '__0196_forged__' where id = v_msg;
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'CHECK FAILED: an owner changed a colleague''s words';
  end if;
  /* alice tombstones bob's message: allowed — moderation is a real need */
  update echo.chat_message set deleted_at = now() where id = v_msg;
  if (select deleted_at from echo.chat_message where id = v_msg) is null then
    raise exception 'CHECK FAILED: an owner could not tombstone a colleague''s message';
  end if;
  /* bob edits his own: allowed */
  update echo.chat_message set deleted_at = null where id = v_msg;
  perform set_config('echo.actor_id', v_bob::text, true);
  update echo.chat_message set body = '__0196_edited__', edited_at = now() where id = v_msg;
  if (select body from echo.chat_message where id = v_msg) <> '__0196_edited__' then
    raise exception 'CHECK FAILED: the author could not edit their own words';
  end if;

  perform set_config('echo.actor_id', '', true);
  delete from echo.chat_message where id = v_msg;
  delete from echo.chat_channel where id = v_channel;
end $chk$;

commit;
