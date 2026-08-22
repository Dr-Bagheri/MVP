-- Echo — 0080: profile context (user directive, 2026-08-22): what the
-- person does (job_title), what they told us about themselves (about), and
-- the CONSENT flag (assistant_context) that decides whether the assistant
-- may see the two texts at ask time.
--
-- Consent defaults FALSE: sharing personal context with a model is an
-- explicit act, never a default someone has to discover and undo. The flag
-- gates READING at ask time (core's members.assistantContext), not
-- storage — the person can write their bio first and decide later.
--
-- Self-editable through the same self-profile path as display_name (the
-- app_user guard's role/status walls are untouched — these are names a
-- person calls themself, not things done TO them).

alter table echo.app_user
  add column job_title text
    check (job_title is null or length(job_title) <= 120),
  add column about text
    check (about is null or length(about) <= 2000),
  add column assistant_context boolean not null default false;

comment on column echo.app_user.job_title is
  'What the person does — free text, self-described (0080). Feeds the assistant only under assistant_context.';
comment on column echo.app_user.about is
  'Self-written background (0080). Feeds the assistant only under assistant_context.';
comment on column echo.app_user.assistant_context is
  'Consent: may the assistant see job_title/about at ask time. Default false — sharing is an explicit act (0080).';
