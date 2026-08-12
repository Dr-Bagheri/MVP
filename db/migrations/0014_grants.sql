-- Echo — 0014: role grants. The bottom layer of the permission stack (M3):
-- writes and deletes that no code path should ever perform.
--
-- RLS decides which ROWS. Grants decide which TABLES and which COLUMNS, and
-- unlike a policy predicate they cannot be satisfied by a clever WHERE clause.
-- This is where "the agent deletes nothing, ever" and "the agent may change
-- exactly three things" stop being design intentions and become facts about
-- the database.
--
-- Nothing is granted by default anywhere in this schema. A table added in a
-- later migration without a matching grant fails closed — core/ gets a
-- permission error, which is the failure we want.

revoke all on schema echo from public;
revoke all on all tables    in schema echo from public;
revoke all on all functions in schema echo from public;

-- echo_vendor gets USAGE and nothing else: no table privileges at all. Its
-- only capability is EXECUTE on the two acceptance functions, granted in 0015
-- after they exist — which is why the blanket grant below cannot reach them.
grant usage on schema echo to echo_app, echo_agent, echo_purge, echo_vendor;

-- The helpers every policy calls, plus the trigger functions.
grant execute on all functions in schema echo to echo_app, echo_agent, echo_purge;

-- Supabase ships anon/authenticated for PostgREST. We do not use PostgREST;
-- make sure neither can even see the schema exists.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema echo from %I', r);
      execute format('revoke all on all tables in schema echo from %I', r);
      execute format('revoke all on all functions in schema echo from %I', r);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- echo_app — core/ api and worker.
--
-- Everything except DELETE. Deletion in this product is soft (M11); a
-- physical DELETE from the application would be a bug, so the application
-- cannot express one.
-- ---------------------------------------------------------------------------

grant select, insert, update on
  echo.org, echo.app_user, echo.call, echo.call_part, echo.person,
  echo.call_speaker, echo.transcript_segment, echo.skill, echo.agent_run,
  echo.api_key, echo.webhook, echo.webhook_delivery
to echo_app;

-- Append-only, so no UPDATE for anyone — not even core/. A summary version is
-- written once (invariant 4) and an audit line is not editable (M10). Both
-- also have triggers refusing UPDATE; this is the layer that means the
-- statement is rejected before a policy or a trigger has to have an opinion.
grant select, insert on echo.summary, echo.admin_action to echo_app;

grant select on echo.call_current_summary to echo_app;

-- ---------------------------------------------------------------------------
-- echo_agent — the agent runtime's tool calls.
--
-- Reads: what its caller can read (RLS narrows the rows; these grants narrow
-- the tables and, for app_user, the columns — the agent has no business
-- knowing anyone's email address).
-- ---------------------------------------------------------------------------

grant select on
  echo.org, echo.call, echo.call_part, echo.transcript_segment,
  echo.call_speaker, echo.person, echo.summary, echo.skill, echo.agent_run
to echo_agent;

grant select (id, org_id, display_name, avatar_url, role, status)
  on echo.app_user to echo_agent;

grant select on echo.call_current_summary to echo_agent;

-- Writes: exactly the three tools in SPEC, column by column.
--
--   1. correct a transcript  → the text (and the word timings that go with
--      it). Not the identity, not the timeline: those are pinned by the
--      trigger in 0011, and edited_at/edited_by are stamped there rather than
--      supplied, so the agent cannot forge an edit as someone else.
grant update (text, words) on echo.transcript_segment to echo_agent;

--   2. edit the speaker roster → the label, and the link to a directory
--      person. linked_by/linked_at are stamped by the trigger; the M11
--      owner-only rule is enforced there too.
grant update (label, person_id) on echo.call_speaker to echo_agent;
grant insert on echo.call_speaker to echo_agent;
grant insert on echo.person       to echo_agent;

--   3. replace a summary → insert a new version. There is no UPDATE grant on
--      echo.summary for anyone, and no grant on echo.call at all, so moving
--      the "current" pointer is structurally impossible to do destructively.
grant insert on echo.summary to echo_agent;

-- Its own audit trail (invariant 5).
grant insert on echo.agent_run to echo_agent;
grant update (status, steps, tokens_in, tokens_out, error, finished_at)
  on echo.agent_run to echo_agent;

-- Said once more, explicitly, because it is the invariant most likely to be
-- eroded by a future migration that grants in bulk:
revoke delete on all tables in schema echo from echo_agent;

-- And the tables the agent has no business touching at all — no grant is
-- issued above, but state it so a bulk grant later has to argue with a
-- revoke: the gateway's keys and webhooks, and the human audit log.
revoke all on echo.api_key, echo.webhook, echo.webhook_delivery,
              echo.admin_action
  from echo_agent;

-- ---------------------------------------------------------------------------
-- echo_purge — the 30-day hard purge and nothing else.
--
-- The only role in this database holding DELETE. Its RLS policies (0013)
-- allow it to see and delete only rows whose window has already expired, so
-- even a purge job with a bad WHERE clause cannot take a live call.
--
-- Delete order matters (foreign keys): summary → agent_run →
-- transcript_segment → call_speaker → call_part → call.
-- ---------------------------------------------------------------------------

grant select, delete on
  echo.summary, echo.agent_run, echo.transcript_segment,
  echo.call_speaker, echo.call_part, echo.call
to echo_purge;
