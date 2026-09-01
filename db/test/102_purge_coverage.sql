-- The purge-coverage instrument (0145) — the standing twin of the check in
-- 0145's own foot, here because a migration's self-check runs once and the
-- next table lands AFTER it ran.
--
-- The defect class this ends: platform_purge_org ENUMERATES its deletes,
-- and nothing ever made a new org-scoped table report for enumeration — so
-- thirteen tables (the M41 workflow family, mail_draft, meeting_prep,
-- role_capability, agent_workflow, the 0144 task board) accumulated
-- NO ACTION foreign keys to echo.org that made the purge RAISE for any org
-- that had used those features. "A purge that raises is a purge that does
-- not run, on the one path where failing to delete is the worst outcome."
--
-- The list is DERIVED from the catalogue (13½: the producer owns the
-- coverage list): every echo table carrying org_id must appear as a
-- `delete from echo.<name>` in the function body, or stand in the
-- exceptions below WITH its reason.
--
-- Exceptions:
--   · deletion_record — ON DELETE CASCADE to org by design: the record of
--     member deletions outlives everything except the org itself, and dies
--     exactly when the org does. (Asserted below, so the exception cannot
--     silently stop being true.)

reset role;

select t.ok(
  (select string_agg(t2.relname, ', ' order by t2.relname)
     from (
       select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'echo' and c.relkind = 'r'
          and a.attname = 'org_id' and not a.attisdropped
          and c.relname not in ('deletion_record')
     ) t2
    where (select pg_get_functiondef(p.oid)
             from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
            where n2.nspname = 'echo' and p.proname = 'platform_purge_org')
          !~ ('delete from echo\.' || t2.relname || '\s')
  ) is null,
  'every org-scoped table is deleted by platform_purge_org or excepted with a reason');

-- the exception's stated reason is still true: deletion_record cascades
select t.ok(
  (select con.confdeltype = 'c'
     from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     join pg_class ref on ref.oid = con.confrelid
     join pg_namespace n on n.oid = rel.relnamespace
    where con.contype = 'f' and n.nspname = 'echo'
      and rel.relname = 'deletion_record' and ref.relname = 'org'),
  'deletion_record''s exception holds: its org link is ON DELETE CASCADE');

-- NEGATIVE CONTROL: the coverage question can say no. A table name the
-- function certainly does not delete must be reported missing by the same
-- predicate — a checker that cannot fail for its own reason is worse than
-- none (the check above would pass vacuously if the regex quietly matched
-- everything, e.g. by a mangled escape).
select t.ok(
  (select pg_get_functiondef(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'echo' and p.proname = 'platform_purge_org')
  !~ ('delete from echo\.' || 'no_such_table_ever' || '\s'),
  'the coverage predicate can answer NO (a name the purge does not delete is reported missing)');
