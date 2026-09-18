-- 0233 — Echo, Roya and Ava: the difference becomes a fact rather than a prompt.
--
-- User directive, 2026-09-18: "now we have 2 agents ava and roya but i dont
-- know why and they do the same, build them right — and also we have the main
-- one echo or neurai, i dont know the name; make it work somehow that makes
-- sense and give them a full shape."
--
-- ── WHY THEY DO THE SAME, WHICH IS THE PART WORTH WRITING DOWN ─────────────
--
-- Their instructions have always been different and are well written: Ava is
-- the analyst who reads the record and reports, Roya is the operator who gets
-- work done. Read them side by side and they are two jobs.
--
-- And NOTHING ENFORCED IT. On 2026-09-06 the analyst/operator split was
-- deleted — for a good reason, a user report of agents answering «دسترسی
-- ندارم» about records the person could plainly see — and `toolsFor()` became
-- one set for everybody. That fixed the refusals and took the only structural
-- difference with it. Since then the two agents have had identical reads,
-- identical client-side write hands, and identical reach; the only thing
-- telling them apart was a paragraph, and a paragraph is not a wall. The user
-- noticed within two weeks, which is about how long it takes.
--
-- The `tools` column is the same story one layer down: `agent-store` writes
-- it, `delegation` ignores it, and the five names each agent carries have not
-- decided anything since 2026-09-04. It is left in place with its comment
-- corrected — the web still falls back to it when an older core sends no
-- capability list — but it is NOT what an agent may do and this migration says
-- so where somebody reading the schema will see it.
--
-- ── THE AXIS THAT IS WORTH A WALL ─────────────────────────────────────────
--
-- Not subject matter. Narrowing an analyst's READS is what produced «دسترسی
-- ندارم», and it is the wrong axis anyway: a question is a question, and an
-- agent that cannot look something up is not a specialist, it is a broken
-- assistant. Both colleagues keep the whole read surface, exactly as they have
-- since 2026-09-06.
--
-- What distinguishes them is whether they may ACT. `can_act`:
--
--   Roya   TRUE  — the operator. Drafts, creates, schedules, files. Every
--                  write still goes through the person's own browser behind a
--                  consent card; this decides whether she is offered the hands
--                  at all.
--   Ava    FALSE — the analyst. Reads everything, changes nothing. Asked to do
--                  something she says whose job it is, rather than doing it.
--
-- That is the orchestrator/specialist shape the outside world settled on:
-- ECHO is the orchestrator a person talks to and holds the conversation; the
-- two colleagues are specialists it hands off to; and tool surface is scoped
-- per agent rather than per question, because every tool in the context window
-- is a tax on the ones that matter.
--
-- DEFAULT FALSE, and that is the load-bearing default. An organization
-- authoring its own agent gets one that can look and cannot touch; turning it
-- into something that writes is a deliberate act by an admin, not the state a
-- row arrives in.
--
-- Echo is not a row here and is not becoming one. It IS the assistant — the
-- thread's `author` is NULL for it (0169) — and its standing orders live in
-- core where they can be versioned with the code that composes them. A row
-- for Echo would be a second place to change what the product's own assistant
-- is, and the first place would go stale.

begin;

alter table echo.assistant_agent
  add column if not exists can_act boolean not null default false;

comment on column echo.assistant_agent.can_act is
  '0233: whether this agent is offered the session''s WRITE hands when Echo '
  'hands work to it. False is an analyst — full reads, no acts. Every write '
  'still runs in the person''s browser behind a consent card; this decides '
  'whether the hands are offered at all. Default false so an org-authored '
  'agent arrives able to look and not to touch.';

comment on column echo.assistant_agent.tools is
  '0233: NOT a ceiling on what this agent may do, and has not been one since '
  '2026-09-04. Every agent gets the whole platform read set (toolsFor()); '
  'what it may WRITE is can_act. Kept because the web falls back to it when '
  'an older core sends no capability list.';

-- ─── the two shipped colleagues take their sides ──────────────────────────
-- Roya acts; Ava does not. Written as two statements rather than a CASE so
-- that each one's row count can be asserted below: a single UPDATE touching
-- "the system agents" would report success having matched nothing.
update echo.assistant_agent set can_act = true
 where level = 'system' and handle = 'roya';
update echo.assistant_agent set can_act = false
 where level = 'system' and handle = 'ava';

-- ─── and their one-line descriptions say which is which ───────────────────
-- The picker and the agents page read these. They described two helpers in
-- almost the same words, which is the copy half of the same problem: a person
-- choosing between them had nothing to choose on.
update echo.assistant_agent
   set description = 'کارها را پیش می‌برد: پیش‌نویس، تسک، جلسه، پیگیری. با تأیید شما عمل می‌کند.'
 where level = 'system' and handle = 'roya';
update echo.assistant_agent
   set description = 'سوابق را می‌خواند و گزارش می‌دهد. چیزی را تغییر نمی‌دهد.'
 where level = 'system' and handle = 'ava';

-- ─── what this migration promises, checked here ───────────────────────────
do $check$
declare
  v_acts    int;
  v_watches int;
begin
  select count(*) into v_acts
    from echo.assistant_agent where level = 'system' and handle = 'roya' and can_act;
  select count(*) into v_watches
    from echo.assistant_agent where level = 'system' and handle = 'ava' and not can_act;
  if v_acts <> 1 or v_watches <> 1 then
    raise exception '0233 FAILED: the two shipped agents did not take their sides (roya acting: %, ava watching: %)', v_acts, v_watches;
  end if;

  -- THE DISCRIMINATING HALF: a column defaulted to true would satisfy the
  -- line above for Roya and would have made every future org-authored agent
  -- a writer on arrival.
  if (select column_default from information_schema.columns
       where table_schema = 'echo' and table_name = 'assistant_agent'
         and column_name = 'can_act') is distinct from 'false' then
    raise exception '0233 FAILED: can_act does not default to false — a new agent would arrive able to write';
  end if;

  -- and the descriptions are two different sentences, which is the whole
  -- point of writing them: a person choosing between the colleagues had
  -- nothing to choose on
  if (select count(distinct description) from echo.assistant_agent
       where level = 'system' and handle in ('roya', 'ava')) <> 2 then
    raise exception '0233 FAILED: the two colleagues still describe themselves the same way';
  end if;
end
$check$;

commit;
