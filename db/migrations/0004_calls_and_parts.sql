-- Echo — 0004: calls and their 30-minute parts (M7).
--
-- A session longer than 30 minutes auto-splits. Each part is its own audio
-- file and its own row in the per-part DAG, but all parts belong to ONE call
-- with ONE title and a continuous timeline. Nothing downstream ever has to
-- reason about "which recording" — only about offsets.

create table echo.call (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references echo.org(id),
  owner_id      uuid not null references echo.app_user(id),
  title         text not null default '',
  scope         echo.call_scope  not null default 'private',
  status        echo.call_status not null default 'recording',
  source        echo.call_source not null default 'web',
  language      text not null default 'fa',

  started_at    timestamptz not null default now(),
  -- Total across all parts, maintained by the worker as parts land.
  duration_ms   integer check (duration_ms is null or duration_ms >= 0),

  archived_at   timestamptz,

  -- Soft delete with a 30-day purge window (M11). deleted_at is the moment a
  -- human deleted it; purge_after is set by trigger (0011) and is what the
  -- purge job — and only the purge job — may act on.
  deleted_at    timestamptz,
  deleted_by    uuid references echo.app_user(id),
  purge_after   timestamptz,

  failure_reason text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint call_id_org_key unique (id, org_id),
  -- Structural: a call's owner is always a member of the call's org.
  constraint call_owner_same_org
    foreign key (owner_id, org_id) references echo.app_user (id, org_id),
  -- The three delete columns move together, or not at all.
  constraint call_delete_consistent
    check (num_nonnulls(deleted_at, deleted_by, purge_after) in (0, 3))
);

create index call_org_owner_idx   on echo.call (org_id, owner_id);
create index call_org_scope_idx   on echo.call (org_id, scope) where deleted_at is null;
create index call_org_started_idx on echo.call (org_id, started_at desc) where deleted_at is null;
create index call_status_idx      on echo.call (status) where status <> 'ready';
-- The purge job's only index: expired soft-deletes.
create index call_purge_idx       on echo.call (purge_after) where deleted_at is not null;

create trigger call_set_updated_at
  before update on echo.call
  for each row execute function echo.tg_set_updated_at();

comment on table echo.call is
  'One recording session. Owner + scope decide who may read it (SPEC: two roles, two scopes).';
comment on column echo.call.status is
  'The pipeline position itself (M7) — there is no separate done flag. Steps are idempotent against their artifacts.';

-- ---------------------------------------------------------------------------
-- call_part — one ≤30-minute audio file, one row, one journey through the
-- per-part DAG: upload → transcode → vad → transcribe → diarize.
-- ---------------------------------------------------------------------------

create table echo.call_part (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid not null references echo.call(id),
  org_id         uuid not null references echo.org(id),

  idx            integer not null check (idx >= 0),
  -- Where this part begins on the call's continuous timeline. Every
  -- transcript timestamp downstream is absolute, computed from this.
  offset_ms      integer not null check (offset_ms >= 0),
  duration_ms    integer check (duration_ms is null or duration_ms >= 0),

  storage_bucket text not null default 'call-audio',
  storage_path   text,
  audio_format   text,
  byte_size      bigint check (byte_size is null or byte_size >= 0),
  -- Lets a step recognise its own artifact after a retry instead of trusting
  -- a flag (M7: idempotent against the artifact).
  audio_sha256   text,

  status         echo.part_status not null default 'pending',
  attempts       integer not null default 0 check (attempts >= 0),
  failure_reason text,
  -- Echo Mobile lesson: a part we can never recover degrades the call to a
  -- visible gap; it does not fail the whole call.
  missing        boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint call_part_id_org_key unique (id, org_id),
  constraint call_part_call_idx_key unique (call_id, idx),
  constraint call_part_same_org
    foreign key (call_id, org_id) references echo.call (id, org_id),
  -- The 30-minute rule, with encoder slack. A longer part means the splitter
  -- is broken and we want to know at write time, not at playback.
  constraint call_part_max_length
    check (duration_ms is null or duration_ms <= 1860000)
);

create index call_part_call_idx on echo.call_part (call_id, idx);
create index call_part_work_idx on echo.call_part (status) where status <> 'diarized';

create trigger call_part_set_updated_at
  before update on echo.call_part
  for each row execute function echo.tg_set_updated_at();
