-- NeurAI Platform — 0096: the directory grows up (user directive,
-- 2026-08-25) — merge duplicates, group by team, and improve a voiceprint
-- with a second sample instead of replacing it.
--
-- ── 1. MERGE, at last ───────────────────────────────────────────────────
-- 0005 designed the merge and nothing ever performed it: `merged_into`,
-- `merged_at`, `merged_by` have sat there since the first schema, with a
-- consistency CHECK and two indexes, and no writer. The "designed but
-- never scheduled" shape the casebook keeps finding — a producer with no
-- consumer, invisible to whoever owns the producer.
--
-- The shape 0005 chose is kept exactly: the loser KEEPS ITS ID and points
-- at the winner, so nothing that referenced it breaks. What this door adds
-- is the cross-table half — every call_speaker that pointed at the loser
-- now points at the winner, with the merge's actor stamped as the linker —
-- and that is precisely why it is a DEFINER DOOR rather than a grant: the
-- 0093 trigger requires call ownership to move a speaker's person link,
-- and a merge crosses records the admin does not own by definition.
--
-- The winner's voiceprint is preserved; the loser's is dropped with it
-- (two prints for one person is how a match becomes ambiguous). If the
-- winner has none and the loser does, the loser's is INHERITED — the
-- consent it represents was given by the same human.
--
-- ── 2. TEAMS ────────────────────────────────────────────────────────────
-- `person.team` — a free-text department/team label (org-scoped, bounded).
-- Free text, not an enum: an org's teams are its own vocabulary, and a
-- migration per department name would be absurd.
--
-- ── 3. VOICEPRINT SAMPLES ───────────────────────────────────────────────
-- `person.voiceprint_samples` — how many clips are averaged into the
-- stored vector. Speaker embeddings average well (a centroid is the
-- standard multi-sample representation), so a second enrolment IMPROVES
-- the print instead of discarding what came before. NULL/absent = the
-- pre-0096 single-sample world; the column defaults to 1 for every print
-- that already exists, which is the truth about them.

begin;

alter table echo.person
  add column team text
  check (team is null or char_length(btrim(team)) between 1 and 60);
comment on column echo.person.team is
  'Free-text team/department label (0096) — the org''s own vocabulary, never an enum.';

alter table echo.person
  add column voiceprint_samples int
  check (voiceprint_samples is null or voiceprint_samples between 1 and 50);
comment on column echo.person.voiceprint_samples is
  'How many enrolment clips are averaged into voiceprint (0096). NULL when there is no print; 1 for prints enrolled before this migration.';

update echo.person set voiceprint_samples = 1 where voiceprint is not null;

-- the count and the print live and die together, like the other four
alter table echo.person
  add constraint person_voiceprint_samples_whole
  check ((voiceprint is null) = (voiceprint_samples is null));

create function echo.merge_person(p_loser uuid, p_winner uuid)
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
  -- cross-org and non-existent are ONE answer (the broker discipline)
  select org_id into v_org from echo.person
   where id = p_loser and org_id = echo.actor_org_id() and merged_into is null;
  select org_id into v_winner_org from echo.person
   where id = p_winner and org_id = echo.actor_org_id() and merged_into is null;
  if v_org is null or v_winner_org is null then
    raise exception 'no such person' using errcode = 'P0002';
  end if;

  -- the winner inherits a print only if it has none of its own
  update echo.person w
     set voiceprint = l.voiceprint,
         voiceprint_model = l.voiceprint_model,
         voiceprint_at = l.voiceprint_at,
         voiceprint_by = l.voiceprint_by,
         voiceprint_samples = l.voiceprint_samples
    from echo.person l
   where w.id = p_winner and l.id = p_loser
     and w.voiceprint is null and l.voiceprint is not null;

  -- every voice that pointed at the loser now points at the winner; the
  -- link's provenance becomes this merge, performed by this actor
  update echo.call_speaker
     set person_id = p_winner, linked_by = echo.actor_id(), linked_at = now()
   where person_id = p_loser and org_id = v_org;

  -- anyone previously merged INTO the loser follows the chain forward, so
  -- merged_into is always one hop from a live person (never a chain)
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

grant execute on function echo.merge_person(uuid, uuid) to echo_app;
revoke all on function echo.merge_person(uuid, uuid) from public;

comment on function echo.merge_person(uuid, uuid) is
  'D8 door (0096): admin/owner-only merge of two directory people. The loser keeps its id and points at the winner (0005''s design, finally performed); its call_speaker links move to the winner, which is why this is a door — 0093 requires call ownership to move a link, and a merge crosses records the admin does not own.';

commit;
