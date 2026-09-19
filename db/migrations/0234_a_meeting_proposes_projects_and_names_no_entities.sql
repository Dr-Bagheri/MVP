-- 0234 — a meeting's items: projects join the set, entities leave it.
--
-- User directive, 2026-09-19, on the review tabs «Entities · Risks · Open
-- questions · Action items · Approvals»: "remove Entities and change action
-- items to tasks, and add projects as well with the same design and functions
-- as tasks, and it should be added to them".
--
-- Two of those three are not this migration's. The LABEL on the action tab is
-- the catalogue's: the row keeps its 0160 name, `action`, because renaming a
-- stored value that five readers switch on buys one word and costs every
-- reader. And "add it to projects" is the web's button. What the database owns
-- is the CLOSED SET of kinds, and it changes in both directions:
--
--   + 'project' — a project the meeting proposed: extracted by the model pass
--     (core/src/worker/extract-decisions.ts, which learns all five kinds the
--     same day) or typed by a person, ticked once an admin has made it a real
--     project on the board.
--   − 'entity'  — never produced by the model pass (it knew decisions and
--     commitments and nothing else), never sliced from a real summary (the
--     slicer's heading pattern met none), and holding ZERO rows on production
--     when this was written. Read at owner altitude first, because a CHECK
--     cannot be added under a row that violates it and "I counted none" from
--     below the wall is not "there are none" (rule 11): 18 decision, 18
--     action, nothing else, across every organisation.
--
-- The constraint is dropped by its REAL name and re-added (0116 / 0167 /
-- 0203's shape). The name is the one Postgres generated for 0160's INLINE
-- column check, read from pg_constraint rather than assumed: a migration that
-- guesses the name of a generated constraint either fails loudly (fine) or —
-- if the guess happens to be free — adds a SECOND check beside the first and
-- leaves both standing, which the self-check below is written to refuse.
--
-- What does NOT move: 0160's policies (source pinned by the writing role; the
-- agent holds INSERT and nothing else), 0211's columns, 0214's tsvector, and
-- 0217's delivery door — the one reader that names a kind (`kind = 'action'`
-- for the commitment cards), unchanged by a fifth kind. The standing matrix
-- is db/test/135.

begin;

alter table echo.meeting_item
  drop constraint meeting_item_kind_check;

alter table echo.meeting_item
  add constraint meeting_item_kind_check
    check (kind in ('decision', 'action', 'project', 'question', 'risk'));

comment on constraint meeting_item_kind_check on echo.meeting_item is
  'Exactly core''s MEETING_ITEM_KINDS (core/src/api/vocabulary.ts), which the web imports rather than mirrors. project joined and entity left on 2026-09-19 (0234).';

comment on table echo.meeting_item is
  'What a meeting produced, as ROWS (0160; kinds re-cut by 0234): decisions, '
  'tasks (kind = action — the screen says «تسک‌ها»), proposed projects, open '
  'questions and risks. source is pinned by ROLE, not supplied: echo_app '
  'writes user, echo_agent writes ai and holds insert only — the assistant can '
  'add an item and can neither edit nor remove one.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_def  text;
  v_kind text;
  v_n    integer;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'echo.meeting_item'::regclass
     and c.conname = 'meeting_item_kind_check';
  if v_def is null then
    raise exception '0234: the kind check is gone';
  end if;

  -- 0) ONE kind check on the table. The failure this guards is the quiet
  --    one: a drop that missed (wrong name) followed by an add that succeeded
  --    leaves two checks, and every row then has to satisfy BOTH — which for
  --    'project' means "refused", read from a screen as "the button is
  --    broken". The other checks on this table say nothing about kind.
  select count(*) into v_n
    from pg_constraint
   where conrelid = 'echo.meeting_item'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind%';
  if v_n <> 1 then
    raise exception '0234: expected exactly one kind check, found %', v_n;
  end if;

  -- 1) every kind the product speaks is permitted
  foreach v_kind in array array['decision','action','project','question','risk'] loop
    if position(quote_literal(v_kind) in v_def) = 0 then
      raise exception '0234: kind % is not in the check', v_kind;
    end if;
  end loop;

  -- 2) THE DISCRIMINATING HALF. Without this the loop above passes against
  --    0160's own check plus a project — a question that could only ever
  --    have been answered yes.
  if position(quote_literal('entity') in v_def) > 0 then
    raise exception '0234: entity is still permitted — the check was not narrowed';
  end if;

  -- 3) and the wall itself refuses one, rather than the catalogue merely
  --    reading right. Every column is named so the only thing this row can
  --    be refused FOR is its kind: a CHECK fires before any FK trigger, so a
  --    23503 here would mean the check let it through.
  begin
    insert into echo.meeting_item (id, meeting_id, org_id, kind, body, source, created_by)
    values ('00000000-0000-4000-8000-0000000d0234',
            '00000000-0000-4000-8000-00000000dead',
            '00000000-0000-4000-8000-00000000dead',
            'entity', 'موجودیت', 'user',
            '00000000-0000-4000-8000-00000000beef');
    raise exception '0234: an entity row was ACCEPTED';
  exception
    when check_violation then null;              -- the check fired: what we want
    when foreign_key_violation then
      raise exception '0234: the check did not fire — the row reached its FKs, so entity is still permitted';
    when insufficient_privilege then null;       -- running below the wall; (0)–(2) still stand
  end;

  -- The positive half — a 'project' row is ACCEPTED — needs a real meeting
  -- and a real author and lives in db/test/135 on the suite's own fixture; a
  -- migration must not mint rows in somebody's organisation to prove a point.
end
$check$;

commit;
