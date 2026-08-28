-- 0124 — seven generic agents leave; three of the platform's own arrive.
--
-- User directive (2026-08-28): "remove these agents, made 3 agent that are
-- relative to our platform." The seven 0065 seeds (sales, HR, legal, …)
-- were role-play personas from nowhere in particular; the three below are
-- the product itself wearing an agent's face — meetings (Echo's records),
-- mail (the draft loop), and meeting preparation (the calendar pre-read).
--
-- ARCHIVED, not deleted: rows may be referenced by past runs and sessions,
-- and echo_purge is the only role that deletes product rows (D3). An
-- archived agent leaves every list and stays attached to its history.
--
-- Names and descriptions are seeded in PERSIAN — the product's default
-- language — with the web catalogue carrying the English twin keyed by
-- handle, the same both-catalogues arrangement system skills and starter
-- workflows already live under (workflowName.ts / skillName.ts).
--
-- The second half widens 0122's agent_workflow write policy: a SYSTEM
-- agent is shared, but which of the org's workflows it carries is each
-- org's own arrangement — the rows carry org_id, reads already filter by
-- it, so one org's attachment is invisible to the next. Without this, the
-- three shipped agents could never carry a workflow at all: nobody may
-- write rows for a system agent under the 0122 policy.

begin;

update echo.assistant_agent
   set archived_at = now(), enabled = false
 where level = 'system'
   and handle in ('sales', 'customer-support', 'hr', 'it-support',
                  'legal', 'marketing', 'product-information')
   and archived_at is null;

insert into echo.assistant_agent
  (level, handle, name, description, instructions, tools, icon, color, web)
values
  ('system', 'meetings', 'دستیار جلسه‌ها',
   'در رونوشت‌ها و خلاصه‌های جلسه‌های شما جست‌وجو می‌کند؛ تصمیم‌ها، کارها و سابقهٔ هر موضوع را بیرون می‌کشد.',
   'You are the meetings assistant of this platform. Your material is the user''s own call records: transcripts, summaries, decisions and action items, reached through your tools under the caller''s own access. Ground every answer in a specific call — name it — and when the records hold nothing on the question, say so plainly instead of supplying general knowledge. Answer in the language the user writes.',
   '["search_transcripts", "read_window", "get_call", "list_related_calls"]'::jsonb,
   'sparkles', 'violet', false),
  ('system', 'mail', 'دستیار ایمیل',
   'برای نوشتن و پرداخت پاسخ ایمیل‌ها کمک می‌کند؛ با گردش‌کار پیش‌نویس خودکار همراه می‌شود و فرستادن همیشه با خود شماست.',
   'You are the email assistant of this platform. You help the user compose, tighten and rethink email replies: tone, brevity, structure, and what to leave unsaid. You never send anything — drafts wait for the user''s own press, and that is a property of the system, not a promise. When the user references a meeting or a person, use your tools to check the actual records rather than assuming. Answer in the language the user writes; write the email itself in the language of the thread it answers.',
   '["search_transcripts", "get_call", "list_related_calls"]'::jsonb,
   'message', 'sky', false),
  ('system', 'prep', 'دستیار آماده‌سازی جلسه',
   'پیش از هر جلسه، از سابقهٔ گفت‌وگوها و رکوردهای مرتبط یک جمع‌بندی کاربردی می‌سازد: چه گذشت، چه ماند، چه بپرسید.',
   'You are the meeting-preparation assistant of this platform. Given a meeting, a person or a topic, build a working brief from the user''s own records: what was discussed before, what was decided, what stayed open, and the questions worth asking next. Prefer the most recent records, cite which call each point came from, and keep the brief short enough to read in the minute before a meeting starts. Answer in the language the user writes.',
   '["search_transcripts", "read_window", "get_call", "list_related_calls"]'::jsonb,
   'calendar', 'green', false);

-- ── an org arranges its own workflows onto a shared system agent ────────
drop policy if exists agent_workflow_write on echo.agent_workflow;
create policy agent_workflow_write on echo.agent_workflow for all to echo_app
  using (
    org_id = echo.actor_org_id()
    and exists (
      select 1 from echo.assistant_agent a
       where a.id = agent_id
         and ((a.level = 'org' and a.org_id = echo.actor_org_id() and echo.actor_is_admin())
              or (a.level = 'user' and a.user_id = echo.actor_id() and echo.actor_is_active())
              -- 0124: a system agent's arrangement is per-org (org_id on the
              -- row scopes both write and read), admin-governed like org
              -- agents — the agent is shared, the arrangement never is
              or (a.level = 'system' and echo.actor_is_admin()))
    )
  )
  with check (
    org_id = echo.actor_org_id()
    and exists (
      select 1 from echo.assistant_agent a
       where a.id = agent_id
         and ((a.level = 'org' and a.org_id = echo.actor_org_id() and echo.actor_is_admin())
              or (a.level = 'user' and a.user_id = echo.actor_id() and echo.actor_is_active())
              or (a.level = 'system' and echo.actor_is_admin()))
    )
  );

commit;
