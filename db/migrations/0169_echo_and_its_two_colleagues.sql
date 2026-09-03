-- 0169 — Echo, and the two colleagues who answer in its thread
--
-- USER DIRECTIVE, 2026-09-03: "first put name for each of them, ai assistant
-- will be called echo, and it has two agents roya and ava, echo should have the
-- option to communicate with roya and ava and call them to the screen ... each
-- of them when they come to the AI assistant page or on the side bar menu have
-- to have their avatar next to the messages they write."
--
-- Two columns, and the interesting one is the first.
--
-- ── WHO WROTE THIS TURN ────────────────────────────────────────────────────
--
-- `agent_message.role` is a PROTOCOL fact: user / assistant / tool is what the
-- model is shown, and every message Roya writes is an assistant turn as far as
-- the conversation is concerned. Who wrote it is a PRESENTATION fact — whose
-- avatar sits beside it, whose name the reader sees.
--
-- Those are different questions, so this is a different column. Widening
-- `agent_message_role` was considered and refused once already, by 0164, for
-- the same reason: every reader of a thread switches on that enum, and a new
-- member is a silent default-case in each of them. Worse here — the model's own
-- transcript would gain a role no provider knows.
--
-- NULL means Echo. Not "unknown": every assistant row written before this
-- migration was written by the assistant, and the assistant is what the user
-- has now named Echo, so NULL reads correctly on every existing row. The
-- alternative — backfilling 'echo' — would claim we know something about old
-- rows that we are in fact only inferring, and the inference is the same either
-- way.
--
-- It is TEXT rather than a foreign key to `assistant_agent`. An agent can be
-- archived, and the thread must still say who spoke: a message whose author
-- vanished because somebody tidied the roster is a record that rewrote itself.
-- Same reasoning as the tool_calls column beside it — the thread keeps what was
-- true when it happened.
--
-- ── WEB ACCESS, PER PERSON ─────────────────────────────────────────────────
--
-- "they must have option of even using the internet if needed that can be turn
-- on in the setting in assistant section, agents web access."
--
-- `assistant_agent.web` already exists and is the AGENT's own setting, which
-- for the two shipped agents is nobody's to change (level = 'system'). This is
-- the PERSON's switch over their own helpers, defaulting OFF: reaching the
-- open web is the one capability here that spends money outside the building
-- and reads text nobody in the organization wrote, so it is opt-in and it is
-- the individual's opt-in, not an admin's default.

begin;

alter table echo.agent_message
  add column if not exists author text
    check (author is null or author ~ '^[a-z0-9][a-z0-9-]{0,62}$');

comment on column echo.agent_message.author is
  '0169: which assistant wrote this turn — an assistant_agent handle, or NULL for Echo (the platform assistant itself). Presentation only: `role` is what the model sees. Deliberately not a foreign key, so an archived agent does not erase its own words from a thread.';

alter table echo.app_user
  add column if not exists agents_web boolean not null default false;

comment on column echo.app_user.agents_web is
  '0169: may this person''s agents search the open web. Per person, default off — it spends money outside the building and reads text nobody here wrote.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare v_ok boolean; v_session uuid; v_org uuid;
begin
  -- the column exists and takes a handle
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'echo' and table_name = 'agent_message' and column_name = 'author'
  ) then
    raise exception 'CHECK FAILED: agent_message.author was not added';
  end if;

  -- the ENUM did not grow — the whole point of a separate column
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'agent_message_role' and e.enumlabel not in ('user', 'assistant', 'tool')
  ) then
    raise exception 'CHECK FAILED: agent_message_role gained a member — authorship belongs in its own column';
  end if;

  -- and the constraint refuses a value that is not a handle
  select org_id, id into v_org, v_session from echo.agent_session limit 1;
  if v_session is null then
    raise notice '0169: no conversation in this database — the constraint check did not run, result unknown';
  else
    v_ok := false;
    begin
      insert into echo.agent_message (session_id, org_id, seq, role, content, author)
      values (v_session, v_org, 99999, 'assistant', 'probe', 'NOT A HANDLE');
    exception when check_violation then v_ok := true;
    end;
    if not v_ok then
      raise exception 'CHECK FAILED: agent_message.author accepted a value that is not a handle';
    end if;

    -- the ORDINARY path, because a check that only asserts refusals leaves the
    -- path the product uses unproven
    insert into echo.agent_message (session_id, org_id, seq, role, content, author)
    values (v_session, v_org, 99999, 'assistant', 'probe', 'roya');
    if not exists (
      select 1 from echo.agent_message
       where session_id = v_session and seq = 99999 and author = 'roya'
    ) then
      raise exception 'CHECK FAILED: a handled author did not survive the insert';
    end if;
    delete from echo.agent_message where session_id = v_session and seq = 99999;
  end if;

  -- the person's switch is off by default, for everybody who already exists
  if exists (select 1 from echo.app_user where agents_web is not false) then
    raise exception 'CHECK FAILED: agents_web is not off for every existing member';
  end if;
end $chk$;

commit;
