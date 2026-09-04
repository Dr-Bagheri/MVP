-- 0175 — a thread remembers who is answering
--
-- User directive, 2026-09-04: "in the assistant page when i send a message,
-- take a message to a neutral ground and see which of them are getting called
-- first — only that one should answer. It is correct that the main brain is
-- echo and roya and ava is its helpers, but i dont want echo to call them each
-- time."
--
-- Today every turn is Echo's, and a specialist speaks only when Echo calls one
-- as a tool. The frameworks that ship this pattern name the two shapes and the
-- difference is exactly the user's complaint: an agent-as-TOOL leaves the
-- caller owning the user-facing conversation, while a HANDOFF gives the chosen
-- specialist the whole turn. What is being asked for is the handoff.
--
-- ── WHY THE THREAD HAS TO REMEMBER ────────────────────────────────────────
--
-- Routing per message, with no memory of who answered last, thrashes. The
-- reported shape from a router in production: turn one asks a hard question
-- and lands on the strong model; turn two says "looks good, commit it" and
-- lands on a small one, because "commit it" classifies as nothing in
-- particular. In this product that is «و بعدش؟» after an answer from Ava
-- arriving at Echo, and the person watching one name reply and a different
-- name follow up.
--
-- So the incumbent is a COLUMN. A follow-up stays with whoever is already
-- speaking unless the router is confident the topic moved — cheap to stay,
-- expensive to switch. Storing it on the session rather than deriving it from
-- the last message is deliberate: `agent_message.author` is null for Echo, and
-- "nobody has answered yet" and "Echo answered" would be the same read.
--
-- Nullable, and null means the honest thing: no turn has been routed in this
-- conversation yet. A default of 'echo' would make the first message look like
-- a decision somebody made.

begin;

alter table echo.agent_session
  add column current_agent text
    -- an agent HANDLE, or 'echo' for the platform assistant, which has no row
    -- in assistant_agent and never will. The regex is the same shape the
    -- handle column uses; a foreign key is impossible for exactly that reason.
    check (current_agent is null or current_agent ~ '^[a-z][a-z0-9_]{1,30}$');

comment on column echo.agent_session.current_agent is
  'Who answered the last routed turn — the router''s incumbent (0175). '
  'null = nothing routed yet. ''echo'' is the platform assistant, which has no '
  'assistant_agent row; every other value is a handle. Read to keep a '
  'follow-up with whoever is already speaking; written only when the router '
  'switches or first decides.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare v_ok boolean;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'echo' and table_name = 'agent_session'
       and column_name = 'current_agent' and is_nullable = 'YES'
  ) then
    raise exception 'CHECK FAILED: current_agent missing or not nullable';
  end if;

  -- the constraint actually refuses something. A check nobody proves can
  -- reject is a check that might be matching everything.
  begin
    insert into echo.agent_session (org_id, actor_id, current_agent)
    select o.id, u.id, 'NOT A HANDLE'
      from echo.app_user u join echo.org o on o.id = u.org_id limit 1;
    raise exception 'CHECK FAILED: current_agent accepted a value that is not a handle';
  exception
    when check_violation then null;      -- what we want
    when no_data_found then null;        -- an empty database has nobody to insert as
  end;

  -- and it ACCEPTS a real one — without this the check above passes against a
  -- constraint that refuses everything, which would break every routed turn
  select true into v_ok;
  begin
    insert into echo.agent_session (org_id, actor_id, current_agent)
    select o.id, u.id, 'roya'
      from echo.app_user u join echo.org o on o.id = u.org_id limit 1;
    -- rolled back below; this migration must leave no rows behind
  exception when check_violation then
    raise exception 'CHECK FAILED: current_agent refused a valid handle';
  end;
  delete from echo.agent_session where current_agent = 'roya' and title = '';
end $chk$;

commit;
