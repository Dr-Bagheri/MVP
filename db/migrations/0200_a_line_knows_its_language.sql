-- 0200 — a transcript line carries the language it was spoken in
-- (2026-09-06; user directive: "automatic language detection for mixed
-- Persian and English recordings").
--
-- The transcriber has identified every token's language since the first
-- Soniox run (enable_language_identification), and the worker threw the fact
-- away at the segment: a mixed meeting — Persian with an English sentence in
-- the middle — rendered every line in one direction, and a reader had no way
-- to know which line was which without reading it. The line's language is
-- the MAJORITY language of its words (transcript-mapping.ts); code-switched
-- lines keep the language most of them are in rather than being split at
-- every switch, which would shred spoken Persian into fragments.
--
-- Nullable on purpose: every row written before today, and every row from a
-- lane that identifies no language, is honestly "not said" — never a default
-- the screen would then treat as a fact. The screen sets each line's
-- direction from it (rtl for fa/ar/ur/he, ltr otherwise) and falls back to
-- the document's direction when it is null.
--
-- A short language tag, lower-case, optionally with a region
-- (`fa`, `en`, `en-us`): the provider's codes, checked so that a sentence
-- can never land in a column meant for a code.

alter table echo.transcript_segment
  add column language text
    constraint transcript_segment_language_is_a_tag
    check (language is null or language ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$');

comment on column echo.transcript_segment.language is
  'the language the line was spoken in, as the transcriber identified it — the majority language of its words; null = not identified (rows before 0200, lanes without identification)';

-- ── self-checks ────────────────────────────────────────────────────────
do $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'echo' and table_name = 'transcript_segment' and column_name = 'language'
       and is_nullable = 'YES'
  ) into v_ok;
  if not v_ok then
    raise exception '0200: transcript_segment.language is missing or not nullable';
  end if;

  -- the check refuses a sentence and accepts the provider's tags
  begin
    perform 1 where 'English' ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$';
    if found then raise exception '0200: the language check accepted a word'; end if;
  end;
  if not ('fa' ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$' and 'en-us' ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$') then
    raise exception '0200: the language check refuses a valid tag';
  end if;
end $$;
