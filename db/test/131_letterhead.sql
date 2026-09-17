-- db/0228 — the organisation's letterhead (سربرگ).
--
-- THE WHOLE MATRIX, both halves. The constraints are asserted here rather
-- than in 0228's own self-checks for two reasons: a migration's checks would
-- have to write a bad letterhead onto a REAL organisation to catch a refusal,
-- and they run once — on the day the migration is applied — which is not the
-- day somebody edits the constraint.
--
--   the pair    bytes with no mime and a mime with no bytes are both refused,
--               and a whole letterhead is accepted (without which "refuses
--               everything" passes every line above it);
--   the list    an SVG is refused, a PNG is not; a .docx is a legitimate
--               SOURCE and a zip is not;
--   the page    a header taller than the sheet is refused, two margins that
--               swallow the page are refused, and ordinary ones are kept;
--   the wall    an admin writes the letterhead, a member's write moves
--               nothing, and the agent role holds no UPDATE on echo.org at
--               all — the ORDINARY path is the product (rule 7).
--
--   alice  OWNER, org A · dave admin, org A · bob member, org A, ACTIVE
--   (never dan — 04 is PENDING, and "a member cannot" would then be
--    measuring actor_is_active() instead of the rule under test)

reset role;
select t.ok(
  (select count(*) from information_schema.columns
    where table_schema = 'echo' and table_name = 'org'
      and column_name in ('sheet_bytes', 'sheet_mime', 'sheet_source_mime',
                          'sheet_top_mm', 'sheet_bottom_mm', 'sheet_side_mm')) = 6,
  '0228: the letterhead columns exist');

-- ─── THE PAIR, both directions ────────────────────────────────────────────
select t.raises(
  $$update echo.org set sheet_bytes = '\x89504e470d0a1a0a'::bytea, sheet_mime = null
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '23514', '0228: bytes with no mime are refused');
select t.raises(
  $$update echo.org set sheet_bytes = null, sheet_mime = 'image/png'
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '23514', '0228: a mime with no bytes is refused');

-- ─── THE LIST ─────────────────────────────────────────────────────────────
select t.raises(
  $$update echo.org set sheet_bytes = '\x3c737667'::bytea, sheet_mime = 'image/svg+xml'
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '23514', '0228: an SVG letterhead is refused');
select t.raises(
  $$update echo.org set sheet_source_mime = 'application/zip'
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '23514', '0228: a zip is not a letterhead source');
-- 3MB + 1 byte. The ceiling has to be TRIED, or "bounded" is a word in a
-- constraint nobody has ever made fire.
select t.raises(
  $$update echo.org
       set sheet_bytes = lpad('', 3145729, 'x')::bytea, sheet_mime = 'image/png'
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '23514', '0228: a letterhead past 3MB is refused');

-- …and THE CONTROL: a whole, ordinary letterhead lands. Without this the six
-- refusals above are equally true of a column that accepts nothing at all.
update echo.org
   set sheet_bytes = '\x89504e470d0a1a0a'::bytea,
       sheet_mime = 'image/png',
       sheet_source_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
 where id = '0a000000-0000-4000-8000-00000000000a';
select t.ok(
  (select sheet_mime = 'image/png' and octet_length(sheet_bytes) = 8
     from echo.org where id = '0a000000-0000-4000-8000-00000000000a'),
  '0228: a PNG derived from a Word template is stored');

-- ─── THE PAGE ─────────────────────────────────────────────────────────────
select t.raises(
  $$update echo.org set sheet_top_mm = 150 where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '23514', '0228: a 150mm header does not fit an A4 page');
select t.raises(
  $$update echo.org set sheet_top_mm = 110, sheet_bottom_mm = 110
     where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '23514', '0228: two margins cannot swallow the page between them');
update echo.org set sheet_top_mm = 52, sheet_bottom_mm = 30, sheet_side_mm = 22
 where id = '0a000000-0000-4000-8000-00000000000a';
select t.ok(
  (select sheet_top_mm = 52 and sheet_bottom_mm = 30 and sheet_side_mm = 22
     from echo.org where id = '0a000000-0000-4000-8000-00000000000a'),
  '0228: an ordinary clear area is kept');

-- ─── THE WALL ─────────────────────────────────────────────────────────────
set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0228 tests run under a non-bypass product role');

-- a MEMBER: org_admin_update is the policy, so this matches no row rather
-- than raising — a `t.denied` here would report a working wall as broken
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.writes_nothing(
  $$update echo.org set sheet_top_mm = 5 where id = '0a000000-0000-4000-8000-00000000000a'$$,
  '0228: a member cannot move the letterhead''s clear area');

-- an ADMIN (dave, not the owner — the ordinary case)
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
update echo.org set sheet_top_mm = 48 where id = '0a000000-0000-4000-8000-00000000000a';
reset role;
select t.ok(
  (select sheet_top_mm = 48 from echo.org where id = '0a000000-0000-4000-8000-00000000000a'),
  '0228: an admin sets the letterhead''s clear area');

-- and the agent holds no write on the org at all: the GRANT is the wall, so
-- no policy has to remember this one
select t.ok(
  not has_table_privilege('echo_agent', 'echo.org', 'UPDATE'),
  '0228: the agent role cannot write an organisation''s letterhead');

-- put the fixture back the way it was found
update echo.org
   set sheet_bytes = null, sheet_mime = null, sheet_source_mime = null,
       sheet_top_mm = 45, sheet_bottom_mm = 25, sheet_side_mm = 18
 where id = '0a000000-0000-4000-8000-00000000000a';
