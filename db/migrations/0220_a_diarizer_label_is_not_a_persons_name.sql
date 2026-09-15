-- 0220 — a diarizer's cluster name is not a person, and `meeting_item.owner`
-- may never hold one again.
--
-- Found on a live take, 2026-09-09 (org 89d4301e…, call 224a1511…): two
-- voices on the roster, `S1·1` and `S2·1`, neither linked to anybody — which
-- is CORRECT, because nobody in that organisation has enrolled a voiceprint
-- and the meeting has no attendees, so the matcher had nothing to clear its
-- floor against. What was not correct is what happened next. The summarize
-- step handed the model a transcript whose speakers were spelled
-- `coalesce(p.display_name, cs.label)`, so an unlinked voice arrived at the
-- writer as `S1·1`; the summary came back saying «S1·1 reviewed Henry's
-- macros» and «Refresh the demo data — Owner: S1·1»; and `sliceSummary`
-- parsed that owner line into `echo.meeting_item.owner`.
--
-- `call_speaker.label` is INTERNAL. `upsertSpeakers` builds it as
-- `<the diarizer's cluster name>·<the part number>` and it is deliberately
-- per-part, which is exactly why it must never be read as a name: `S1·1` and
-- `S1·2` are two rows and may be two people. web/ stopped rendering it to a
-- reader on 2026-09-06 (`web/src/lib/speakerNaming.ts`); the prompt did not,
-- and a summary is read by more people than a transcript panel is.
--
-- The leak matters beyond the prose. `owner` is what ItemsPanel resolves
-- against the directory when it turns an action item into a task, so a
-- placeholder here becomes "assign this to S1·1 by hand" on somebody's board
-- — a task nobody can be given, wearing the shape of one that can.
--
-- ── WHAT THIS MIGRATION DOES, AND WHAT IT DELIBERATELY DOES NOT ───────────
--
-- Two things: it CLEARS the labels already stored (six rows on the dev
-- database at the time of writing, across three live-recorded meetings), and
-- it makes the shape unstorable.
--
-- It does NOT try to guess who those owners were. The information is not
-- recoverable — that is the whole defect — and an owner invented from a
-- roster position would be the same lie with a friendlier face. An unowned
-- action item is honest; one owned by `S1·1` is not. `body` is left exactly
-- as written, too: a sentence that mentions a label is still something
-- somebody may need to read, and rewriting stored prose to tidy a field is
-- not this migration's business.
--
-- ── WHY A CHECK AND NOT ONLY THE PARSER FIX ───────────────────────────────
--
-- The parser fix (`api/speaker-naming.ts`, consumed by `splitOwner`) is where
-- the rule is decided, and it is the half that produces a good outcome. This
-- constraint is the half that survives the next author. `owner` is written
-- from three places — the extractor, `addItem`, `updateItem` — and the shape
-- it must never hold is machine output no person types, so a database can
-- refuse it without ever refusing somebody's own words. That is the narrow
-- case where structure beats a predicate somebody has to remember: a fourth
-- writer added next month inherits the wall for free.
--
-- REFUSED, and worth recording because it is the tempting version: a check
-- demanding the owner be a person the platform KNOWS. `meeting.invitees` is
-- free text for a stated reason (0145) — a summary legitimately names an
-- outside customer, an invitee with no account, a colleague nobody has added
-- yet — so that rule would trade a false owner for a lost one.
--
-- ALSO REFUSED: refusing «Speaker 1» here too. That is the ordinal handle the
-- screen and the prompt use for an unlinked voice, and unlike `S1·1` it is
-- ordinary language a person could type into their own record. The extractor
-- drops it, because there the writer is a MODEL echoing a string we handed
-- it; the database does not, because here the writer is a person, and
-- refusing somebody's own words is a different and worse mistake.

begin;

-- ── the repair, with the control that makes it readable ───────────────────
--
-- The pattern is one character away from scrubbing the column, and an UPDATE
-- reports success either way, so the count of owners that are NOT labels is
-- taken before and after and must not move. That is the assertion; "no labels
-- remain" alone is satisfied by an UPDATE that emptied the field.
--
-- The precondition above it is the vacuity guard. `echo.meeting_item` is
-- FORCE RLS, so a role without bypass sees no rows at all — the UPDATE would
-- touch nothing, every count would be zero, and this block would report a
-- clean repair of a table it could not read. (Rule 11's precondition, pointed
-- the other way: a policy test must prove it is BELOW the wall, and a data
-- repair must prove it is above it.)
do $repair$
declare
  v_pattern constant text := '^[^[:space:]·][^·]*·[0-9]+$';
  v_before  bigint;
  v_after   bigint;
  v_labels  bigint;
begin
  if not (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) then
    raise exception '0220: this migration must run as a role that bypasses RLS — %, which does not, would see none of the rows it has to repair', current_user;
  end if;

  select count(*) filter (where owner is not null and owner !~ v_pattern)
    into v_before from echo.meeting_item;

  update echo.meeting_item set owner = null where owner ~ v_pattern;

  select count(*) filter (where owner is not null and owner !~ v_pattern),
         count(*) filter (where owner ~ v_pattern)
    into v_after, v_labels from echo.meeting_item;

  if v_labels > 0 then
    raise exception '0220: % item(s) still carry a diarizer label as their owner', v_labels;
  end if;
  if v_after <> v_before then
    raise exception '0220: the repair cleared % owner(s) that were not labels — the pattern is too greedy',
      v_before - v_after;
  end if;
end
$repair$;

-- ── the wall ──────────────────────────────────────────────────────────────
alter table echo.meeting_item
  add constraint meeting_item_owner_not_a_speaker_label
  check (owner is null or owner !~ '^[^[:space:]·][^·]*·[0-9]+$');

comment on constraint meeting_item_owner_not_a_speaker_label on echo.meeting_item is
  'db/0220 — `S1·1` is the diarizer''s cluster name for a voice, not a person. '
  'It reached this column through the summary prose on 2026-09-09. The api '
  'mirrors this refusal in api/meetings.ts so a caller meets a sentence '
  'rather than a 23514; this constraint is the enforcer.';

-- ---------------------------------------------------------------------------
-- Self-check.
--
-- The repair asserted itself above. What is left is the wall, and the two
-- controls are the reason to trust the answers:
--
--   1. the predicate says YES to the shape it exists for;
--   2. NEGATIVE CONTROL — it says NO to an ordinary name, to a Persian name,
--      and to «Speaker 1», without which a pattern matching everything would
--      satisfy every other line here while quietly making every owner
--      unstorable;
--   3. the constraint is installed and carries THIS pattern, so the block
--      above is testing the expression the table actually holds;
--   4. and it refuses a real write. That probe uses 0203's shape —
--      fabricated ids, so a row that gets PAST the check dies on a foreign
--      key instead of landing — and the two outcomes are told apart, because
--      "a red that names a different defect is not a verify-red".
-- ---------------------------------------------------------------------------
do $check$
declare
  v_pattern constant text := '^[^[:space:]·][^·]*·[0-9]+$';
  v_def     text;
begin
  -- 1. the predicate finds what it is for
  if not ('S1·1' ~ v_pattern) then
    raise exception '0220: the pattern does not match a roster label';
  end if;
  if not ('S12·3' ~ v_pattern) then
    raise exception '0220: the pattern does not match a multi-digit roster label';
  end if;

  -- 2. NEGATIVE CONTROL — what it must leave alone
  if 'Sarah Mitchell' ~ v_pattern then
    raise exception '0220: the pattern refuses an ordinary name';
  end if;
  if 'سینا سپاسی' ~ v_pattern then
    raise exception '0220: the pattern refuses a Persian name';
  end if;
  if 'Speaker 1' ~ v_pattern then
    raise exception '0220: the pattern refuses the ordinal handle, which is the parser''s to drop and not the database''s';
  end if;
  if '·1' ~ v_pattern then
    raise exception '0220: the pattern matches a bare separator, so it is not anchored on a cluster name';
  end if;

  -- 3. the constraint exists and says exactly what was just tested
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'echo.meeting_item'::regclass
     and conname  = 'meeting_item_owner_not_a_speaker_label';
  if v_def is null then
    raise exception '0220: the constraint was not installed';
  end if;
  if position(v_pattern in v_def) = 0 then
    raise exception '0220: the constraint does not carry the pattern this block verified: %', v_def;
  end if;

  -- 4. and it refuses a real write
  begin
    insert into echo.meeting_item
      (meeting_id, org_id, kind, body, source, owner, created_by)
    values ('00000000-0000-4000-8000-0000000d0210',
            '00000000-0000-4000-8000-00000000dead',
            'action', 'a row that must never land', 'user', 'S1·1',
            '00000000-0000-4000-8000-00000000beef');
    raise exception '0220: an item owned by a diarizer label was ACCEPTED';
  exception
    when check_violation then null;               -- the wall fired: what we want
    when foreign_key_violation then
      raise exception '0220: the check did not fire — the row reached its foreign keys, so a label is still storable';
    when insufficient_privilege then
      raise exception '0220: the probe could not reach the table, so it proved nothing';
  end;
end
$check$;

commit;
