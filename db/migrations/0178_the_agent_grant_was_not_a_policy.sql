-- 0178 — the agent's read grant was not a read policy
--
-- User report, 2026-09-04: both Echo and Roya answered «متأسفانه به دلیل خطای
-- سیستمی … دسترسی به لیست تسک‌ها … وجود ندارد», on a screen with the board
-- visibly full of cards beside them.
--
-- ── WHAT HAPPENED ─────────────────────────────────────────────────────────
--
-- db/0176 gave `echo_agent` SELECT on the task, meeting and note tables and
-- stopped there. Every policy on those tables names `echo_app` and only
-- `echo_app`, and RLS admits nothing a policy does not name — so the grant let
-- the agent ISSUE the query and the policy returned zero rows for it. The
-- agent could reach the table and could not see anything in it.
--
-- That is silent almost everywhere: an assistant asked about meetings would
-- have said "you have none", confidently, with the calendar full. It became
-- LOUD on the board only by accident — `board()` treats an empty column list
-- as a first visit and inserts the four defaults, so the read tried to write,
-- and `echo_agent` has no INSERT. A PostgresError is what the user finally
-- saw, and it was the best outcome available: the same defect on `meeting`
-- produced a polite wrong answer instead.
--
-- The rule this repo already had, arriving again: A GRANT IS NOT A POLICY.
-- They are separate walls and both must name you. A migration that adds one
-- and calls the capability done has built a table the role reads as empty.
--
-- ── WHAT THIS GIVES, AND WHAT IT DOES NOT ─────────────────────────────────
--
-- SELECT only, and each policy is the app's own read predicate copied
-- unchanged — so the agent sees exactly what the person it is acting for
-- sees, which is invariant 3 and the reason these can be added at all. No
-- INSERT, no UPDATE, no DELETE for `echo_agent` anywhere below: an agent that
-- writes does it through the person's browser, on the person's session, where
-- their role is the wall.
--
-- `user_status_history` keeps the app's admin condition, so `member_stats`
-- through an agent tells a member exactly what the members screen would: the
-- current counts and no trend. A capability that is quietly wider through the
-- assistant than through the screen is the shape invariant 3 exists to forbid.

begin;

-- ── the board ─────────────────────────────────────────────────────────────
create policy task_agent_read on echo.task
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_column_agent_read on echo.task_column
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_topic_agent_read on echo.task_topic
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_assignee_agent_read on echo.task_assignee
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_label_agent_read on echo.task_label
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_label_link_agent_read on echo.task_label_link
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_checklist_item_agent_read on echo.task_checklist_item
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_comment_agent_read on echo.task_comment
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_event_agent_read on echo.task_event
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

-- ── meetings ──────────────────────────────────────────────────────────────
create policy meeting_agent_read on echo.meeting
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy meeting_topic_agent_read on echo.meeting_topic
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

-- ── notes on a record ─────────────────────────────────────────────────────
-- `can_read_call` is the app policy's own predicate, so a note is readable
-- exactly where its record is: a private call's notes stay private to the
-- assistant for the same reason they stay private to a colleague.
create policy call_note_agent_read on echo.call_note
  for select to echo_agent
  using (echo.can_read_call(call_id));

-- ── the membership trend ──────────────────────────────────────────────────
create policy user_status_history_agent_read on echo.user_status_history
  for select to echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_admin());

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  blind int;
  wide  int;
  names text;
begin
  /*
   * THE CHECK IS THE FINDING, PROMOTED. Every table `echo_agent` may SELECT
   * must have a policy that admits it — that is precisely the condition 0176
   * broke, and stating it as a query means the next grant-without-policy
   * fails here instead of being reported by somebody's assistant.
   *
   * `c.oid` rather than 'echo.' || relname: the name form makes Postgres
   * resolve a schema-qualified name for rows the planner has not filtered
   * yet, and it errored on `echo.pg_statistic` when this was first written
   * as a probe.
   */
  select count(*), coalesce(string_agg(t.relname, ', ' order by t.relname), '')
    into blind, names
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'echo' and t.relkind = 'r'
     and has_table_privilege('echo_agent', t.oid, 'select')
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'echo' and p.tablename = t.relname
          and ('echo_agent' = any(p.roles) or 'public' = any(p.roles))
     );
  if blind > 0 then
    raise exception
      'CHECK FAILED: % table(s) the agent may SELECT have no policy admitting it — it reads them as EMPTY: %',
      blind, names;
  end if;

  /*
   * And nothing here widened the agent past reading. The whole design rests
   * on the agent borrowing the caller's authority and never more; a write
   * privilege arriving on this role is that premise breaking.
   */
  select count(*) into wide
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'echo' and t.relkind = 'r'
     and t.relname in (
       'task', 'task_column', 'task_topic', 'task_assignee', 'task_label',
       'task_label_link', 'task_checklist_item', 'task_comment', 'task_event',
       'meeting', 'meeting_topic', 'call_note', 'user_status_history')
     and (has_table_privilege('echo_agent', t.oid, 'insert')
       or has_table_privilege('echo_agent', t.oid, 'update')
       or has_table_privilege('echo_agent', t.oid, 'delete'));
  if wide > 0 then
    raise exception 'CHECK FAILED: % of the tables this migration opened gave the agent more than SELECT', wide;
  end if;
end $chk$;

commit;
