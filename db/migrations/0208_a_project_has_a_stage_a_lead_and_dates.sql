-- 0208 — a project has a stage, a lead, a priority and two dates
--
-- User directive, 2026-09-08: "give projects more related options" — said in
-- the same breath as "do the edit version like in edit tasks in same window",
-- which is the frame for reading it. A task's rail carries seven live fields
-- (topic, column, assignees, priority, deadline, labels, repeat); a project's
-- carried five READINGS and nothing you could set from it except the tone.
--
-- ── WHAT A PROJECT WAS MISSING, AND WHY EACH ONE IS A COLUMN ──────────────
--
-- 0181 was deliberately austere ("a project OWNS nothing and POINTS at
-- everything") and that argument still holds for its WORK, its BOARD and its
-- CONVERSATION — all three stay where they are. It does not hold for the
-- facts below, because every one of them is about the project itself and
-- there is nowhere else in the schema they could be read from:
--
--   stage       Where the work is. A card answers this with the column it
--               sits in; a project had only archived-or-not, and archiving is
--               a different question (see below).
--   priority    Which project gives way when two want the same person. The
--               task's own four levels, not a new set: one vocabulary for
--               "how urgent" across the product, so a filter can one day span
--               both without a translation table.
--   lead_id     WHO IS ACCOUNTABLE. `created_by` is who typed the row, which
--               is a different fact and stops being true the moment somebody
--               hands the project over. Nullable, because a project without a
--               named lead is an honest state and a default of "whoever made
--               it" would be a claim nobody made.
--   starts_on   When the work began. `created_at` is when the ROW was made —
--               a project entered into the platform three weeks after it
--               started would otherwise report the wrong date forever.
--   due_on      When it must be done.
--
-- ── STAGE IS NOT ARCHIVED, AND THE PAIR IS DELIBERATE ─────────────────────
--
-- `stage = 'done'` says the work finished. `archived_at` says the project is
-- off the working list. They are independent and both readings are needed:
-- a finished project stays visible until somebody files it away, and an
-- ABANDONED project is archived without ever being done. Folding them into
-- one column would make "we stopped doing this" and "we finished this"
-- indistinguishable — which is the kind of nothing rule 12 exists for.
--
-- ── DATES, NOT TIMESTAMPS ─────────────────────────────────────────────────
--
-- `date` rather than `timestamptz`, unlike a task's `due_at`. A task is due at
-- a moment somebody set on a clock; a project starts and ends on a DAY. Making
-- them instants would invent a time nobody chose and then render it in a
-- timezone — and this product has already paid for one meeting moved by an
-- offset because a form and a save disagreed about the zone (2026-09-06).
-- A day has no zone to get wrong.
--
-- ── THE FK IS COLUMN-SPECIFIC, AND THAT IS 0188'S LESSON ──────────────────
--
-- `(lead_id, org_id)` references app_user's composite key, so a lead can never
-- be somebody from another organisation — structure, not a policy subquery
-- (D9/rule 11). Its cascade names its ONE column: a composite FK's `on delete
-- set null` nulls EVERY column in the key, `org_id` included, which is NOT
-- NULL — so the bare form is a constraint that can only ever raise, and 0186
-- shipped exactly that before 0188 found it. MATCH SIMPLE (the default) is
-- what makes a null `lead_id` legal: with any column null the constraint is
-- not enforced, which is the "no lead named" state.
--
-- No new table, so the purge's enumerated deletes (0145's coverage check) are
-- untouched — these columns go with the row they hang off.

begin;

alter table echo.project
  add column stage      text not null default 'active'
             check (stage in ('planning', 'active', 'paused', 'done')),
  add column priority   text not null default 'medium'
             check (priority in ('low', 'medium', 'high', 'critical')),
  add column lead_id    uuid,
  add column starts_on  date,
  add column due_on     date;

alter table echo.project
  add constraint project_lead_person
    foreign key (lead_id, org_id) references echo.app_user (id, org_id)
    on delete set null (lead_id);

/* a project that ends before it starts is a typo, and the two fields are
   entered on one screen — so the refusal lands while the person is still
   looking at both of them rather than as a report that reads wrong later */
alter table echo.project
  add constraint project_dates_ordered
    check (starts_on is null or due_on is null or starts_on <= due_on);

comment on column echo.project.stage is
  'Where the work is: planning | active | paused | done. NOT the same fact as archived_at — done says the work finished, archived says the project is off the working list, and an abandoned project is archived without ever being done (0208).';
comment on column echo.project.priority is
  'The task board''s own four levels (0144), deliberately the same closed set: one vocabulary for "how urgent" across the product (0208).';
comment on column echo.project.lead_id is
  'Who is accountable. Distinct from created_by, which is who typed the row and stops being true the moment the project is handed over. Null is an honest state (0208).';
comment on column echo.project.starts_on is
  'The day the work began — not created_at, which is the day the row was made (0208).';
comment on column echo.project.due_on is
  'The day it must be done. A date, not an instant: a project has no clock time, and an instant would be a time nobody chose rendered in a zone that can disagree (0208).';

-- ── self-checks ────────────────────────────────────────────────────────────
--
-- They run once, on the day this is applied; db/test/110 is the standing
-- version that survives a later edit to the same walls.
do $check$
declare
  v_org  uuid;
  v_user uuid;
  v_id   uuid;
  v_def  text;
begin
  -- a subject to test against, rolled back with the block
  select id into v_org from echo.org limit 1;
  if v_org is null then
    raise notice '0208: no org on this database — the behavioural checks are skipped, the structural ones below still run';
  end if;

  -- 1. THE DEFAULTS ARE THE ONES A CARD ALREADY RENDERS. Every project that
  --    existed before this file has to come out of it looking unchanged, or
  --    the migration has quietly re-classified the org's whole portfolio.
  if exists (select 1 from echo.project where stage <> 'active' or priority <> 'medium') then
    raise exception '0208: an existing project did not take the defaults';
  end if;
  if exists (select 1 from echo.project where lead_id is not null
                                           or starts_on is not null
                                           or due_on is not null) then
    raise exception '0208: a backfilled project carries a lead or a date nobody set';
  end if;

  -- 2. THE CASCADE NAMES ITS COLUMN (0188). A bare `set null` here can only
  --    ever raise, and it reads as deliberate — so the check reads the
  --    constraint's own definition rather than trusting the file above.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'echo.project'::regclass and conname = 'project_lead_person';
  if v_def is null then
    raise exception '0208: the lead FK is missing';
  end if;
  if v_def not like '%SET NULL (lead_id)%' then
    raise exception '0208: the lead FK does not name its column — % ', v_def;
  end if;

  if v_org is null then return; end if;

  -- 3. THE CLOSED SETS REFUSE. Two INSERTs that must fail with 23514, each
  --    naming only the column under test so the refusal cannot be for
  --    something else.
  select id into v_user from echo.app_user where org_id = v_org limit 1;
  if v_user is null then return; end if;

  begin
    insert into echo.project (org_id, name, created_by, stage)
    values (v_org, '0208 stage probe', v_user, 'finished');
    raise exception '0208: an unknown stage was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into echo.project (org_id, name, created_by, priority)
    values (v_org, '0208 priority probe', v_user, 'urgent');
    raise exception '0208: an unknown priority was accepted';
  exception when check_violation then null;
  end;

  -- 4. THE DATE ORDER REFUSES, and its inverse is ACCEPTED — the
  --    discriminating half. Without it a check that refuses everything
  --    passes the line above and is completely wrong.
  begin
    insert into echo.project (org_id, name, created_by, starts_on, due_on)
    values (v_org, '0208 date probe', v_user, date '2026-10-01', date '2026-09-01');
    raise exception '0208: a project ending before it starts was accepted';
  exception when check_violation then null;
  end;

  insert into echo.project (org_id, name, created_by, starts_on, due_on)
  values (v_org, '0208 date control', v_user, date '2026-09-01', date '2026-10-01')
  returning id into v_id;
  if v_id is null then
    raise exception '0208: a correctly ordered pair of dates was refused';
  end if;
  delete from echo.project where id = v_id;
end
$check$;

commit;
