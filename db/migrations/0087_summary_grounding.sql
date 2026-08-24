-- Echo — 0087: summary GROUNDING report (quality pass, 2026-08-23).
--
-- Anti-fabrication as a MECHANISM: after the summarizer writes its prose, a
-- second model pass compares every material claim against the transcript
-- and the verdict lands WITH the version — in the same INSERT, because
-- summaries are append-only ("nothing is ever edited in place", db/0008)
-- and a verification bolted on later would need the UPDATE that rule
-- forbids.
--
--   null                     -> never checked (older rows; check failed or
--                               was skipped — advisory, never blocks)
--   {"clean": true, ...}     -> every claim found support
--   {"clean": false,
--    "flags":[{claim,note}]} -> the listed claims lack transcript support
--
-- Advisory BY DESIGN: a grounding failure costs the report, never the
-- summary and never the call (M21 — the forfeit is the null, and the
-- worker says it out loud in logs).

alter table echo.summary add column grounding jsonb;

comment on column echo.summary.grounding is
  'Second-pass verification of the summary against its transcript (0087): null = unchecked; {clean, model, flags:[{claim,note}]} otherwise. Written only at INSERT — versions stay append-only.';

-- shape floor: when present it is an object carrying a boolean `clean`
alter table echo.summary add constraint summary_grounding_shape check (
  grounding is null
  or (jsonb_typeof(grounding) = 'object' and jsonb_typeof(grounding->'clean') = 'boolean')
);
