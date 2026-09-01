-- 0146 — the MINUTES get their lifecycle (the reference adoption's big
-- milestone round, 2026-09-01): the صورت‌جلسه document walks
-- draft → approved → signed → closed, and each step is a FACT with a
-- timestamp, not a status word that can drift from the events behind it.
--
--   · minutes_approved_at — the manager's «تأیید نهایی» (null = draft);
--   · minutes_signatures  — [{name, at}] appended one per signer; a NAME
--     because invitees are names-as-typed (0145's own reasoning) and a
--     signer may not be a platform member at all;
--   · minutes_closed_at   — «نهایی‌سازی و بستن جلسه»; a closed meeting's
--     minutes are the record of record.
--
-- All three live on the meeting row: they are facts ABOUT the meeting's
-- document, and a second table would be three columns wearing a join.
-- The UPDATE grant from 0145 already covers them — the api owns the
-- vocabulary of which patches are legal (approve once, sign appends,
-- close requires approval), exactly as it owns the agenda's shape.

begin;

alter table echo.meeting
  add column minutes_approved_at timestamptz,
  add column minutes_closed_at   timestamptz,
  add column minutes_signatures  jsonb not null default '[]'::jsonb
    check (jsonb_typeof(minutes_signatures) = 'array');

comment on column echo.meeting.minutes_approved_at is
  '0146: the manager''s final approval of the minutes; null = still a draft.';
comment on column echo.meeting.minutes_closed_at is
  '0146: the meeting finalized and closed; the minutes become the record of record.';
comment on column echo.meeting.minutes_signatures is
  '0146: [{name, at}] — signers as NAMES (invitees are names-as-typed; a signer may not be a member). Append-only by api convention.';

-- self-check: the purge coverage instrument (0145) must still hold — the
-- meeting row carries the new columns and dies whole with the org.
do $check$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'echo' and table_name = 'meeting'
         and column_name in ('minutes_approved_at', 'minutes_closed_at', 'minutes_signatures')) <> 3 then
    raise exception 'the three minutes columns did not all land';
  end if;
end
$check$;

commit;
