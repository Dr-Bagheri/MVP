-- 0099 — the summary MODEL travels with the call.
--
-- The new-meeting form now chooses the model for this meeting's summary
-- (user directive, 2026-08-26), the way it already chooses the template.
-- The choice must reach the worker's summarize, so it rides the call row —
-- the same shape as 0094's summary_template, for the same reason: a choice
-- the client remembered locally would be a device fact about a server job.
--
--   call.summary_model — a model id from the catalogue, chosen at the
--     new-meeting form. NULL = no per-meeting choice; the worker climbs the
--     existing ladder (owner preference → org first choice → operator
--     fallback). When set, it is the TOP rung: a model TOLD for this
--     meeting outranks every inferred one — including a skill's pin,
--     because the skill is configuration and this is an instruction.
--
-- The api validates the id against the live catalogue at write time
-- (the same wall the ask route uses), so the column never holds an id
-- nobody could run. The length check is a backstop, not the validator.

begin;

alter table echo.call
  add column summary_model text
  check (summary_model is null or char_length(summary_model) between 1 and 120);
comment on column echo.call.summary_model is
  'model id chosen at the new-meeting form for this call''s summaries; null = the unattended ladder; validated against the catalogue by the api';

commit;
