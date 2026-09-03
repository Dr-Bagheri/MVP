-- 0165 — the purge learns the rooms
--
-- 0164 added three org-scoped tables (agent_room, agent_room_member,
-- agent_room_message) and `platform_purge_org` enumerates its deletes, so
-- until this lands the purge RAISES for any org that has opened a room —
-- which is 0132's sentence proven a third time: "a purge that raises is a
-- purge that does not run, on the one path where failing to delete is the
-- worst outcome". 0145 installed the instrument that catches it; the
-- instrument caught it, which is the only reason this file exists on the same
-- day as the tables rather than on the day somebody purged an org.
--
-- GENERATED, NOT RETYPED. 0132's own hand-written attempt had a one-argument
-- signature, the wrong guard and half the delete list missing — and
-- `create or replace` installs that as a SECOND OVERLOAD beside the real one
-- rather than rejecting it. So this reads the LIVE definition with
-- pg_get_functiondef, splices three lines into it, and executes the result:
-- every other line of the function is carried across by the database itself
-- and cannot be mistyped here.
--
-- ORDER: children first, and all three named even though the composite
-- foreign keys cascade. A cascade would satisfy the database and hide the
-- table from the coverage check — which reads the function's TEXT, and is
-- right to: a table nobody names is a table nobody thought about.

begin;

do $$
declare
  v_def    text;
  v_anchor text;
  v_new    text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo' and p.proname = 'platform_purge_org') <> 1 then
    raise exception 'platform_purge_org has an overload or is missing — refusing to regenerate blind';
  end if;

  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if v_def ~ 'delete from echo\.agent_room\s' then
    raise notice '0165: the purge already deletes the rooms — nothing to splice';
    return;
  end if;

  /* the splice point: the FIRST delete in the body. The rooms go at the head
     because nothing already in the list points at them, and their own three
     are ordered children-first among themselves. */
  /* ONE string, built with explicit `||`. Adjacent E'' literals do not
     concatenate the way adjacent plain ones do — it is a syntax error, which
     is the good kind: the first run of this migration said so instead of
     splicing something subtly different. */
  select regexp_replace(v_def, '(\s+)(delete from echo\.)',
    E'\\1-- the agent rooms (0164), children first\n'
    || E'\\1delete from echo.agent_room_message where org_id = p_org;\n'
    || E'\\1delete from echo.agent_room_member  where org_id = p_org;\n'
    || E'\\1delete from echo.agent_room         where org_id = p_org;\n'
    || E'\\1\\2', 'n')
    into v_new;

  if v_new = v_def then
    raise exception 'CHECK FAILED: found no delete statement to splice against — the body is not the shape this migration assumes';
  end if;

  execute v_new;
end;
$$;

-- ── self-checks: the coverage rule, re-run against the regenerated body ──
do $$
declare
  v_def     text;
  v_missing text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo' and p.proname = 'platform_purge_org') <> 1 then
    raise exception 'CHECK FAILED: the regeneration installed an overload beside the original';
  end if;

  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  -- the same derivation 0145 installed: every echo table carrying org_id is
  -- deleted by the purge, or excepted with a reason
  select string_agg(t.relname, ', ' order by t.relname) into v_missing
    from (
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
       where n.nspname = 'echo' and c.relkind = 'r'
         and a.attname = 'org_id' and not a.attisdropped
         and c.relname not in ('deletion_record')
    ) t
   where v_def !~ ('delete from echo\.' || t.relname || '\s');
  if v_missing is not null then
    raise exception 'CHECK FAILED: platform_purge_org does not delete: %', v_missing;
  end if;

  -- and the three are there by name, asserted individually so a partial
  -- splice is loud rather than hidden behind the aggregate above
  if v_def !~ 'delete from echo\.agent_room_message\s'
     or v_def !~ 'delete from echo\.agent_room_member\s'
     or v_def !~ 'delete from echo\.agent_room\s' then
    raise exception 'CHECK FAILED: the splice did not name all three room tables';
  end if;

  -- THE CONTROL: the derivation must still be able to FIND a missing table,
  -- or "nothing missing" is a fact about a broken query rather than about the
  -- function. A name that is not in the body must come back as missing.
  if (select count(*) from (select 'a_table_no_purge_deletes'::text as relname) t
       where v_def !~ ('delete from echo\.' || t.relname || '\s')) <> 1 then
    raise exception 'CHECK FAILED: the coverage derivation cannot report a missing table';
  end if;

  raise notice '0165 self-checks passed';
end;
$$;

commit;
