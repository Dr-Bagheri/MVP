-- 0185 — the purge learns the channel
--
-- 0184 added four org-scoped tables and the coverage check caught all four on
-- the next run, which is the third time that instrument has earned its place
-- in as many days (0145's thirteen, 0182's two, these four). The finding is
-- always the same one and it is worth restating: `platform_purge_org`
-- ENUMERATES its deletes, so a new org-scoped table that nothing adds makes
-- the purge RAISE for any organisation that used the feature — and a purge
-- that raises is a purge that does not run.
--
-- ── HOW THE FUNCTION IS EDITED ────────────────────────────────────────────
--
-- Regenerated from `pg_get_functiondef`, never retyped (0132's lesson: a
-- hand-written `create or replace` with a drifted signature installs a SECOND
-- OVERLOAD beside the real one rather than failing). The substitution is
-- anchored on a line that must exist, so a body that has moved on fails here
-- instead of being silently replaced.
--
-- ── ORDER ─────────────────────────────────────────────────────────────────
--
-- Children first, as 0145 established:
--   chat_mention  → FK to chat_message
--   chat_message  → FK to chat_channel
--   chat_channel_member → FK to chat_channel
--   chat_channel  → FK to project, so it goes BEFORE the project deletes
--                   0182 added; a project's cascade would otherwise fire
--                   during a delete the explicit statement has handled.

begin;

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

  if position('echo.chat_message' in v_def) > 0 then
    raise exception 'the purge already names the chat tables — this migration has run, or something else added them';
  end if;

  v_def := replace(
    v_def,
    v_anchor,
    '  delete from echo.chat_mention           where org_id = p_org;' || E'\n'
      || '  delete from echo.chat_message           where org_id = p_org;' || E'\n'
      || '  delete from echo.chat_channel_member    where org_id = p_org;' || E'\n'
      || '  delete from echo.chat_channel           where org_id = p_org;' || E'\n'
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

  if position('delete from echo.chat_channel ' in v_def) = 0
     or position('delete from echo.chat_channel_member' in v_def) = 0
     or position('delete from echo.chat_message' in v_def) = 0
     or position('delete from echo.chat_mention' in v_def) = 0 then
    raise exception 'CHECK FAILED: the regenerated purge does not delete all four chat tables';
  end if;

  /* the ORDER is the correctness, not the presence: the channel must be
     deleted before the project it may point at, and after its own children */
  if position('echo.chat_message' in v_def) > position('echo.chat_channel ' in v_def)
     or position('echo.chat_channel ' in v_def) > position('echo.project ' in v_def) then
    raise exception 'CHECK FAILED: the chat deletes are out of order — a child after its parent, or the channel after the project it hangs from';
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
