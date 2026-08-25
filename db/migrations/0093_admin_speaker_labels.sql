-- 0093 — admins may RENAME a voice; only the owner may LINK one.
--
-- Found live (2026-08-25): the record page renders the speaker pencil for
-- admins (its rule mirrors call_update: owner OR admin), the popover opens,
-- the directory populates — and the PATCH dies as a 404. The wall was
-- call_speaker_update granting only echo.owns_call(): the whole ROW was
-- unaddressable to an admin, so even renaming «S1» to a readable name — a
-- per-call display fact with no directory consequence — was refused, wearing
-- "no such speaker" as its costume.
--
-- What this deliberately does NOT change: M11's directory-privacy ruling
-- (test 60_directory_privacy.sql) — "org scope shares the recording, not the
-- right to name its voices" INTO THE DIRECTORY. A voice joins the org
-- directory when the OWNER links it, never because an admin could read the
-- call. That rule lives in tg_call_speaker_link_guard and it stays: the
-- amendment below extends it from "linking requires ownership" to "ANY
-- person_id change requires ownership", so the wider row policy cannot let
-- an admin unlink what an owner deliberately linked, either.
--
-- Net matrix after this migration:
--   owner:               label ✓   link ✓   unlink ✓   (unchanged)
--   org admin, readable: label ✓   link ✗   unlink ✗   (label is new)
--   member w/ read:      label ✗   link ✗   unlink ✗   (unchanged)

begin;

-- the row becomes addressable to the call's owner OR an active admin who can
-- already read the call — the same door call_update opens
drop policy call_speaker_update on echo.call_speaker;
create policy call_speaker_update on echo.call_speaker for update to echo_app, echo_agent
  using (
    echo.owns_call(call_id)
    or (echo.can_read_call(call_id) and echo.actor_is_admin())
  )
  with check (
    echo.owns_call(call_id)
    or (echo.can_read_call(call_id) and echo.actor_is_admin())
  );

-- the privacy rule, restated one notch wider: person_id may only MOVE under
-- the owner's hand — linking (as before) and now unlinking too, because the
-- widened policy would otherwise let an admin quietly undo an owner's act
create or replace function echo.tg_call_speaker_link_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  linking boolean := new.person_id is not null
                     and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id);
  unlinking boolean := tg_op = 'UPDATE'
                       and new.person_id is null and old.person_id is not null;
begin
  if linking or unlinking then
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

commit;
