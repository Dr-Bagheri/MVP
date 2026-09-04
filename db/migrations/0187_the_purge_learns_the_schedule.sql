-- 0187 — the purge learns the schedule
--
-- 0186 added one org-scoped table and the coverage check caught it on the
-- next run. Fourth time in three days, and the finding is the same one every
-- time: `platform_purge_org` ENUMERATES its deletes, so a new org-scoped
-- table nothing adds makes the purge RAISE for any organisation that used the
-- feature — and a purge that raises is a purge that does not run.
--
-- ── ORDER ─────────────────────────────────────────────────────────────────
--
-- AFTER `echo.task`, and that ordering is not arbitrary even though the FK is
-- ON DELETE SET NULL. Deleting the schedules first would fire that SET NULL
-- across every task in the organisation — a mass UPDATE, inside the one
-- operation where doing more work than necessary is the worst habit to have.
-- Children first, as 0145 established, reading "child" as the row that
-- POINTS.
--
-- Regenerated from `pg_get_functiondef`, never retyped (0132: a hand-written
-- `create or replace` with a drifted signature installs a SECOND OVERLOAD
-- beside the real one rather than failing).

begin;

do $regen$
declare
  v_def text;
  v_anchor constant text := '  delete from echo.task                   where org_id = p_org;';
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position(v_anchor in v_def) = 0 then
    raise exception
      'the purge body has moved on: its task line is not where this migration expects it. Re-read the function before editing it — a substitution that cannot find its anchor must never fall through to a rewrite.';
  end if;

  if position('echo.task_recurrence' in v_def) > 0 then
    raise exception 'the purge already names task_recurrence — this migration has run, or something else added it';
  end if;

  v_def := replace(
    v_def,
    v_anchor,
    v_anchor || E'\n'
      || '  delete from echo.task_recurrence        where org_id = p_org;'
  );
  execute v_def;
end $regen$;

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v_def     text;
  v_count   int;
  v_missing text;
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position('delete from echo.task_recurrence' in v_def) = 0 then
    raise exception 'CHECK FAILED: the regenerated purge does not delete task_recurrence';
  end if;

  /* the ORDER is the correctness, not the presence: the schedules go after
     the tasks that point at them, or the delete fires a SET NULL across the
     whole organisation on its way past */
  if position('echo.task_recurrence' in v_def)
     < position('delete from echo.task ' in v_def) then
    raise exception 'CHECK FAILED: task_recurrence is deleted before the tasks that point at it';
  end if;

  /* ONE function, not two (0132) */
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if v_count <> 1 then
    raise exception 'CHECK FAILED: platform_purge_org has % overloads', v_count;
  end if;

  /* and NOTHING ELSE was lost in the round trip */
  select string_agg(t.relname, ', ' order by t.relname) into v_missing
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'echo' and t.relkind = 'r'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = t.oid and a.attname = 'org_id' and a.attnum > 0)
     and t.relname <> 'deletion_record'   -- cascades with the org, by design (0145)
     and position('echo.' || t.relname || ' ' in v_def) = 0
     and position('echo.' || t.relname || E'\n' in v_def) = 0;
  if v_missing is not null then
    raise exception 'CHECK FAILED: the purge no longer names: %', v_missing;
  end if;
end $chk$;

commit;
