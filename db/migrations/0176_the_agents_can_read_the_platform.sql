-- 0176 — the agents can read the platform
--
-- User directive, 2026-09-04: "they must have full access and full capability
-- … anything that a human can do on this platform, these 3 must do."
--
-- ── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────
--
-- `core/src/agent/platform-tools.ts` implements seventeen read tools — list
-- meetings, get a meeting, list tasks, get a task, list colleagues, member
-- stats, list a record's notes. They are written, tested, and reachable ONLY
-- through a nested delegate call: `createPlatformTools()` has no caller in the
-- api, so **Echo itself has never had them**, and the file's own header says
-- the opposite.
--
-- That is rule 13½ at feature scale, and it is the second time: the webhook
-- dispatcher was written, line-reviewed, guarded against SSRF, and never
-- registered as a queue handler.
--
-- And of the seventeen, ELEVEN could not have executed anyway. Agent tools run
-- as `echo_agent` (server.ts builds tool deps with `agentToolsDb`), and that
-- role has no grant on `echo.meeting`, on any `task%` table, on `call_note`,
-- or on `user_status_history`. Wiring the tools in without these grants would
-- have shipped eleven tools that fail at runtime, in production, on the first
-- question that reaches one.
--
-- ── WHY READS AND ONLY READS ──────────────────────────────────────────────
--
-- SELECT is the whole of this migration. RLS still decides which rows: every
-- policy here is org-scoped and the agent borrows the caller's authority, so
-- what the agent can read is what the person who asked can read, and not one
-- row more. Nothing about the write wall changes — no INSERT, no UPDATE, no
-- DELETE, and `echo_agent` still holds DELETE on nothing anywhere.
--
-- The original absence was not a considered refusal. Tasks and meetings landed
-- (0144, 0145) at a time when the agent had no business reading them; the
-- grants were never written because nothing needed them. That is different
-- from a wall, and the difference matters when deciding whether to move one.
--
-- ── WHAT IS DELIBERATELY LEFT OUT ─────────────────────────────────────────
--
-- `admin_action` stays REVOKED (0014), so `list_audit` remains unusable by an
-- agent. That one IS a considered refusal: the audit trail records what people
-- did, it is admin-only on the product surface, and an agent that can read
-- every administrative action in an organisation is a summarising machine
-- pointed at exactly the log that exists to watch it. The tool is excluded
-- from the agent toolset in code with that reason, rather than shipped and
-- left to throw.
--
-- `app_user.email` stays denied (30_agent_wall asserts it). `list_members`
-- selects it today, which is why that tool fails too; the fix is in the query,
-- not in this grant.

begin;

-- ── meetings ───────────────────────────────────────────────────────────────
grant select on echo.meeting        to echo_agent;
grant select on echo.meeting_topic  to echo_agent;

-- ── the task board ─────────────────────────────────────────────────────────
-- Note for whoever reads 0144's self-check and wonders: that check asserts no
-- `task%` grant existed AT ITS POINT IN THE CHAIN, and it still passes on a
-- fresh apply because it runs long before this file. It was guarding against
-- an accidental grant, not ruling on a considered one.
grant select on echo.task                 to echo_agent;
grant select on echo.task_column          to echo_agent;
grant select on echo.task_topic           to echo_agent;
grant select on echo.task_label           to echo_agent;
grant select on echo.task_label_link      to echo_agent;
grant select on echo.task_assignee        to echo_agent;
grant select on echo.task_checklist_item  to echo_agent;
grant select on echo.task_comment         to echo_agent;
grant select on echo.task_event           to echo_agent;

-- ── a record's notes, and the movement behind member stats ────────────────
grant select on echo.call_note            to echo_agent;
grant select on echo.user_status_history  to echo_agent;

-- ── the colleague list needs the second name ──────────────────────────────
-- `list_colleagues` selects `display_name_en`, which is outside the six-column
-- grant from 0014 — so the tool fails on a column, not on a table, which is
-- the harder kind to see. `username` joins it for the same reason: an @handle
-- is how a person is addressed and the agent already renders one.
--
-- `email` is NOT here and must never be. It is the one column the standing
-- wall test names, and a directory the agent can read is a mailing list the
-- agent can read.
grant select (id, org_id, display_name, display_name_en, username, avatar_url,
              role, status, job_title, kind, agent_handle)
  on echo.app_user to echo_agent;

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare
  v_missing text;
  v_bad     text;
begin
  -- every table this migration claims to open is actually open. `pg_class.relacl`
  -- and NOT information_schema: the catalogue VIEWS are permission-filtered and
  -- answer "none" for a grant that exists, which is a negative wearing the
  -- costume of a fact (the purge-edge near-miss, 2026-08-13).
  select string_agg(t, ', ') into v_missing from unnest(array[
    'meeting','meeting_topic','task','task_column','task_topic','task_label',
    'task_label_link','task_assignee','task_checklist_item','task_comment',
    'task_event','call_note','user_status_history'
  ]) as t
  where not has_table_privilege('echo_agent', 'echo.' || t, 'SELECT');
  if v_missing is not null then
    raise exception 'CHECK FAILED: echo_agent still cannot read: %', v_missing;
  end if;

  -- and NOTHING here became writable. The point of the migration is that it is
  -- a read grant; asserting the reads without asserting the absence of writes
  -- would be the privileged half of the matrix with the ordinary half missing.
  select string_agg(t || ':' || p, ', ') into v_bad
    from unnest(array[
      'meeting','meeting_topic','task','task_column','task_topic','task_label',
      'task_label_link','task_assignee','task_checklist_item','task_comment',
      'task_event','call_note','user_status_history'
    ]) as t,
    unnest(array['INSERT','UPDATE','DELETE']) as p
   where has_table_privilege('echo_agent', 'echo.' || t, p);
  if v_bad is not null then
    raise exception 'CHECK FAILED: this migration granted a WRITE: %', v_bad;
  end if;

  -- the column that must stay shut. Asserted here rather than trusting the
  -- column list above to be read correctly — a `grant select (…)` that
  -- accidentally names one more column looks identical to one that does not.
  if has_column_privilege('echo_agent', 'echo.app_user', 'email', 'SELECT') then
    raise exception 'CHECK FAILED: echo_agent can read app_user.email';
  end if;

  -- and the widened column grant DID widen — without this, a typo in the
  -- column list leaves `list_colleagues` broken and every check above green
  if not has_column_privilege('echo_agent', 'echo.app_user', 'display_name_en', 'SELECT') then
    raise exception 'CHECK FAILED: display_name_en was not granted';
  end if;

  -- the standing wall, re-stated at the point a grant was added: still no
  -- DELETE anywhere. This migration is the most likely one in the chain to
  -- have broken it, so it says so itself rather than waiting for the suite.
  if exists (
    select 1 from information_schema.role_table_grants
     where grantee = 'echo_agent' and privilege_type = 'DELETE'
  ) then
    raise exception 'CHECK FAILED: echo_agent holds a DELETE grant';
  end if;
end $chk$;

commit;
