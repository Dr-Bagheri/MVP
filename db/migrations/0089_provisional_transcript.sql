-- Echo — 0089: the PROVISIONAL transcript (M40, speed pass 2026-08-23).
--
-- The live-caption lane already produced a rough transcript by the moment
-- the person presses finish — and then the product threw it away and made
-- them wait minutes for readability the browser had seconds ago. This
-- column keeps that text on the call, clearly a DIFFERENT rung from the
-- real transcript:
--
--   - plain text, no timings, no speakers — it can never be mistaken for
--     transcript_segment rows, and nothing downstream (search, summarizer,
--     speakers) reads it;
--   - written ONCE at finish, by the owner, while the call is still in
--     'recording' (the api enforces the moment; the 0077 guard enforces
--     the who);
--   - CLEARED BY THE SCHEMA when the call reaches 'ready' — the moment the
--     checked transcript exists, the rough copy's purpose ends, and a
--     trigger doing the clearing means no code path can forget it.
--
-- The UI renders it only while the pipeline is still working, badged as
-- provisional (M20/M21: the degraded rung names itself).

alter table echo.call add column provisional_transcript text;

comment on column echo.call.provisional_transcript is
  'M40 (0089): the live-caption text captured at finish — a rough, timing-less preview shown while the pipeline runs. Cleared by trigger when status reaches ready; never read by search, summarizer or speakers.';

alter table echo.call add constraint call_provisional_bounded
  check (provisional_transcript is null or length(provisional_transcript) <= 200000);

create function echo.tg_call_provisional_clear() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    new.provisional_transcript := null;
  end if;
  return new;
end;
$$;

create trigger call_provisional_clear
  before update on echo.call
  for each row execute function echo.tg_call_provisional_clear();
