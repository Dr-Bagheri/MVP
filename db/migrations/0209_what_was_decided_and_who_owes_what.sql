-- 0209 — what was decided, and who owes what
--
-- User directive, 2026-09-08: items 2 and 3 of the twenty, in the same message
-- as the sentence they serve — "we want to build the first AI agentic platform
-- that runs as a second brain in companies".
--
-- ── THE GAP THIS CLOSES ───────────────────────────────────────────────────
--
-- A meeting here already produces a transcript, a versioned summary and
-- minutes with a lifecycle. All three are PROSE. So the two questions an
-- organisation actually asks of its own past —
--
--     «چه تصمیم‌هایی گرفتیم، و کدام‌شان برگشت خورد؟»
--     «چه کسی چه چیزی را تا کِی قبول کرد؟»
--
-- — can only be answered by a person re-reading, because a paragraph is not a
-- thing you can query, count, supersede, or hang a deadline off. Meeting
-- products overwhelmingly produce paragraphs; this produces OBJECTS.
--
-- ── ONE TABLE, TWO KINDS, AND WHY THAT IS NOT A SHORTCUT ──────────────────
--
-- A commitment is a decision with a person and a date on it: «بودجه را
-- کم می‌کنیم» and «من تا شنبه انجامش می‌دهم» are the same act of the same
-- meeting, found by the same pass, superseded by the same later sentence, and
-- read on the same screen. Two tables would need two extractions, two
-- policies, two purge entries and two answers to "what changed since March".
--
-- What the kinds do NOT share is what CONFIRMING one means: a decision
-- becomes a standing record, a commitment becomes a CARD on the board. That
-- difference lives in core, where the act happens, not in the schema.
--
-- ── AN EXTRACTED ROW IS A CLAIM, NOT A FACT ───────────────────────────────
--
-- `source` and `confirmed_at` are the whole ethics of this feature. A model
-- reading a transcript produces a plausible sentence; this platform's rule is
-- that a plausible sentence never enters the record wearing the same clothes
-- as something a person said (the annotation-not-bubble ruling, 2026-08-13).
-- So an extracted row is visibly EXTRACTED until a human confirms it, and the
-- surface says which. Nothing downstream — no task, no minutes line, no agent
-- answer — may treat an unconfirmed extraction as decided.
--
-- ── EVIDENCE IS A SPAN, BECAUSE A CITATION HAS TO BE PLAYABLE ─────────────
--
-- `evidence_start_ms` / `evidence_end_ms` are offsets into the CALL, the same
-- coordinates the transcript and the seek-on-click player already use. That
-- is the difference between "the model says this was decided" and "press here
-- and hear it decided". A claim you can play is a claim you can check.
--
-- ── VISIBILITY IS THE CALL'S, THROUGH THE DOOR THAT ALREADY EXISTS ────────
--
-- `echo.can_read_call(call_id)` — the named function the transcript, the
-- speakers and the summaries all read through. NOT an EXISTS over echo.call
-- written out again here: that runs as the caller and intersects with the
-- call's own policies, which is the shape D9 and rule 11 name, and four
-- copies of one rule is four places for it to stop being the same rule.
--
-- A decision with NO call — one a person typed — is org-scoped, readable by
-- every active member, like a project or a meeting.

-- ── THE NAME ──────────────────────────────────────────────────────────────
--
-- `echo.decision` is NOT AVAILABLE, and the refusal is worth recording
-- because the message does not say why: `create table echo.decision`
-- answers "type decision already exists". In Postgres a table and a type
-- share one namespace, and 0027 minted an ENUM by that name for
-- proposal_decision's approve|reject. So the obvious name is taken by
-- something that is not a table, and no amount of looking at the table
-- list would have shown it (db/scripts/probe-name.mjs asks the question
-- that does).
--
-- `decision_log` rather than a synonym: this IS a ledger — rows supersede
-- each other and nothing is edited into place — so the name says what the
-- table is instead of dodging the collision with a word nobody uses.

begin;

create table echo.decision_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),

  kind        text not null default 'decision'
              check (kind in ('decision', 'commitment')),

  /* the RECORD it was found in — null for one somebody typed. `set null
     (call_id)`, naming its column: the composite key holds a NOT NULL org_id
     and a bare SET NULL over it can only ever raise (0188, and 0186 shipped
     exactly that before 0188 found it). */
  call_id     uuid,

  /* ONE SENTENCE, and the length is the point: a decision that needs a
     paragraph has not been decided yet. The detail is where the paragraph
     goes. */
  text        text not null check (length(trim(text)) between 1 and 400),
  detail      text not null default '' check (length(detail) <= 2000),

  /* WHO owes it, for a commitment. Null on a decision, and null on a
     commitment nobody could be resolved for — «یکی باید این را انجام دهد» is
     a real thing to have heard, and inventing an owner for it would be the
     fabrication this table exists to avoid. */
  owner_id    uuid,
  /* WHEN it is owed, as a DAY: a meeting says «تا شنبه», never «تا شنبه
     ساعت ۱۴:۳۲», and an instant would be a time nobody chose rendered in a
     zone that can disagree (0208's reasoning, same shape). */
  due_on      date,

  /* WHO decided it, when the transcript names a speaker the platform can
     resolve to an account. Null is ordinary. */
  decided_by  uuid,
  /* the day it was decided — the call's, or the person's answer */
  decided_on  date,

  /* the span in the call where it was said — playable, in the transcript's
     own coordinates */
  evidence_start_ms integer check (evidence_start_ms is null or evidence_start_ms >= 0),
  evidence_end_ms   integer check (evidence_end_ms is null or evidence_end_ms >= 0),

  /* THE TEMPORAL HALF. A later decision that replaces this one points BACK at
     it, so "what did we decide about X" walks a chain and "what got reversed"
     is a query rather than a memory. Self-referential, nullable, and
     column-named on delete like every other pointer here. */
  supersedes_id uuid,

  status      text not null default 'standing'
              check (status in ('standing', 'superseded', 'reversed')),

  /* 'extracted' = a model read it out of a transcript and NOBODY has agreed
     to it yet. 'human' = a person wrote it. The pair is load-bearing: see the
     header. */
  source      text not null check (source in ('extracted', 'human')),
  confirmed_by uuid,
  confirmed_at timestamptz,

  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint decision_log_call
    foreign key (call_id, org_id) references echo.call (id, org_id)
    on delete set null (call_id),
  constraint decision_log_owner
    foreign key (owner_id, org_id) references echo.app_user (id, org_id)
    on delete set null (owner_id),
  constraint decision_log_decider
    foreign key (decided_by, org_id) references echo.app_user (id, org_id)
    on delete set null (decided_by),
  constraint decision_log_confirmer
    foreign key (confirmed_by, org_id) references echo.app_user (id, org_id)
    on delete set null (confirmed_by),
  constraint decision_log_author
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  constraint decision_log_supersedes
    foreign key (supersedes_id, org_id) references echo.decision_log (id, org_id)
    on delete set null (supersedes_id),

  /* a span is two ends or neither, and it runs forwards */
  constraint decision_log_span_paired
    check ((evidence_start_ms is null) = (evidence_end_ms is null)),
  constraint decision_log_span_ordered
    check (evidence_start_ms is null or evidence_end_ms >= evidence_start_ms),

  /* CONFIRMATION IS A PERSON AND A MOMENT, together or not at all — a
     confirmed_at with nobody behind it is a record that cannot say who
     agreed, which is the whole value of the column */
  constraint decision_log_confirmation_paired
    check ((confirmed_at is null) = (confirmed_by is null)),

  /* a HUMAN row is confirmed by construction: the person writing it IS the
     agreement, and leaving it unconfirmed would make the surface show a
     "confirm" button on something nobody extracted */
  constraint decision_log_human_is_confirmed
    check (source <> 'human' or confirmed_at is not null),

  /* the composite key the self-reference and any future child points at */
  unique (id, org_id)
);

create index decision_log_org_idx on echo.decision_log (org_id, decided_on desc nulls last);
create index decision_log_call_idx on echo.decision_log (call_id) where call_id is not null;
create index decision_log_owner_idx on echo.decision_log (owner_id) where owner_id is not null;
create index decision_log_open_idx on echo.decision_log (org_id, due_on)
  where kind = 'commitment' and status = 'standing';

comment on table echo.decision_log is
  'What a meeting decided, and what somebody committed to (0209). One table, two kinds: a commitment is a decision with a person and a date. An `extracted` row is a MODEL''S CLAIM until confirmed_at — nothing downstream may treat it as decided.';
comment on column echo.decision_log.supersedes_id is
  'The earlier decision this one replaces. The temporal half: "what did we decide about X" walks the chain, and "what got reversed" is a query rather than somebody''s memory (0209).';
comment on column echo.decision_log.evidence_start_ms is
  'Where in the call it was said, in the transcript''s own coordinates — so a citation can be PLAYED. A claim you can play is a claim you can check (0209).';

alter table echo.decision_log enable row level security;
alter table echo.decision_log force row level security;

/* READ: the call's own visibility, through the door the transcript and the
   summaries already read through — never a fourth copy of the same rule. A
   decision with no call is the organisation's. */
create policy decision_log_read on echo.decision_log for select to echo_app, echo_agent
  using (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (call_id is null or echo.can_read_call(call_id))
  );

/* WRITE: any active member of the org, on their own org's rows. Deliberately
   NOT admin-only — a decision is a fact about a meeting somebody was in, and
   walling it would mean the person who heard it cannot write it down. */
create policy decision_log_insert on echo.decision_log for insert to echo_app
  with check (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and created_by = echo.actor_id()
    and (call_id is null or echo.can_read_call(call_id))
  );

create policy decision_log_update on echo.decision_log for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and (call_id is null or echo.can_read_call(call_id)))
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

/* THE AGENT WRITES TOO — this is the extraction's landing place, and the
   worker runs as the call's owner. It still holds NO DELETE, here as
   everywhere (the invariant, and 0209 adds no exception to it). */
create policy decision_log_agent_insert on echo.decision_log for insert to echo_agent
  with check (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and created_by = echo.actor_id()
    and source = 'extracted'
    and confirmed_at is null
    and (call_id is null or echo.can_read_call(call_id))
  );

/* THE PURGE, which is the whole reason 0145's coverage check exists */
create policy decision_log_purge_read on echo.decision_log for select to echo_purge
  using (true);
create policy decision_log_purge_delete on echo.decision_log for delete to echo_purge
  using (true);

grant select, insert, update on echo.decision_log to echo_app;
grant select, insert on echo.decision_log to echo_agent;
grant select, delete on echo.decision_log to echo_purge;

-- ── a commitment that became a card carries its evidence ───────────────────
--
-- A confirmed commitment CREATES a task, and the task must be able to say
-- where it came from. `task.call_id` already exists; what was missing is the
-- SPAN, so the card can play the sentence that created it rather than merely
-- naming the meeting.
alter table echo.task
  add column evidence_start_ms integer check (evidence_start_ms is null or evidence_start_ms >= 0),
  add column evidence_end_ms   integer check (evidence_end_ms is null or evidence_end_ms >= 0),
  add constraint task_evidence_paired
    check ((evidence_start_ms is null) = (evidence_end_ms is null)),
  add constraint task_evidence_ordered
    check (evidence_start_ms is null or evidence_end_ms >= evidence_start_ms);

comment on column echo.task.evidence_start_ms is
  'Where in its call this card was committed to. A card born from a meeting can play the sentence that created it (0209).';

-- ── THE PURGE LEARNS THE TABLE ─────────────────────────────────────────────
--
-- Regenerated from `pg_get_functiondef`, never retyped (0132's lesson: a
-- hand-written `create or replace` with a drifted signature installs a SECOND
-- OVERLOAD beside the real one). Anchored on a line that must exist, so a body
-- that has moved on fails here instead of being silently replaced.
--
-- ORDER: decisions point at calls and at each other. The self-reference is
-- `set null`, so one statement clears the whole table for the org and nothing
-- can be left pointing at a deleted sibling — it goes BEFORE the call deletes
-- for the same reason every child does.
do $regen$
declare
  v_def text;
  v_anchor constant text := '  delete from echo.project_member         where org_id = p_org;';
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position(v_anchor in v_def) = 0 then
    raise exception
      'the purge body has moved on: its project_member line is not where this migration expects it. Re-read the function before editing it — a substitution that cannot find its anchor must never fall through to a rewrite.';
  end if;
  if position('echo.decision_log' in v_def) > 0 then
    raise exception 'the purge already names echo.decision_log — this migration has run, or something else added it';
  end if;

  v_def := replace(
    v_def,
    v_anchor,
    '  delete from echo.decision_log               where org_id = p_org;' || E'\n' || v_anchor
  );
  execute v_def;
end $regen$;

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_org  uuid;
  v_user uuid;
  v_id   uuid;
  v_def  text;
begin
  -- 1. EVERY POINTER NAMES ITS COLUMN (0188). Read off the constraints
  --    themselves rather than trusting the text above — a bare SET NULL over
  --    this table's NOT NULL org_id can only ever raise, and it reads as
  --    deliberate.
  for v_def in
    select pg_get_constraintdef(oid) from pg_constraint
     where conrelid = 'echo.decision_log'::regclass and contype = 'f' and confdeltype = 'n'
  loop
    if v_def !~ 'SET NULL \(' then
      raise exception '0209: a SET NULL foreign key does not name its column — %', v_def;
    end if;
  end loop;

  -- 2. THE PURGE NAMES IT. This is the check 0145 turned into a standing test
  --    after thirteen tables went missing at once; asserting it here too costs
  --    a line and catches a bad regeneration on the day it happens.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if position('delete from echo.decision_log' in v_def) = 0 then
    raise exception '0209: the purge does not delete decisions — it would RAISE for any org that used the feature';
  end if;

  -- 3. RLS IS ON AND FORCED. Enabled-but-not-forced is a table the OWNER
  --    reads straight through, which is the state the standing check catches
  --    and the state a new table arrives in by default.
  if not exists (
    select 1 from pg_class where oid = 'echo.decision_log'::regclass
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception '0209: row level security is not FORCED on echo.decision_log';
  end if;

  select id into v_org from echo.org limit 1;
  if v_org is null then return; end if;
  select id into v_user from echo.app_user where org_id = v_org limit 1;
  if v_user is null then return; end if;

  -- 4. THE HUMAN/CONFIRMED PAIR REFUSES, and its inverse is ACCEPTED — the
  --    discriminating half, without which a constraint that refuses every row
  --    passes the refusal line and is completely wrong.
  begin
    insert into echo.decision_log (org_id, text, source, created_by)
    values (v_org, '0209 probe', 'human', v_user);
    raise exception '0209: a human decision with no confirmation was accepted';
  exception when check_violation then null;
  end;

  insert into echo.decision_log (org_id, text, source, created_by, confirmed_by, confirmed_at)
  values (v_org, '0209 control', 'human', v_user, v_user, now())
  returning id into v_id;
  if v_id is null then
    raise exception '0209: a properly confirmed human decision was refused';
  end if;

  -- 5. A SPAN IS TWO ENDS OR NEITHER, and it runs forwards.
  begin
    update echo.decision_log set evidence_start_ms = 1000 where id = v_id;
    raise exception '0209: half a span was accepted';
  exception when check_violation then null;
  end;
  begin
    update echo.decision_log set evidence_start_ms = 5000, evidence_end_ms = 1000 where id = v_id;
    raise exception '0209: a span that ends before it starts was accepted';
  exception when check_violation then null;
  end;
  update echo.decision_log set evidence_start_ms = 1000, evidence_end_ms = 5000 where id = v_id;

  delete from echo.decision_log where id = v_id;
end
$check$;

commit;
