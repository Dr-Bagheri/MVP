-- 0235 — a call that stopped moving is found, and driven again.
--
-- THE REPORT (user, 2026-09-19, with the screenshot): "this one stayed in
-- processing, make it somehow that if stayed in this stage it will run it
-- later as well."
--
-- MEASURED FIRST, at owner altitude, before a line of this was written.
-- Two calls on production sit in `processing` and will never leave it:
--
--   8cfb48a6…  2026-09-19 10:20  processing  parts=0  segments=0  meeting=1
--   eb65b407…  2026-09-15 07:17  processing  parts=0  segments=0
--
-- Zero parts, zero transcript segments, and NOTHING in any queue — not live,
-- not archived. A `call_part` row is inserted only after the bytes are in
-- storage and `process_part` is enqueued in the same breath (api/uploads.ts),
-- so zero part rows means no audio ever reached the pipeline. The call was
-- flipped recording→processing with nothing to process, and `partsSettled`
-- requires `parts.length > 0` by design, so no step could ever advance it.
-- It is not failing and not retrying: it is WAITING FOR WORK THAT DOES NOT
-- EXIST, and the screen says «در حال پردازش» over it forever.
--
-- The recording engine already refuses that finish — its own comment reads
-- "no audio ever reached the uploader — finishing would create a call stuck
-- at 'processing' forever". The orphan-finish path on the meeting page
-- (db/0204's reload case) calls `finishCall` directly, outside the engine,
-- with no part count. That door is closed in the api in the same batch as
-- this file; this file is the half that catches every OTHER way a call can
-- stop moving — the lost receipt, the dead letter whose owner could not be
-- resolved, the two-parts-commit race that finishPart's own comment
-- describes, a worker restarted between a status write and its enqueue.
--
-- ── WHY A SWEEPER, WHEN 2026-08-13 RULED AGAINST ONE ────────────────────
-- B3's ruling stands and is not being quietly contradicted. It was about
-- `agent_run` rows stuck at 'running' — "hygiene, not correctness" — and it
-- named its own earns-its-place condition: "when 'runs in progress' becomes
-- a number a person acts on → a named operation, explicit actor, never a
-- silent background writer." Both halves are met here. This is correctness,
-- not hygiene: a customer's meeting is lost and the product claims to be
-- working on it. And the writer is not silent — every decision is logged
-- with the call it was made about, `recovery_at` records on the row itself
-- that the recovery took an interest, and a call that cannot be resumed is
-- marked FAILED with its reason rather than tidied away.
--
-- ── WHAT MAKES "STALLED" A FACT RATHER THAN A GUESS ─────────────────────
-- Age alone is not enough, and the reason is a real cost: a part step may
-- legitimately run for an hour (the 2026-09-06 long-file lane; the five-hour
-- ceiling, the visibility heartbeat). Re-driving a part that is mid-
-- transcription means paying the provider twice for the same audio.
--
-- So the discriminator is the QUEUE, not the clock: pgmq keeps a claimed
-- message's row in `q_<name>` while it is invisible, and removes it only on
-- delete or archive. A call with no row naming it in any pipeline queue has
-- nothing working on it — whatever a step's duration might have been. The
-- age floor stays as well, but only to cover the millisecond window between
-- a status write and its enqueue (steps.ts deliberately keeps those two
-- statements apart, and the sweep must not land inside that gap).
--
-- Both predicates, or neither is sound: age alone re-drives live work, queue
-- alone re-drives the enqueue gap.
--
-- ── WHAT THIS DOES NOT TOUCH, said out loud ─────────────────────────────
-- `recording`. A take that was abandoned mid-flight sits there too (two on
-- production, from 09-06 and 09-07), but deciding that a recording is over
-- is a different question from deciding that a finished one stopped moving —
-- the browser may still hold the take, and failing a live meeting is the
-- worse mistake. The user's report is about `processing`; this stays there.
--
-- An INACTIVE owner's call is excluded at the door rather than returned and
-- skipped: the worker runs every write as the call's owner (M3, invariant 2)
-- and an inactive owner cannot be resolved, so returning the row would burn
-- a claim every quarter of an hour forever and log a refusal nobody can act
-- on. The forfeit is real and is named here: a call owned by a suspended
-- member stays stuck until the membership is restored.

begin;

-- ── the claim's own column ──────────────────────────────────────────────
-- A column, not a table: one timestamp per call, with no lifetime of its
-- own. As a table it would need policies, grants, an entry in the purge's
-- enumerated deletes and a line in the closed DELETE allow-list — four
-- places to get wrong for one value per call (0206's argument, unchanged).
--
-- `updated_at` would almost serve as the compare-and-set, since the trigger
-- bumps it on any write. Almost is the problem: it conflates "somebody
-- touched this row" with "the recovery claimed it", and only the second one
-- may gate a re-drive. This column says exactly one thing.
alter table echo.call add column if not exists recovery_at timestamptz;

comment on column echo.call.recovery_at is
  '0235: when the stall recovery last took an interest in this call. The compare-and-set that stops two workers re-driving one call, and the record on the row that a background writer acted.';

-- ── the discovery door ──────────────────────────────────────────────────
-- 0114's `due_mail_polls` shape: ids and counts only, read by the worker
-- through `withoutIdentity`, and every WRITE that follows runs under the
-- owner's own identity. Reading an envelope is not reading a call.
--
-- The guard is 0130's, one rung up — this is platform-wide, so there is no
-- owner column to key on: the scheduler (no identity) passes, and a caller
-- who HAS an identity must be platform root. Without it, any echo_app caller
-- could enumerate every stalled call on the platform.
create or replace function echo.stalled_calls(
  p_minutes integer default 15,
  p_limit   integer default 20
)
returns table (
  call_id      uuid,
  owner_id     uuid,
  org_id       uuid,
  status       text,
  usable_parts integer,
  bare_parts   integer,
  has_summary  boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if echo.actor_id() is not null and not echo.actor_is_platform_root() then
    raise exception 'stalled_calls is pipeline housekeeping'
      using errcode = '42501';
  end if;
  -- clamp: a caller cannot turn the floor down far enough to race the
  -- enqueue gap that the floor exists to clear
  if p_minutes is null or p_minutes < 5 then
    p_minutes := 5;
  end if;

  return query
  select c.id,
         c.owner_id,
         c.org_id,
         c.status::text,
         -- USABLE: carries audio and has not been written off as a gap
         (select count(*)::integer from echo.call_part p
           where p.call_id = c.id and p.missing = false and p.storage_path is not null),
         -- BARE: usable, and never produced a transcript — the resume point,
         -- read from the ARTIFACT exactly as the retry door reads it
         (select count(*)::integer from echo.call_part p
           where p.call_id = c.id and p.missing = false and p.storage_path is not null
             and not exists (
               select 1 from echo.transcript_segment s where s.part_id = p.id)),
         c.current_summary_id is not null
    from echo.call c
    -- the owner must be resolvable, or nothing may be written at all
    join echo.app_user u on u.id = c.owner_id and u.status = 'active'
   where c.status in ('processing', 'linking', 'summarizing')
     and c.deleted_at is null
     and c.updated_at  < now() - make_interval(mins => p_minutes)
     and (c.recovery_at is null or c.recovery_at < now() - make_interval(mins => p_minutes))
     -- NOTHING IS WORKING ON IT. Compared as text on purpose: a malformed
     -- callId in some future payload would raise 22P02 on a cast and take
     -- the whole sweep down with it.
     and not exists (select 1 from pgmq.q_echo_process_part  q where q.message->>'callId' = c.id::text)
     and not exists (select 1 from pgmq.q_echo_link_speakers q where q.message->>'callId' = c.id::text)
     and not exists (select 1 from pgmq.q_echo_summarize     q where q.message->>'callId' = c.id::text)
   order by c.updated_at asc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

comment on function echo.stalled_calls(integer, integer) is
  '0235 (D8-enumerated): calls that stopped moving — past the per-call phase, older than the floor, and named by no message in any pipeline queue. Ids and counts only; every write that follows runs as the call''s owner. Platform housekeeping: the scheduler (no identity) may read it, an identity-bearing caller must be platform root.';

-- ── the claim ───────────────────────────────────────────────────────────
-- 0111's shape, as 0114 adopted it: the due-predicate under the row lock IS
-- the compare-and-set, so two workers cannot both claim one call and nothing
-- round-trips through the worker to decide it.
create or replace function echo.claim_call_recovery(
  p_call    uuid,
  p_minutes integer default 15
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update echo.call c
     set recovery_at = now()
   where c.id = p_call
     and c.status in ('processing', 'linking', 'summarizing')
     and c.deleted_at is null
     and (c.recovery_at is null
          or c.recovery_at < now() - make_interval(mins => greatest(5, coalesce(p_minutes, 15))))
     and (echo.actor_id() is null or echo.actor_is_platform_root())   -- 0130's rung
  returning true
$$;

comment on function echo.claim_call_recovery(uuid, integer) is
  '0235 (D8-enumerated): exactly-once stall recovery for one call. The predicate is the CAS. Same rung as stalled_calls — the scheduler passes, an identity-bearing caller must be platform root.';

-- PUBLIC holds EXECUTE on a new function by default, and PUBLIC includes
-- echo_agent (0204's lesson, which cost 0205 a migration of its own).
revoke all on function echo.stalled_calls(integer, integer) from public;
revoke all on function echo.claim_call_recovery(uuid, integer) from public;
grant execute on function echo.stalled_calls(integer, integer) to echo_app;
grant execute on function echo.claim_call_recovery(uuid, integer) to echo_app;

-- ── self-checks ─────────────────────────────────────────────────────────
do $check$
declare
  v_def  text;
  v_acl  text;
  v_rows integer;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'echo' and table_name = 'call' and column_name = 'recovery_at')
  then
    raise exception '0235 FAILED: echo.call.recovery_at was not added';
  end if;

  -- both doors are definer, with the empty search_path every door in this
  -- schema carries (0045: a plpgsql body resolves at EXECUTION time).
  --
  -- Matched with LIKE rather than against the literal `search_path=`:
  -- Postgres stores the empty path QUOTED, as `search_path=""`, and 0204's
  -- own self-check refused a correct function for demanding the bare form.
  for v_def in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.proname in ('stalled_calls', 'claim_call_recovery')
       and not (
         p.prosecdef
         and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                      where cfg like 'search\_path=%'))
  loop
    raise exception '0235 FAILED: echo.% is not a definer door with an empty search_path', v_def;
  end loop;

  -- PUBLIC must hold nothing on either, and echo_app must hold EXECUTE.
  -- A NULL proacl does not mean "no grants" — it means the defaults, and the
  -- default is everyone (0204/0205). So the ACL must be present AND exclude
  -- PUBLIC's bare `=`.
  for v_def, v_acl in
    select p.proname, coalesce(array_to_string(p.proacl, ','), '(defaults)')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.proname in ('stalled_calls', 'claim_call_recovery')
  loop
    -- PUBLIC is the entry with an EMPTY grantee, so it is the one that starts
    -- with `=` — at the head of the list or straight after a comma. Matching
    -- `%=X/%` instead would match `echo_app=X/postgres` as well and fire on
    -- every correct grant, which is the false-positive factory this repo
    -- deletes checkers for.
    if v_acl = '(defaults)' or v_acl like '=%' or v_acl like '%,=%' then
      raise exception '0235 FAILED: PUBLIC can execute echo.% (acl %)', v_def, v_acl;
    end if;
    if v_acl not like '%echo\_app=X%' then
      raise exception '0235 FAILED: echo_app cannot execute echo.% (acl %)', v_def, v_acl;
    end if;
  end loop;

  -- THE QUEUE IS THE DISCRIMINATOR, and a version that forgot it would pass
  -- every check above while re-driving live work.
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'stalled_calls';
  if v_def !~ 'q_echo_process_part'
     or v_def !~ 'q_echo_link_speakers'
     or v_def !~ 'q_echo_summarize' then
    raise exception '0235 FAILED: stalled_calls does not ask every pipeline queue whether it is working on the call';
  end if;

  -- the scheduler's own call answers (no identity, no raise) — without this
  -- the refusal below would be equally true of a door that refuses everyone
  perform set_config('echo.actor_id', '', true);
  select count(*) into v_rows from echo.stalled_calls(15, 5);
  raise notice '0235: the scheduler''s read answered with % row(s)', v_rows;

  -- and an identity-bearing caller who is not platform root is refused
  -- (any id that is not a platform operator; it need not name a real row —
  -- actor_is_platform_root answers false for an unknown one just the same)
  perform set_config('echo.actor_id', '00000000-0000-4000-8000-000000000000', true);
  begin
    perform * from echo.stalled_calls(15, 5);
    raise exception '0235 FAILED: a member could enumerate the platform''s stalled calls';
  exception when insufficient_privilege then
    null;  -- the wall
  end;
  perform set_config('echo.actor_id', '', true);
end
$check$;

commit;
