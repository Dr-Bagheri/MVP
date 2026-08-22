-- NeurAI Platform — 0076: deleting a directory person (user directive,
-- 2026-08-22: "for speakers put the option to edit and delete too, based
-- on the role — owner and admin can do it, the member can just add and
-- see").
--
-- echo.person has NO delete policy and no delete grant — deliberate until
-- now, and the delete arrives as a NAMED DEFINER DOOR (D8, the M11
-- pattern), not a policy widening: the role check lives in SQL where no
-- api route can be routed around (the D27 altitude lesson), and the
-- operation is atomic — a person who is linked to call speakers is
-- UNLINKED first (all three link columns together, or the
-- call_speaker_link_consistent CHECK refuses), any merge pointers are
-- cleared, then the row goes. Speaker rows and their transcripts are
-- untouched: deleting a person deletes the DIRECTORY ENTRY, never the
-- record of who spoke.
--
-- D8 reason: cross-table cleanup + a role wall that must hold below the
-- api. The function runs as owner; the actor context supplies who is
-- asking, exactly like soft_delete_call (0032).

create function echo.delete_person(p_person uuid)
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
    -- cross-org and non-existent are ONE answer (the broker discipline)
    raise exception 'no such person' using errcode = 'P0002';
  end if;
  update echo.call_speaker
     set person_id = null, linked_by = null, linked_at = null
   where person_id = p_person and org_id = v_org;
  update echo.person
     set merged_into = null
   where merged_into = p_person and org_id = v_org;
  delete from echo.person
   where id = p_person and org_id = v_org;
end;
$$;

grant execute on function echo.delete_person(uuid) to echo_app;
revoke all on function echo.delete_person(uuid) from public;

comment on function echo.delete_person(uuid) is
  'D8 door (0076): admin/owner-only true delete of a directory person; unlinks speakers (three columns together) and clears merge pointers first. The role wall is HERE, not in the api.';
