-- Echo — 0006: the transcript. Invariant 1 — this is the source of truth;
-- everything else in the database is derived from it and rebuildable.
--
-- One segment per row (M8): it is what makes search, windowed reads and
-- surgical corrections possible. Timestamps are absolute on the call's
-- timeline, so a segment never needs its part to be interpreted.

create table echo.transcript_segment (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid not null references echo.call(id),
  org_id         uuid not null references echo.org(id),
  part_id        uuid references echo.call_part(id),

  seq            integer not null check (seq >= 0),
  start_ms       integer not null check (start_ms >= 0),
  end_ms         integer not null,

  call_speaker_id uuid,
  channel        smallint,

  text           text not null,
  confidence     real check (confidence is null or confidence between 0 and 1),

  -- Word-level timestamps (M6) — required, because clicking a word seeks the
  -- audio and because words are what align to speakers. Shape:
  --   [{"w": "سلام", "s": 1200, "e": 1460, "c": 0.98}, …]  (ms, absolute)
  -- Proportional estimates were a visible quality gap in Echo Mobile; we
  -- carry the real thing or we carry nothing.
  words          jsonb not null default '[]',

  -- Invariant 4: what produced this row. Provider, model, version, revision.
  provenance     jsonb not null default '{}',

  -- A corrected line keeps its identity and is marked as edited (SPEC).
  edited_at      timestamptz,
  edited_by      uuid references echo.app_user(id),

  created_at     timestamptz not null default now(),

  -- Search (M8). The fold is applied by the database so the index and the
  -- query cannot drift apart; core/ still normalizes before insert.
  search         tsvector generated always as
                   (to_tsvector('simple', echo.fa_fold(text))) stored,

  constraint transcript_segment_call_seq_key unique (call_id, seq),
  constraint transcript_segment_same_org
    foreign key (call_id, org_id) references echo.call (id, org_id),
  constraint transcript_segment_part_same_org
    foreign key (part_id, org_id) references echo.call_part (id, org_id),
  constraint transcript_segment_speaker_same_org
    foreign key (call_speaker_id, org_id) references echo.call_speaker (id, org_id),
  constraint transcript_segment_span check (end_ms >= start_ms),
  constraint transcript_segment_words_is_array check (jsonb_typeof(words) = 'array'),
  constraint transcript_segment_edit_consistent
    check (num_nonnulls(edited_at, edited_by) in (0, 2))
);

-- Reading a call, and the agent's windowed reads.
create index transcript_segment_call_seq_idx  on echo.transcript_segment (call_id, seq);
create index transcript_segment_call_time_idx on echo.transcript_segment (call_id, start_ms);
create index transcript_segment_part_idx      on echo.transcript_segment (part_id);
create index transcript_segment_speaker_idx   on echo.transcript_segment (call_speaker_id);
create index transcript_segment_search_idx    on echo.transcript_segment using gin (search);

comment on table echo.transcript_segment is
  'The record. Derived artifacts (summaries, indexes) are rebuildable from these rows; these rows are not rebuildable from anything.';
comment on column echo.transcript_segment.words is
  'Word-level timestamps, absolute ms on the call timeline (M6).';
