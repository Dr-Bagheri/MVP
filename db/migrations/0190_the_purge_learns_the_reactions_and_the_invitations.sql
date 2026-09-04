-- 0190 — the purge learns the reactions and the invitations
--
-- 0189 added two org-scoped tables. Fifth time in four days; the finding does
-- not change and neither does the reason it keeps arriving: `platform_purge_org`
-- ENUMERATES its deletes, so a new org-scoped table nothing adds makes the
-- purge RAISE for any organisation that used the feature — and a purge that
-- raises is a purge that does not run.
--
-- Worth naming after five: the coverage check is now the FASTEST feedback in
-- this repo. It costs one `db test` run and it has never once been wrong. The
-- alternative — remembering — has a five-for-five failure rate against the
-- same authors who wrote the checker.
--
-- ── ORDER ─────────────────────────────────────────────────────────────────
--
-- `chat_reaction` before `chat_message`, because it points at one. Children
-- first, as 0145 established — and the FK is ON DELETE CASCADE, so the wrong
-- order would work by accident today and stop working the day somebody
-- narrows that action.
--
-- `join_invite` anywhere: it points at NOTHING with a foreign key (the header
-- of 0189 says why — its target is polymorphic), so it has no children and no
-- parent among these tables. It goes beside the chat family because that is
-- where a reader will look for it.
--
-- Regenerated from `pg_get_functiondef`, never retyped (0132).

begin;

do $regen$
declare
  v_def text;
  v_anchor constant text := '  delete from echo.chat_mention           where org_id = p_org;';
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position(v_anchor in v_def) = 0 then
    raise exception
      'the purge body has moved on: its chat_mention line is not where this migration expects it. Re-read the function before editing it — a substitution that cannot find its anchor must never fall through to a rewrite.';
  end if;

  if position('echo.chat_reaction' in v_def) > 0 then
    raise exception 'the purge already names chat_reaction — this migration has run, or something else added it';
  end if;

  v_def := replace(
    v_def,
    v_anchor,
    '  delete from echo.chat_reaction          where org_id = p_org;' || E'\n'
      || '  delete from echo.join_invite            where org_id = p_org;' || E'\n'
      || v_anchor
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

  if position('delete from echo.chat_reaction' in v_def) = 0
     or position('delete from echo.join_invite' in v_def) = 0 then
    raise exception 'CHECK FAILED: the regenerated purge does not delete both new tables';
  end if;

  /* the ORDER is the correctness: a reaction points at a message, so it goes
     first — the cascade makes the other order survive today and it would stop
     surviving the day somebody narrows the FK */
  if position('echo.chat_reaction' in v_def) > position('echo.chat_message' in v_def) then
    raise exception 'CHECK FAILED: reactions are deleted after the messages they point at';
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
