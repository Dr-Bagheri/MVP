-- 0094 — the template travels with the summary, and with the call.
--
-- The regenerate redesign (user directive, 2026-08-25) makes templates the
-- summary section's own controls: big cards, one press = one new version,
-- and the VERSION PICKER names each version by the template that shaped it
-- («نسخهٔ ۱» tells a reader nothing; "صورت‌جلسه · نسخهٔ ۳" does). A name the
-- client remembers locally would be a device fact about a server row — so
-- the label is stored WITH the version, written by the same insert.
--
--   summary.template — the display label of what shaped this version:
--     a ruled template key (board/group/team/it_team/interview — the client
--     translates those), or a custom template's own name as authored.
--     NULL = nothing shaped it (the plain summarizer; version 1 usually).
--
-- And the NEW MEETING form now chooses a template BEFORE recording starts,
-- so the choice must reach the worker's first summarize — it rides the call:
--
--   call.summary_template   — ruled key the pipeline summarize applies.
--   call.summary_instruction — the custom-template prompt (bounded text;
--     it steers structure exactly like the regenerate instruction).

begin;

alter table echo.summary
  add column template text
  check (template is null or char_length(template) between 1 and 60);
comment on column echo.summary.template is
  'display label of the template that shaped this version: a ruled key or a custom name; null = plain summarizer';

alter table echo.call
  add column summary_template text
  check (summary_template is null or char_length(summary_template) between 1 and 60);
comment on column echo.call.summary_template is
  'ruled template key chosen at the new-meeting form; the pipeline summarize applies it';

alter table echo.call
  add column summary_instruction text
  check (summary_instruction is null or char_length(summary_instruction) between 1 and 2000);
comment on column echo.call.summary_instruction is
  'custom template prompt chosen at the new-meeting form; steers structure like the regenerate instruction';

commit;
