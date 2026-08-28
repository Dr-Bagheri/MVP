-- 0120 — a workflow run can be started by an email, and knows whose provider.
--
-- The user's sentence: "all these is not just a text that we show, it must be
-- editable and part of the puzzled structure that we built". The five steps
-- on the mail template's page are product copy in a locale file; the work is
-- done by a hardcoded worker sweep. This is the schema half of making the
-- steps REAL — a graph the engine runs, and therefore a graph a person can
-- rearrange.
--
-- ── Two columns and one enum value, and no more than that ───────────────
--
-- `mail.received` joins the trigger events. The POLLER still owns detection,
-- the cursor, the age ceiling and the dedupe — machinery no author touches,
-- which is how every mature engine draws the line (Zapier exposes no dedupe
-- surface at all; n8n exposes one and caps its memory). What reaches the
-- graph is one fact: a new message arrived, and here is its reference.
--
-- `trigger_source` carries WHICH provider's reference that is. A Gmail id and
-- a Graph id are both text and are not interchangeable; without this the run
-- would have to guess, and a guess here reads the wrong mailbox.
--
-- ── What is deliberately NOT here ───────────────────────────────────────
--
-- The message itself. `workflow_run` and `workflow_step_run` are readable by
-- ADMINS (0104), and only `workflow_step_output` is owner-only. A subject
-- line on the run row would hand every admin a window into a member's
-- correspondence — the precise thing W16 exists to prevent. So the trigger
-- carries a REFERENCE and the graph's first step fetches the content under
-- the owner's own grant, where it stays.

begin;

alter table echo.workflow_run
  add column trigger_source text
    check (trigger_source is null or trigger_source in ('google', 'microsoft'));

comment on column echo.workflow_run.trigger_source is
  'Which provider the trigger_ref belongs to, for runs started by a connector fact. Null for every other trigger. A reference, never content.';

-- The event vocabulary, widened where 0108 enumerated it. The constraint was
-- created inline by `add column`, so it carries Postgres's generated name;
-- found by definition rather than by guessing at it (the 0107 pattern).
do $$
declare c text;
begin
  select con.conname into c
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'echo' and t.relname = 'workflow'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%trigger_event%';
  if c is not null then
    execute format('alter table echo.workflow drop constraint %I', c);
  end if;
end $$;

alter table echo.workflow
  add constraint workflow_trigger_event_known
  check (trigger_event is null or trigger_event in ('call.summarized', 'mail.received'));

commit;
