-- Echo — 0020: word-timing coverage, per part.
--
-- core/ derives "is this call seekable" from transcript_segment.words with a
-- correlated sub-query per row — fine on a detail fetch, expensive on the
-- calls list. The worker knows the answer the moment it writes the segments,
-- so it records it here and the list predicate becomes a cheap scan.
--
-- ===========================================================================
-- PER PART ONLY. There is deliberately no call-level column, and there must
-- never be one.
--
-- A stored call-level flag is the exact shape that tempts a consumer into
-- using it as a per-row gate: the frontend shipped precisely that bug —
-- click-a-word was stripped from perfectly-timed rows because one OTHER part
-- of the same call had degraded. Per part is truth; call level is a summary,
-- derived per request, and core/ exposes it as
-- transcript_timing "full" | "mixed" | "none" | null so that it cannot be
-- mistaken for a row-level permission to seek.
--
-- 35_word_timings.sql asserts the absence, so a future migration adding the
-- tempting column fails the suite rather than the product.
-- ===========================================================================

alter table echo.call_part
  add column has_word_timestamps boolean not null default false;

comment on column echo.call_part.has_word_timestamps is
  'Do this part''s segments carry word-level timings (M6)? Written by the worker at segment-write time. Per part only — never mirror this onto echo.call.';

-- Supports the list predicate: a call is fully seekable when it has no part
-- that is not.
create index call_part_degraded_idx
  on echo.call_part (call_id) where not has_word_timestamps;

-- ---------------------------------------------------------------------------
-- Keeping it honest.
--
-- This column is a denormalization of the transcript, and the transcript is
-- the source of truth (invariant 1) — so the two can disagree, and a summary
-- that quietly disagrees with what it summarizes is worse than no summary.
-- The realistic drift is a correction: the agent holds UPDATE on
-- (text, words), so blanking a line's words would leave the part still
-- claiming full coverage.
--
-- The rule is one-way on purpose. The data may DEMOTE the flag but never
-- promote it: asserting coverage stays the worker's job, done once after it
-- has written the whole part, so bulk inserts pay nothing here. Losing
-- coverage is a single-row event and costs one indexed update.
-- ---------------------------------------------------------------------------

create function echo.tg_segment_words_demote() returns trigger
  language plpgsql
  security definer          -- no writer of segments holds UPDATE on call_part
  set search_path = ''
as $$
begin
  if new.part_id is not null
     and jsonb_array_length(coalesce(new.words, '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(old.words, '[]'::jsonb)) > 0 then
    update echo.call_part p
       set has_word_timestamps = false
     where p.id = new.part_id
       and p.has_word_timestamps;
  end if;
  return null;
end;
$$;

create trigger transcript_segment_words_demote
  after update of words on echo.transcript_segment
  for each row execute function echo.tg_segment_words_demote();
