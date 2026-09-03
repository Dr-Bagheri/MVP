-- 0166 — the agents lose the room
--
-- USER DIRECTIVE, 2026-09-03: "forget about the room and delete it from the
-- agents ... the whole platform should be their room so they can come to any
-- assistant conversation and they answer inline in the assistant thread."
--
-- 0164 gave the agents a place of their own to talk in, and 0165 taught the
-- purge about it. A day later the shape was ruled wrong, and the reasoning is
-- worth keeping because it is a product argument rather than a technical one:
-- a separate room is a second inbox. Somebody who wants Roya's help is already
-- in a conversation with the assistant, on the page the question is about, and
-- sending them somewhere else to get an answer costs them the context they
-- were standing in. `@roya` in the thread they already have is the same
-- capability with none of the travel.
--
-- So the three tables go. This is a DROP of a feature that shipped four days
-- ago and never carried a customer row; the catalogue is checked for that
-- below rather than assumed, because "it was new so it must be empty" is a
-- belief and the row count is a fact.
--
-- The purge is regenerated the way 0132 and 0165 established: read the live
-- body with pg_get_functiondef, remove exactly the three lines, execute the
-- result. Hand-writing the body is how a one-argument overload gets installed
-- beside the real function and both then exist.

begin;

-- ── 1. the rows, if any ────────────────────────────────────────────────────
do $$
declare v_rooms bigint; v_msgs bigint;
begin
  select count(*) into v_rooms from echo.agent_room;
  select count(*) into v_msgs  from echo.agent_room_message;
  -- Not a refusal: a room with rows is still being dropped, on the user's
  -- word. This is the LINE IN THE LOG that says what went, so nobody has to
  -- reconstruct it from a diff later.
  raise notice '0166: dropping agent rooms — % room(s), % message(s)', v_rooms, v_msgs;
end $$;

-- ── 2. the purge stops naming tables that will not exist ───────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if v_def !~ 'delete from echo\.agent_room\s' then
    raise exception '0166: platform_purge_org does not mention agent_room — '
      'refusing to guess at a body this migration did not expect';
  end if;

  -- one line each, whole-line, anchored on the table name so a future line
  -- mentioning a room in a comment cannot be eaten by accident
  v_def := regexp_replace(v_def, '[ \t]*delete from echo\.agent_room_message[^\n]*\n', '', 'g');
  v_def := regexp_replace(v_def, '[ \t]*delete from echo\.agent_room_member[^\n]*\n',  '', 'g');
  v_def := regexp_replace(v_def, '[ \t]*delete from echo\.agent_room[ \t][^\n]*\n',    '', 'g');

  if v_def ~ 'echo\.agent_room' then
    raise exception '0166: a reference to agent_room survived the rewrite';
  end if;
  execute v_def;
end $$;

-- ── 3. the tables ──────────────────────────────────────────────────────────
-- ONE statement, all three. Dropping them in sequence fails: agent_room's read
-- policy names agent_room_member in its USING clause, which is a catalogue
-- dependency, and the member table's own FK points back at the room — so there
-- is no order in which each drop is individually legal.
--
-- Deliberately NOT `cascade`. A multi-table drop resolves dependencies AMONG
-- the tables listed and still refuses if something outside the three depends on
-- them, which is exactly the guard wanted here: this migration knows about a
-- feature nobody consumed, and if it turns out something else grew a reference,
-- that must stop the drop rather than be quietly taken with it.
drop table if exists echo.agent_room_message, echo.agent_room_member, echo.agent_room;

-- ── self-checks ────────────────────────────────────────────────────────────
do $$
declare v_def text; v_left int; v_uncovered text;
begin
  -- the tables are gone, and gone from the catalogue rather than merely
  -- unreferenced by our code
  select count(*) into v_left from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relname like 'agent\_room%';
  if v_left <> 0 then
    raise exception 'CHECK FAILED: % agent_room table(s) still in the catalogue', v_left;
  end if;

  -- the purge is one function, still, with no room in it
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo' and p.proname = 'platform_purge_org') <> 1 then
    raise exception 'CHECK FAILED: platform_purge_org is not exactly one function';
  end if;
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if v_def ~ 'agent_room' then
    raise exception 'CHECK FAILED: platform_purge_org still names agent_room';
  end if;

  -- AND the coverage rule 0145 minted still holds: every org-scoped table is
  -- either purged or excepted with a reason. Removing three deletes is the
  -- direction that could break this the other way — a rewrite that ate a line
  -- it was not aiming at would show up here and nowhere else.
  select string_agg(t.relname, ', ' order by t.relname) into v_uncovered
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attname = 'org_id' and a.attnum > 0
   where n.nspname = 'echo' and t.relkind = 'r'
     and t.relname <> 'deletion_record'
     and v_def !~ ('delete from echo\.' || t.relname || '\s');
  if v_uncovered is not null then
    raise exception 'CHECK FAILED: org-scoped table(s) the purge no longer covers: %', v_uncovered;
  end if;
end $$;

commit;
