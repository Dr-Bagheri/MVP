-- 0207 — a voiceprint keeps its TAKES, not just their average.
--
-- User directive, 2026-09-07: "make the enrollment more powerful, check the
-- latest state of the art tech now for these."
--
-- ── WHAT WAS MEASURED ─────────────────────────────────────────────────────
--
-- One person, one day, one enrolled print: 0.79 against a microphone
-- recording and 0.34 against an online one, with a DIFFERENT person scoring
-- 0.38 on that same online clip. The model change that lands beside this
-- migration is the larger half of the answer; this column is the other half,
-- and it is a correction to how 0096 aggregates.
--
-- 0096 chose a running centroid — "speaker embeddings average well (a
-- centroid is the standard multi-sample representation)" — and that is true
-- of samples from ONE condition. It is exactly wrong across conditions: the
-- mean of a headset take and a laptop-speaker take is a point that is neither,
-- and it scores worse against both than either would have on its own. The
-- literature's own answer to multi-condition enrolment is to keep the takes
-- and score the trial against the BEST of them (max-over-enrolment), which
-- costs one cosine per take and cannot be worse than the centroid.
--
-- Two more things the centroid got wrong, both invisible while it was the
-- only representation:
--   · it averaged RAW vectors, so a longer or louder clip — a bigger norm —
--     pulled the print toward itself. The takes are stored raw and the
--     centroid is now the mean of the L2-NORMALISED takes, which is what
--     "average of directions" means when only direction is compared.
--   · a person could never improve a print by re-recording in the room they
--     actually sit in; they could only blur it.
--
-- ── SHAPE ─────────────────────────────────────────────────────────────────
--
-- A column, not a table. A take has no lifetime of its own, no policies of
-- its own, and no reader that is not already reading the person row; as a
-- table it would need a policy pair, a grant, a purge-delete entry and a
-- DELETE allow-list argument — four places to get wrong for a value that
-- lives and dies with `person.voiceprint`. Postgres enforces that every row
-- of a 2-D array has the same length, which is exactly the invariant a list
-- of same-model embeddings needs.
--
-- `voiceprint` stays, DERIVED from the takes: it is what a caller with no
-- interest in takes reads, and there is one writer for both, at one moment.
-- Prints enrolled before this migration have no takes and are unaffected —
-- they keep their old centroid and their old model name, and the model change
-- retires them the way a model change is supposed to.

begin;

alter table echo.person
  add column voiceprint_takes float8[][];

comment on column echo.person.voiceprint_takes is
  'The individual enrolment embeddings behind voiceprint (0207) — matching scores the BEST take, because the mean of two recording conditions is neither of them. NULL for prints enrolled before 0207. voiceprint is their L2-normalised centroid.';

-- takes without a print would be a voice nothing can match, and a print is
-- what consent looks like in this product
alter table echo.person
  add constraint person_voiceprint_takes_need_a_print
  check (voiceprint_takes is null or voiceprint is not null);

-- the count is not a second opinion: where takes exist, voiceprint_samples
-- IS how many there are. Two spellings of one number is how a directory comes
-- to say "3 samples" about a print built from one.
alter table echo.person
  add constraint person_voiceprint_takes_counted
  check (
    voiceprint_takes is null
    or voiceprint_samples = array_length(voiceprint_takes, 1)
  );

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_org  uuid;
  v_by   uuid;
  v_id   uuid;
  v_dim  int;
begin
  -- a fixture of our own, unwound at the end: the checks must not depend on
  -- whatever this database happens to hold (rule 9's self-seeding half)
  select id into v_org from echo.org order by created_at limit 1;
  if v_org is null then
    raise notice '0207: no org on this database — structural checks only';
  else
    select id into v_by from echo.app_user where org_id = v_org limit 1;
    insert into echo.person (org_id, display_name, created_by)
      values (v_org, '0207 fixture', v_by) returning id into v_id;

    -- 1. TAKES REQUIRE A PRINT
    begin
      update echo.person set voiceprint_takes = array[array[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]] where id = v_id;
      raise exception '0207: takes were accepted with no voiceprint';
    exception when check_violation then null;
    end;

    -- 2. THE COUNT MUST AGREE WITH THE TAKES
    begin
      update echo.person
         set voiceprint = array[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0], voiceprint_model = 'test',
             voiceprint_at = now(), voiceprint_by = v_by,
             voiceprint_samples = 5,
             voiceprint_takes = array[array[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0], array[8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0]]
       where id = v_id;
      raise exception '0207: a count of 5 was accepted over 2 takes';
    exception when check_violation then null;
    end;

    -- 3. AND THE ORDINARY PATH WORKS — without this the two refusals above
    --    are equally satisfied by a constraint that rejects everything
    update echo.person
       set voiceprint = array[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0], voiceprint_model = 'test',
           voiceprint_at = now(), voiceprint_by = v_by,
           voiceprint_samples = 2,
           voiceprint_takes = array[array[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0], array[8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0]]
     where id = v_id;
    select array_length(voiceprint_takes, 2) into v_dim from echo.person where id = v_id;
    if v_dim is distinct from 8 then
      raise exception '0207: stored takes do not read back as 8-wide (got %)', v_dim;
    end if;

    -- 4. RAGGED TAKES ARE UNREPRESENTABLE — the property that makes a column
    --    the right shape for this. Postgres refuses the literal itself.
    begin
      update echo.person
         set voiceprint_takes = array[array[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0], array[3.0]]
       where id = v_id;
      raise exception '0207: a ragged take array was accepted';
    exception when array_subscript_error or invalid_text_representation or data_exception then null;
    end;

    raise exception 'SELFCHECK_ROLLBACK_0207';
  end if;
exception
  when raise_exception then
    if sqlerrm <> 'SELFCHECK_ROLLBACK_0207' then raise; end if;
end
$check$;

commit;
