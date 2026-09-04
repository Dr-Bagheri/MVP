-- 0182 — the purge learns projects
--
-- db/0181 added two org-scoped tables, and the coverage check caught them the
-- moment the suite ran — which is exactly the sequence that check exists for.
-- It is the same finding as 0145's, one wave later: a new org-scoped table
-- that nothing made report for enumeration means `platform_purge_org` RAISES
-- for any organisation that used the feature, and a purge that raises is a
-- purge that does not run.
--
-- ── HOW THE FUNCTION IS EDITED ────────────────────────────────────────────
--
-- Regenerated from `pg_get_functiondef`, never retyped. 0132's first attempt
-- at exactly this was hand-written and installed a SECOND OVERLOAD beside the
-- real one — `create or replace` accepts a stale body as cheerfully as a
-- current one, and a wrong signature is a new function rather than an error.
-- The text substitution below is anchored on a line that must exist, so a body
-- that has moved on fails here instead of being silently replaced.
--
-- ── ORDER ─────────────────────────────────────────────────────────────────
--
-- `project_member` before `project`, and both AFTER the task tables:
-- `task_topic.project_id` is ON DELETE CASCADE, so deleting a project would
-- take its category with it — which is right, and still means the topics must
-- already be gone by then or the cascade fires during a delete that the
-- explicit statement above it has already handled. Children first, as 0145
-- established.

begin;

do $regen$
declare
  v_def text;
  v_anchor constant text := '  delete from echo.task_topic             where org_id = p_org;';
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position(v_anchor in v_def) = 0 then
    raise exception
      'the purge body has moved on: its task_topic line is not where this migration expects it. Re-read the function before editing it — a substitution that cannot find its anchor must never fall through to a rewrite.';
  end if;

  if position('echo.project' in v_def) > 0 then
    raise exception 'the purge already names projects — this migration has run, or something else added them';
  end if;

  v_def := replace(
    v_def,
    v_anchor,
    v_anchor || E'\n'
      || '  delete from echo.project_member         where org_id = p_org;' || E'\n'
      || '  delete from echo.project                where org_id = p_org;'
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

  if position('delete from echo.project ' in v_def) = 0
     or position('delete from echo.project_member' in v_def) = 0 then
    raise exception 'CHECK FAILED: the regenerated purge does not delete the project tables';
  end if;

  /* ONE function, not two. `create or replace` on a changed signature installs
     an overload rather than refusing, which is how 0132 nearly shipped a
     second purge beside the real one. */
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if v_count <> 1 then
    raise exception 'CHECK FAILED: platform_purge_org has % overloads', v_count;
  end if;

  /* and NOTHING ELSE was lost in the round trip. A regeneration that dropped
     a delete would leave rows behind on the one path where failing to delete
     is the worst outcome, and the function would still look like a purge. */
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
