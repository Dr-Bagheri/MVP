-- Echo — 0008: versioned summaries.
--
-- "A new one never destroys the old" (SPEC). Replacing a summary adds a
-- version; the pointer moves.
--
-- The pointer is a column on echo.call, as dispatched — but the agent is
-- never the one who moves it. If replacing a summary required the agent to
-- hold UPDATE on echo.call, that same grant would let it change a call's
-- scope or set deleted_at, and the grant wall (M3) would have a hole in the
-- shape of a feature. So the pointer is maintained by a SECURITY DEFINER
-- trigger: the agent inserts a version and the database moves the pointer
-- on its behalf. Nobody needs a grant on echo.call, and the pointer cannot
-- be aimed at a summary belonging to a different call.

create table echo.summary (
  id           uuid primary key default gen_random_uuid(),
  call_id      uuid not null references echo.call(id),
  org_id       uuid not null references echo.org(id),

  version      integer not null check (version >= 1),
  body         text not null,

  -- Provenance (invariant 4): what produced this version. Not backfillable —
  -- 0011 makes summaries immutable once written.
  model        text not null,
  skill_id     uuid references echo.skill(id),
  agent_run_id uuid references echo.agent_run(id),
  -- The person the agent ran as — the call's owner for pipeline summaries.
  created_by   uuid not null references echo.app_user(id),
  created_at   timestamptz not null default now(),

  search       tsvector generated always as
                 (to_tsvector('simple', echo.fa_fold(body))) stored,

  constraint summary_call_version_key unique (call_id, version),
  constraint summary_same_org
    foreign key (call_id, org_id) references echo.call (id, org_id),
  constraint summary_author_same_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id)
);

create index summary_call_idx    on echo.summary (call_id, version desc);
create index summary_search_idx  on echo.summary using gin (search);
create index summary_org_idx     on echo.summary (org_id, created_at desc);

-- The pointer, derived.
--
-- security_invoker is not optional here. A Postgres view runs with its
-- OWNER's privileges by default, and the owner of this one is the migration
-- role — which bypasses RLS. Without this option the view would be a hole
-- straight through the wall for every caller. A view is a convenience, never
-- a way around the wall. (Requires PG15+; Supabase is PG15+.)
create view echo.call_current_summary with (security_invoker = true) as
  select distinct on (s.call_id)
         s.id, s.call_id, s.org_id, s.version, s.body,
         s.model, s.skill_id, s.agent_run_id, s.created_by, s.created_at
  from echo.summary s
  order by s.call_id, s.version desc;

comment on view echo.call_current_summary is
  'Current summary per call = highest version. Agrees with echo.call.current_summary_id by construction; the view is what search and listing read.';

-- ---------------------------------------------------------------------------
-- The pointer itself.
--
-- ON DELETE SET NULL so the purge job can remove summaries without needing
-- UPDATE on echo.call: referential actions run as the table owner, not as the
-- caller, so echo_purge never touches a call row directly either.
-- ---------------------------------------------------------------------------

alter table echo.call
  add column current_summary_id uuid references echo.summary(id) on delete set null;

create index call_current_summary_idx on echo.call (current_summary_id);

create function echo.tg_summary_move_pointer() returns trigger
  language plpgsql
  security definer          -- the caller has no grant on echo.call, by design
  set search_path = ''
as $$
begin
  update echo.call c
     set current_summary_id = new.id
   where c.id = new.call_id
     -- Only ever forward. A late-arriving insert of an older version (a
     -- replay, a repair) must not drag the pointer backwards.
     and (c.current_summary_id is null
          or new.version >= (select s.version from echo.summary s
                              where s.id = c.current_summary_id));
  return null;
end;
$$;

create trigger summary_move_pointer
  after insert on echo.summary
  for each row execute function echo.tg_summary_move_pointer();

comment on column echo.call.current_summary_id is
  'Moved by trigger on summary insert, never by the caller — so replacing a summary needs no grant on echo.call (M3).';
