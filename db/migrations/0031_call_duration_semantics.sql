-- Echo — 0031: say how call.duration_ms is computed, where it will be read.
--
-- 0004's prose comment says "Total across all parts", three lines above the
-- column. That reads as a sum, and a sum is wrong: parts sit on a continuous
-- timeline at their own offsets, so summing under-reports whenever there is a
-- gap between parts and over-reports whenever they overlap. Backend 2's live
-- fixture makes the size of it concrete — a call with a gap measures 660000,
-- where the sum says 120000.
--
-- That prose cannot be corrected: 0004 is applied and checksummed, and the
-- runner rightly refuses a changed migration. A column comment supersedes it
-- in the place that actually gets consulted — the live catalogue, which by the
-- standing tiebreak is the record when documents and database disagree.

comment on column echo.call.duration_ms is
  'Length of the call on its own timeline: max(call_part.offset_ms + call_part.duration_ms) across its parts — NEVER sum(duration_ms), which under-reports across gaps and over-reports across overlaps. NULL means no part has been measured yet, which is not the same as zero.';

-- Deliberately a comment and not a constraint. During processing this value is
-- legitimately a running maximum — parts land one at a time, and the call's
-- duration grows as they do — so a trigger enforcing agreement with the parts
-- would reject every intermediate state the pipeline passes through. The
-- invariant is about the arithmetic used, not about a value the database can
-- check at any single moment.
