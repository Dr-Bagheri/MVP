-- Echo — 0054: personal calendar and timezone, and two shape checks on the
-- audit table before anything starts writing to it.
--
-- ===========================================================================
-- NOT NULL with an 'auto' default — the api's proposal, adopted as argued.
--
-- 'auto' is a real third value meaning "follow the active language", which is
-- today's behaviour and therefore the default. Nullable would make NULL and
-- 'auto' two spellings of one state, and there would then be a "clear" path
-- distinct from a "choose" path for a setting that has no unset condition.
-- With NOT NULL there is nothing to clear: resetting IS choosing.
-- ===========================================================================

alter table echo.app_user
  add column calendar text not null default 'auto',
  add column timezone text not null default 'auto';

alter table echo.app_user
  add constraint app_user_calendar_known
  check (calendar in ('auto', 'jalali', 'gregorian'));

-- ---------------------------------------------------------------------------
-- timezone gets a SHAPE check and not a validity check, and the distinction is
-- the point.
--
-- The api suggested no constraint at all, validating at the edge against the
-- runtime's own zone table. They are right, for a sharper reason than "IANA
-- changes": **this database is not the consumer of this value.** Dates are
-- formatted in the UI, against ICU's zone data, so Postgres's tzdata is not
-- the authority here — and a CHECK against pg_timezone_names would let the
-- database reject a zone the thing that actually formats dates can handle
-- perfectly. A false rejection is worse than no check.
--
-- So this asserts only that the value looks like a zone name: it stops '',
-- 'null', a sentence, or a pasted URL, and claims nothing about whether the
-- zone exists. The real predicate — can the formatter use it — is answered
-- where formatting happens.
-- ---------------------------------------------------------------------------

alter table echo.app_user
  add constraint app_user_timezone_shape
  check (timezone = 'auto' or timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$');

comment on column echo.app_user.calendar is
  'auto | jalali | gregorian. ''auto'' follows the active language and is the default — never NULL, so there is no second spelling of "not chosen".';
comment on column echo.app_user.timezone is
  'auto | an IANA zone name. Shape-checked only: the UI formats dates, so the runtime that formats them is the authority on whether a zone is usable.';

-- ===========================================================================
-- echo.admin_action: two shape checks, and a sharper comment on `detail`.
--
-- Nothing writes this table yet, which makes now the moment to constrain it —
-- after six call sites exist, a casing drift is a data-cleanup job.
-- ===========================================================================

-- Free text, deliberately: the vocabulary is core/'s, and a new admin
-- operation should not need a migration to name itself (same reasoning as
-- proposal_decision.kind). But free text is not free FORM — `set_setting` and
-- `setSetting` becoming two actions in one log is a drift that no reader would
-- catch, so the shape is fixed even though the vocabulary is not.
alter table echo.admin_action
  add constraint admin_action_snake_case
  check (action ~ '^[a-z][a-z0-9_]*$' and target_type ~ '^[a-z][a-z0-9_]*$');

-- 0010 said "identifiers, before/after states, reasons", and "states" invites
-- exactly what the api asked about: storing an old and new VALUE. A setting's
-- value can be a person's name or an org's private configuration, and this
-- column is forwarded verbatim to every admin in the org — so the read side
-- discloses whatever the write side put there, and cannot filter it.
comment on column echo.admin_action.detail is
  'Codes and identifiers ONLY — which setting, which target, which reason code. Never values, never content: this is read back verbatim to every admin in the org, so the write side is the only place the disclosure can be limited.';
