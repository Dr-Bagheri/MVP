-- Echo — 0081: voice enrollment (user directive, 2026-08-22).
--
-- A person in the directory may carry a VOICEPRINT: one embedding vector
-- from a clip they recorded on purpose. Enrolling is the deliberate act
-- that M11's directory-privacy ruling requires — it is CONSENT to be
-- recognized: the worker may then match a call's speakers against enrolled
-- prints and link automatically, with provenance, undoable in the UI. A
-- person with no voiceprint is never matched; nothing enrolls passively.
--
-- The vector is stored with ITS MODEL's name: vectors from different
-- extractors live in different spaces, and comparing across them yields
-- confident nonsense. A model upgrade therefore obsoletes stored prints
-- loudly (the worker compares only same-model prints) instead of silently
-- degrading every match.
--
-- The four columns move together — a vector with no model or no provenance
-- is unusable and unauditable.

alter table echo.person
  add column voiceprint       float8[],
  add column voiceprint_model text,
  add column voiceprint_at    timestamptz,
  add column voiceprint_by    uuid references echo.app_user(id),
  add constraint person_voiceprint_whole check (
    (voiceprint is null) = (voiceprint_model is null)
    and (voiceprint is null) = (voiceprint_at is null)
    and (voiceprint is null) = (voiceprint_by is null)
  ),
  -- a degenerate vector matches everyone a little — refuse it at the wall
  add constraint person_voiceprint_nonempty check (
    voiceprint is null or array_length(voiceprint, 1) >= 8
  );

comment on column echo.person.voiceprint is
  'Speaker-embedding vector from an enrollment clip (0081). Presence = consent to be recognized. Compare only against prints with the same voiceprint_model.';
comment on column echo.person.voiceprint_model is
  'Which extractor produced the vector — vectors from different models must never be compared.';
