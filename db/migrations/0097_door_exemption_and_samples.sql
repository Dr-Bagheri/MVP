-- NeurAI Platform — 0097: two repairs the suite found the hour 0096 landed.
--
-- ── 1. THE DOOR EXEMPTION (a regression 0093 shipped) ───────────────────
-- 0093 widened call_speaker's row policy and, to keep M11's directory
-- privacy exactly as ruled, tightened the trigger from "linking requires
-- ownership" to "any person_id change requires ownership".
--
-- It had no exemption for SECURITY DEFINER doors — and two of them move
-- person links by design:
--   · echo.delete_person (0076) unlinks every voice before deleting the row
--   · echo.merge_person (0096) moves every voice from loser to winner
-- Both arrive at this trigger as the FUNCTION OWNER with the caller's actor
-- context attached, which looks exactly like a stranger rewriting links —
-- so an admin deleting a linked person got «only the call's owner…» and the
-- delete failed. Shipped 2026-08-25, found by 63_person_delete the moment
-- another door needed the same road.
--
-- The fix is the seam 0018 already named for echo.call's own guard:
-- `current_user in (echo_app, echo_agent)` — the ownership rule governs
-- APPLICATION connections; a door has already made its own role check, in
-- SQL, where no route can be routed around it (D27). Same sentence, same
-- reasoning, second table.
--
-- ── 2. THE SAMPLES CONSTRAINT WAS TOO STRICT ────────────────────────────
-- 0096 asserted (voiceprint is null) = (voiceprint_samples is null) in both
-- directions. But every existing writer — core's setVoiceprint, the tests'
-- direct inserts — writes a print WITHOUT a count, so the next enrolment in
-- production would have failed a CHECK. A print whose sample count is
-- unknown is an honest state; a count without a print is not. The
-- constraint keeps only the half that is true.

begin;

create or replace function echo.tg_call_speaker_link_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  linking boolean := new.person_id is not null
                     and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id);
  unlinking boolean := tg_op = 'UPDATE'
                       and new.person_id is null and old.person_id is not null;
  -- the 0018 seam: this rule governs APPLICATION connections. A SECURITY
  -- DEFINER door arrives as the function's owner and has already made its
  -- own role check in SQL (delete_person, merge_person).
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if from_app and (linking or unlinking) then
    if not echo.owns_call(new.call_id) then
      raise exception 'only the call''s owner may change a voice''s directory link'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if linking then
    new.linked_by := echo.actor_id();
    new.linked_at := now();
  elsif new.person_id is null then
    new.linked_by := null;
    new.linked_at := null;
  end if;

  return new;
end;
$$;

alter table echo.person
  drop constraint person_voiceprint_samples_whole;
alter table echo.person
  add constraint person_voiceprint_samples_needs_print
  check (voiceprint_samples is null or voiceprint is not null);

commit;
