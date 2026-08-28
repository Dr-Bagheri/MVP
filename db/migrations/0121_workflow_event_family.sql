-- 0121 — the trigger events become the platform's own fact family.
--
-- User directive (2026-08-28): "add when the record start, and think of
-- other events as well related to gmail and google too. put everything that
-- we used before as well." The spellings are shared with the webhook events
-- where the fact is the same one (`call.created`, `call.transcribed`,
-- `call.summarized`) — two spellings of one fact is how vocabularies drift.
--
-- Each value has a real emitter the day it lands: call.created at the api's
-- call insert, call.transcribed and call.summarized at the worker's own
-- pipeline sites, mail.received at the mail poller, meeting.soon at the
-- calendar poller. An event nothing emits would be a trigger that never
-- fires — a promise wearing a picker entry.

begin;

alter table echo.workflow drop constraint if exists workflow_trigger_event_known;
alter table echo.workflow
  add constraint workflow_trigger_event_known
  check (trigger_event is null or trigger_event in (
    'call.created', 'call.transcribed', 'call.summarized',
    'mail.received', 'meeting.soon'
  ));

commit;
