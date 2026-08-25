-- NeurAI Platform — 0098: the door exemption, made precise.
--
-- 0097 exempted the call_speaker link guard for any connection that is not
-- echo_app/echo_agent — which is how 0018 words the same seam for
-- echo.call, and which 60_directory_privacy immediately caught as too wide
-- HERE: that test deliberately drops to the migration role to put RLS
-- aside and prove the TRIGGER ALONE still refuses a non-owner. Under 0097
-- the trigger stepped aside with it, and a guard that only holds while
-- another guard holds is not defence in depth.
--
-- The precise statement of what we actually mean: *a door that has already
-- made its own role check may move links*. So the doors say so, in the
-- transaction, and the trigger requires BOTH halves:
--
--   · `echo.door` is set for this transaction (only merge_person and
--     delete_person set it, and both clear it before returning), AND
--   · the connection is NOT an app role.
--
-- Neither half alone opens it: an app connection could set the GUC and
-- still be echo_app, and the migration role could be the current role
-- without any door having run. Test 60's plain owner-role UPDATE meets
-- neither, so it is refused exactly as it was before 0093 — the property
-- that test exists to protect.

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
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
  in_door boolean := coalesce(current_setting('echo.door', true), '') = 'on';
begin
  if (linking or unlinking) and not (in_door and not from_app) then
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

-- 0076's door, re-declared with the flag it now needs. The body is
-- otherwise unchanged; only the two set_config lines are new.
create or replace function echo.delete_person(p_person uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not echo.actor_is_admin() then
    raise exception 'only an org admin or owner may delete a person'
      using errcode = '42501';
  end if;
  select org_id into v_org
    from echo.person
   where id = p_person and org_id = echo.actor_org_id();
  if v_org is null then
    raise exception 'no such person' using errcode = 'P0002';
  end if;
  perform set_config('echo.door', 'on', true);
  update echo.call_speaker
     set person_id = null, linked_by = null, linked_at = null
   where person_id = p_person and org_id = v_org;
  update echo.person
     set merged_into = null
   where merged_into = p_person and org_id = v_org;
  delete from echo.person
   where id = p_person and org_id = v_org;
  perform set_config('echo.door', '', true);
end;
$$;

create or replace function echo.merge_person(p_loser uuid, p_winner uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_org uuid;
  v_winner_org uuid;
begin
  if not echo.actor_is_admin() then
    raise exception 'only an org admin or owner may merge people'
      using errcode = '42501';
  end if;
  if p_loser = p_winner then
    raise exception 'a person cannot be merged into themselves'
      using errcode = 'check_violation';
  end if;
  select org_id into v_org from echo.person
   where id = p_loser and org_id = echo.actor_org_id() and merged_into is null;
  select org_id into v_winner_org from echo.person
   where id = p_winner and org_id = echo.actor_org_id() and merged_into is null;
  if v_org is null or v_winner_org is null then
    raise exception 'no such person' using errcode = 'P0002';
  end if;

  update echo.person w
     set voiceprint = l.voiceprint,
         voiceprint_model = l.voiceprint_model,
         voiceprint_at = l.voiceprint_at,
         voiceprint_by = l.voiceprint_by,
         voiceprint_samples = l.voiceprint_samples
    from echo.person l
   where w.id = p_winner and l.id = p_loser
     and w.voiceprint is null and l.voiceprint is not null;

  perform set_config('echo.door', 'on', true);
  update echo.call_speaker
     set person_id = p_winner, linked_by = echo.actor_id(), linked_at = now()
   where person_id = p_loser and org_id = v_org;
  perform set_config('echo.door', '', true);

  update echo.person
     set merged_into = p_winner, merged_at = now(), merged_by = echo.actor_id()
   where merged_into = p_loser and org_id = v_org;

  update echo.person
     set merged_into = p_winner,
         merged_at = now(),
         merged_by = echo.actor_id(),
         voiceprint = null, voiceprint_model = null,
         voiceprint_at = null, voiceprint_by = null, voiceprint_samples = null
   where id = p_loser and org_id = v_org;
end;
$$;

commit;
