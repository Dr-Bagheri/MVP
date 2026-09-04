-- 0188 — SET NULL means ONE column, not the whole key
--
-- A defect in 0186, found by 0186's own test the same day, and worth writing
-- out because the comment in 0186 states the OPPOSITE of what the constraint
-- did:
--
--   "ON DELETE SET NULL: stopping a schedule must not lose the work already
--    finished under it."
--
-- The FK is COMPOSITE — `(recurrence_id, org_id) references task_recurrence
-- (id, org_id)` — and a composite `ON DELETE SET NULL` nulls **every column
-- in the key**, `org_id` included. `org_id` is NOT NULL on every table in
-- this schema, so deleting a schedule did not null a pointer: it RAISED.
--
--   null value in column "org_id" of relation "task" violates not-null
--
-- Which means «توقف تکرار» — the one button whose whole job is stopping a
-- repeating order — would have failed with a 500 for every task that had ever
-- been scheduled. Nothing in the api or the web layer could have found it:
-- both are correct, and the failure lives in the constraint they trusted.
--
-- ── THE FIX ───────────────────────────────────────────────────────────────
--
-- `on delete set null (recurrence_id)` — column-specific, Postgres 15+, and
-- the server is 17. The composite pairing STAYS (D9/rule 11: structure rather
-- than a policy subquery, so a task and its schedule can never belong to two
-- organisations); only the cascade action narrows to the column that is
-- actually nullable.
--
-- ── WHY THE TEST SAW IT AND THE REVIEW DID NOT ────────────────────────────
--
-- Because the test deleted a schedule that a task pointed at, which is the
-- ordinary path of a feature whose UI has a "stop" button — and reading the
-- migration cannot tell you what SET NULL does to a two-column key unless you
-- already know. Rule 7's corollary again: the privileged path and the refused
-- path were both asserted in 0186's own self-checks; the ORDINARY path is the
-- product, and it was the one that raised.

begin;

alter table echo.task drop constraint task_recurrence_fk;
alter table echo.task
  add constraint task_recurrence_fk
    foreign key (recurrence_id, org_id) references echo.task_recurrence (id, org_id)
    on delete set null (recurrence_id);

-- ── self-check: the ordinary path, ATTEMPTED ─────────────────────────────
/*
 * Not "does the constraint read right" — 0186's did, to me, twice. This
 * creates a schedule, points a task at it, deletes the schedule, and asserts
 * the task survived with its org intact. The whole defect is one statement
 * wide and this is that statement.
 */
do $chk$
declare
  v_org  uuid;
  v_user uuid;
  v_col  uuid;
  v_rec  uuid;
  v_task uuid;
  v_org_after uuid;
begin
  select u.org_id, u.id into v_org, v_user
    from echo.app_user u join echo.org o on o.id = u.org_id
   where u.status = 'active' limit 1;
  if v_org is null then
    /* an empty database is a legitimate state for a fresh deployment, and a
       check that cannot run must say so rather than pass quietly */
    raise notice '0188: no active member to probe with — constraint changed, ordinary path unproven here';
    return;
  end if;

  insert into echo.task_column (org_id, name, tone, position, created_by)
  values (v_org, '__0188_probe__', 'grey', 9999, v_user) returning id into v_col;
  insert into echo.task_recurrence (org_id, gap_days, created_by)
  values (v_org, 1, v_user) returning id into v_rec;
  insert into echo.task (org_id, column_id, title, recurrence_id, created_by)
  values (v_org, v_col, '__0188_probe__', v_rec, v_user) returning id into v_task;

  delete from echo.task_recurrence where id = v_rec;

  select org_id into v_org_after from echo.task where id = v_task;
  if v_org_after is null then
    raise exception 'CHECK FAILED: deleting a schedule nulled the task''s org_id';
  end if;
  if (select recurrence_id from echo.task where id = v_task) is not null then
    raise exception 'CHECK FAILED: deleting a schedule left the task pointing at it';
  end if;

  delete from echo.task where id = v_task;
  delete from echo.task_column where id = v_col;
end $chk$;

commit;
