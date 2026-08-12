-- Echo — 0005: voices, and the org's speaker directory.
--
-- Two levels, deliberately separate:
--   call_speaker — a voice inside one recording ("Speaker 1"), produced by
--                  diarization or by the channel it arrived on.
--   person       — an entry in the org's shared directory. Name a voice once
--                  and the name follows it across calls.
--
-- M11 (privacy): a voice from a private call does NOT enter the org directory
-- on its own. The directory is built from deliberate acts — the owner linking
-- a voice — never from passive capture. That rule is enforced in 0011/0012,
-- not by convention.

create table echo.person (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references echo.org(id),
  display_name text not null check (length(btrim(display_name)) > 0),
  -- Optional tie to a member of the org; a person in the directory may also
  -- be an outsider (a customer on the other end of the call).
  app_user_id  uuid,
  notes        text,

  -- Duplicate merge (SPEC): the loser keeps its id and points at the winner,
  -- so nothing that referenced it breaks.
  merged_into  uuid references echo.person(id),
  merged_at    timestamptz,
  merged_by    uuid references echo.app_user(id),

  created_by   uuid not null references echo.app_user(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint person_id_org_key unique (id, org_id),
  constraint person_user_same_org
    foreign key (app_user_id, org_id) references echo.app_user (id, org_id),
  constraint person_merge_consistent
    check (num_nonnulls(merged_into, merged_at, merged_by) in (0, 3)),
  constraint person_no_self_merge check (merged_into is distinct from id)
);

create index person_org_idx        on echo.person (org_id) where merged_into is null;
create index person_merged_idx     on echo.person (merged_into) where merged_into is not null;
create index person_org_name_idx   on echo.person (org_id, echo.fa_fold(display_name));

create trigger person_set_updated_at
  before update on echo.person
  for each row execute function echo.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- call_speaker — one voice within one call, across all its parts. Diarization
-- clusters whole-call (M6), so a speaker is a property of the call, not of a
-- part; link-speakers reconciles parts into these rows.
-- ---------------------------------------------------------------------------

create table echo.call_speaker (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid not null references echo.call(id),
  org_id          uuid not null references echo.org(id),

  label           text not null,          -- 'گوینده ۱' / 'Speaker 1' until named
  -- Set when the audio was two-channel: speakers come from the channels and
  -- no diarization runs (M6).
  channel         smallint check (channel is null or channel between 0 and 15),

  person_id       uuid,
  linked_by       uuid references echo.app_user(id),
  linked_at       timestamptz,

  -- A short snippet for identification, as offsets on the call timeline —
  -- the audio itself is never copied.
  sample_start_ms integer check (sample_start_ms is null or sample_start_ms >= 0),
  sample_end_ms   integer,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint call_speaker_id_org_key unique (id, org_id),
  constraint call_speaker_label_key  unique (call_id, label),
  constraint call_speaker_same_org
    foreign key (call_id, org_id) references echo.call (id, org_id),
  -- A voice can only be linked to a person in the same org.
  constraint call_speaker_person_same_org
    foreign key (person_id, org_id) references echo.person (id, org_id),
  constraint call_speaker_link_consistent
    check (num_nonnulls(person_id, linked_by, linked_at) in (0, 3)),
  constraint call_speaker_sample_ordered
    check (sample_end_ms is null or sample_start_ms is null or sample_end_ms >= sample_start_ms)
);

-- Two-channel audio: one speaker per channel, no duplicates.
create unique index call_speaker_channel_key
  on echo.call_speaker (call_id, channel) where channel is not null;

create index call_speaker_call_idx   on echo.call_speaker (call_id);
create index call_speaker_person_idx on echo.call_speaker (person_id) where person_id is not null;

create trigger call_speaker_set_updated_at
  before update on echo.call_speaker
  for each row execute function echo.tg_set_updated_at();
