-- 0111 — the schedule claim stops echoing a timestamp through JavaScript.
--
-- THE BUG, caught by the P3/P4 live acceptance (movement D): 0108's
-- claim_workflow_fire took the EXPECTED next_due back from the caller as a
-- compare-and-set token. timestamptz carries MICROSECONDS; the value
-- round-tripped through the worker as an ISO string with MILLISECONDS, so
-- `next_due = $2` compared .589123 to .589000 and never matched — the
-- claim answered null forever, silently, while the db suite's own check
-- stayed green because plpgsql had kept the value inside SQL at full
-- precision the whole time. A fixture that never crosses the wire cannot
-- catch a defect that lives in the crossing (rule 10, in a timestamp).
--
-- THE FIX at the right altitude: the due-predicate IS the compare-and-set.
-- `where next_due <= now()` under the row lock is exactly-once by itself —
-- the winner advances next_due past now inside the same UPDATE, so the
-- second concurrent claimer matches zero rows. No token, no round-trip,
-- nothing to truncate.

begin;

drop function echo.claim_workflow_fire(uuid, timestamptz);

create function echo.claim_workflow_fire(p_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.workflow_schedule s
     set last_fired_at = now(),
         next_due = greatest(
           s.next_due + case s.cadence
             when 'daily' then interval '1 day'
             when 'weekly' then interval '7 days'
             else interval '1 month' end,
           now())
   where s.id = p_id and s.enabled and s.next_due <= now()
  returning true
$$;

comment on function echo.claim_workflow_fire(uuid) is
  'M41 P4 (D8-enumerated): exactly-once schedule firing. The due-predicate under the row lock IS the compare-and-set — no echoed token, so nothing a serialization can truncate (the 0108 version died on microseconds).';

revoke all on function echo.claim_workflow_fire(uuid) from public;
grant execute on function echo.claim_workflow_fire(uuid) to echo_app;

commit;
