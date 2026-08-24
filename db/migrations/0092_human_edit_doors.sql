-- Echo — 0092: HUMAN edit doors for summary and transcript (user directive,
-- 2026-08-24: "the summary must be editable … the transcript must be
-- editable as well").
--
-- Neither is an UPDATE in place. A summary edit is a NEW VERSION on the
-- existing ladder (0011 keeps written versions immutable; the 0008 trigger
-- moves the pointer), authored 'human' — provenance stays honest, and the
-- previous version remains one click away. A transcript edit keeps the
-- line's identity, stamps edited_at/edited_by (the SPEC's corrected-line
-- rule) and CLEARS the words array — a human types prose, not word
-- timings, and D15's demote trigger downgrades the part's timing flag
-- exactly as designed for corrections.
--
-- WHO may edit is the 0077 hierarchy, restated inside each definer door
-- (a definer function sees everything and must decide for itself): your
-- own record, or one whose owner your role strictly outranks. Same
-- one-message refusal as soft_delete_call — not probeable.

create function echo.edit_summary(p_call uuid, p_body text)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_actor uuid := echo.actor_id();
  v_owner uuid;
  v_org   uuid;
  v_next  integer;
begin
  if length(btrim(coalesce(p_body, ''))) < 1 or length(p_body) > 50000 then
    raise exception 'summary body must be 1 to 50000 characters'
      using errcode = 'check_violation';
  end if;

  select c.owner_id, c.org_id into v_owner, v_org
  from echo.call c
  where c.id = p_call
    and c.deleted_at is null
    and c.org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (c.owner_id = v_actor or c.scope = 'org' or echo.actor_is_admin());

  if not found
     or (v_owner is distinct from v_actor and not echo.actor_outranks(v_owner)) then
    raise exception 'no such call, or not yours to edit'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(max(s.version), 0) + 1 into v_next
  from echo.summary s where s.call_id = p_call;

  insert into echo.summary (call_id, org_id, version, body, model, created_by)
  values (p_call, v_org, v_next, p_body, 'human', v_actor);

  return v_next;
end;
$$;

comment on function echo.edit_summary(uuid, text) is
  'A human''s summary edit = a new version authored ''human'' (0092). Authority is the 0077 hierarchy; the 0008 trigger moves the current pointer.';

create function echo.edit_transcript_segment(p_segment uuid, p_text text)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_actor uuid := echo.actor_id();
  v_owner uuid;
begin
  if length(btrim(coalesce(p_text, ''))) < 1 or length(p_text) > 10000 then
    raise exception 'segment text must be 1 to 10000 characters'
      using errcode = 'check_violation';
  end if;

  select c.owner_id into v_owner
  from echo.transcript_segment s
  join echo.call c on c.id = s.call_id
  where s.id = p_segment
    and c.deleted_at is null
    and c.org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (c.owner_id = v_actor or c.scope = 'org' or echo.actor_is_admin());

  if not found
     or (v_owner is distinct from v_actor and not echo.actor_outranks(v_owner)) then
    raise exception 'no such segment, or not yours to edit'
      using errcode = 'insufficient_privilege';
  end if;

  -- prose replaces the line; word timings cannot survive a text they no
  -- longer describe (M20/D15 — the demote trigger fires on the blanking)
  update echo.transcript_segment
     set text = p_text,
         words = '[]'::jsonb,
         edited_at = now(),
         edited_by = v_actor
   where id = p_segment;
  return true;
end;
$$;

comment on function echo.edit_transcript_segment(uuid, text) is
  'A human''s transcript correction (0092): text replaced, words cleared (D15 demotes the part flag), edited_at/edited_by stamped. Authority is the 0077 hierarchy.';

revoke all on function echo.edit_summary(uuid, text) from public;
revoke all on function echo.edit_transcript_segment(uuid, text) from public;
grant execute on function echo.edit_summary(uuid, text) to echo_app;
grant execute on function echo.edit_transcript_segment(uuid, text) to echo_app;
