-- 0228 — the organisation has a LETTERHEAD (سربرگ), and the minutes are
-- printed on it.
--
-- User directive, 2026-09-17: "in kebab menu add a option to upload company
-- sheet file so they can upload their company sheet with logo, and when they
-- do it and ask for pdf and word, all the information in summarization must
-- be fit inside it."
--
-- WHAT IS STORED, and why it is not the file they uploaded. They may hand us
-- a Word template, a PDF letterhead or an image (they said as much when
-- asked). Those three cannot be composed with by three different mechanisms
-- and still produce the SAME document from the Word button and the PDF
-- button — and a letterhead that reaches one export and not the other is the
-- half-feature this directive exists to close. So the browser renders
-- whatever arrives down to ONE page image at upload time (pdf.js for a PDF,
-- the header graphic for a .docx, itself for an image), and both exports draw
-- that image behind every page. One derivation, one appearance, two files.
--
-- `sheet_source_mime` is what they actually gave us, and it is not
-- decoration: the screen says «از فایل PDF ساخته شد» beside the preview, so
-- an admin who uploads the wrong file can see that it was read at all.
--
-- WHERE THE BYTES LIVE: 0103's reasoning, unchanged and now load-bearing
-- twice. The only bucket this platform has is call-audio, which by M10 holds
-- zero policies and is reached through a server-side signer; standing up a
-- second bucket with its own policy surface for one image per organisation is
-- more wall than the thing behind it. The bytes ride the row they describe.
--
-- THE MARGINS ARE THE FEATURE, not a setting nobody will find. A letterhead
-- is a page with a clear area in the middle, and "fit inside it" means the
-- text lands in that area rather than under the logo. Nothing can measure a
-- clear area from an image, so the three numbers are stored per organisation
-- and shown as a box over the preview while the admin adjusts them. The
-- defaults are an ordinary Iranian سربرگ: a deep header band, a shallow
-- footer, and the page's own side margins.

begin;

alter table echo.org
  -- the PAGE IMAGE, drawn behind every page of both exports
  add column sheet_bytes bytea,
  add column sheet_mime  text,
  -- what the admin uploaded, for the sentence beside the preview
  add column sheet_source_mime text,
  -- the clear area, in millimetres of an A4 page
  add column sheet_top_mm    smallint not null default 45,
  add column sheet_bottom_mm smallint not null default 25,
  add column sheet_side_mm   smallint not null default 18,

  -- whole-or-nothing: a mime with no bytes describes nothing, and bytes with
  -- no mime cannot be served (0103's own constraint, same reasoning)
  add constraint org_sheet_whole check ((sheet_bytes is null) = (sheet_mime is null)),
  -- 3MB: an A4 page at ~190dpi, which prints cleanly and is a twentieth of
  -- one minute of the audio this database already handles by reference
  add constraint org_sheet_bounded check (
    sheet_bytes is null or octet_length(sheet_bytes) <= 3145728
  ),
  -- RASTER ONLY. SVG is on the logo's list and deliberately not on this one:
  -- this image is inlined as a data URI into a document that is handed to
  -- Word, and the narrow list is what keeps that inlining boring.
  add constraint org_sheet_mime check (
    sheet_mime is null or sheet_mime in ('image/png', 'image/jpeg', 'image/webp')
  ),
  add constraint org_sheet_source check (
    sheet_source_mime is null or sheet_source_mime in (
      'image/png', 'image/jpeg', 'image/webp', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  -- a margin is a number on a page: nothing below zero, and nothing that
  -- would leave an A4 sheet with no room to print on
  add constraint org_sheet_margins check (
    sheet_top_mm between 0 and 120
    and sheet_bottom_mm between 0 and 120
    and sheet_side_mm between 0 and 60
    and sheet_top_mm + sheet_bottom_mm <= 200
  );

comment on column echo.org.sheet_bytes is
  'the organisation letterhead as ONE page image, at most 3MB, drawn behind every page of the exported minutes. Derived in the browser from whatever was uploaded (PDF, Word template or image) so that both exports can carry the same sheet.';
comment on column echo.org.sheet_source_mime is
  'the file the admin actually uploaded — read by the screen so a wrongly-read file is visible, never by the exports.';
comment on column echo.org.sheet_top_mm is
  'the letterhead''s clear area: where the text may start. Nothing can measure this from an image, so it is the admin''s to set over a preview.';

-- ─── self-checks ──────────────────────────────────────────────────────────
-- STRUCTURE ONLY, deliberately. The obvious version of this block writes a
-- bad letterhead onto a real organisation and catches the refusal — but the
-- only rows on the database this migration is applied to belong to people
-- using the product, and a self-check is not a reason to write to them. The
-- constraints are asserted here from the catalogue; their BEHAVIOUR is walked
-- both ways in db/test/131 against a fixture org, which is also the half that
-- keeps working after somebody edits a constraint three migrations from now.
do $check$
declare
  v_def text;
begin
  -- the constraints must EXIST whatever the database holds — asserted first,
  -- because everything below is a write against a real row and a fresh
  -- deployment has none. A migration that can only apply to a populated
  -- database is a landmine for the day somebody stands one up from zero.
  if (select count(*) from pg_constraint
       where conrelid = 'echo.org'::regclass
         and conname in ('org_sheet_whole', 'org_sheet_bounded', 'org_sheet_mime',
                         'org_sheet_source', 'org_sheet_margins')) <> 5 then
    raise exception '0228 FAILED: the letterhead constraints are not all present';
  end if;

  -- (2) each one is VALIDATED and says what it was written to say. A
  --     constraint that exists under the right name and forbids something
  --     else reads as coverage from every catalogue listing.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'echo.org'::regclass and conname = 'org_sheet_mime';
  if v_def !~ 'image/png' or v_def ~ 'svg' then
    raise exception '0228 FAILED: org_sheet_mime does not hold the raster list: %', v_def;
  end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'echo.org'::regclass and conname = 'org_sheet_margins';
  if v_def !~ 'sheet_top_mm' or v_def !~ 'sheet_bottom_mm' or v_def !~ 'sheet_side_mm' then
    raise exception '0228 FAILED: org_sheet_margins does not cover all three margins: %', v_def;
  end if;

  if exists (select 1 from pg_constraint
              where conrelid = 'echo.org'::regclass
                and conname like 'org_sheet%' and not convalidated) then
    raise exception '0228 FAILED: a letterhead constraint is NOT VALID';
  end if;

  -- (3) the letterhead is the ADMIN's, and the agent may not write one: the
  --     grant is the wall, exactly as it is for every other org column
  if has_table_privilege('echo_agent', 'echo.org', 'UPDATE') then
    raise exception '0228 FAILED: the agent role may update echo.org';
  end if;
end $check$;

commit;
