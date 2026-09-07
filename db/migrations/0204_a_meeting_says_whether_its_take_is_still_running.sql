-- 0204 — a meeting can say whether its take is still running (user report,
-- 2026-09-07: "when the meeting is recording and you are the host if you
-- refresh the page it closes the recording and send it to the after meeting
-- stage, it should do that only after you press finish").
--
-- ── the one wrong idea, in three places ─────────────────────────────────
--
-- `meeting.call_id` was being read as "this meeting is over". It is not: the
-- recorder links the id the MOMENT the call exists, deliberately, so that a
-- dying tab still leaves the meeting pointing at its partial record (0145's
-- own reasoning, and it is still right). So `call_id` means "a take has been
-- STARTED", and every screen that read it as "finished" was wrong from the
-- first second of every recording:
--
--   · the host reloads mid-take and the page opens on «پس از جلسه», with
--     the live stage sealed behind them — the reported bug;
--   · a colleague sitting in the live stage is moved to the record the
--     instant the host presses start, which is the exact opposite of the
--     directive that poll was built for ("after it finishes the session
--     should be closed for all", 2026-09-06);
--   · the earlier steps seal while the meeting is still being held.
--
-- The fact that means "finished" is the CALL leaving `recording`, which is
-- what `finishCall` writes and nothing else does.
--
-- ── why this needs a door rather than a join ────────────────────────────
--
-- core's meeting query already carries `left join echo.call c on c.id =
-- m.call_id` and publishes `c.title`. Under RLS that join returns nothing to
-- an ordinary attendee: a call is `private` by default (0004), and call_read
-- admits the owner, an org-scoped call, or an admin. So the status read
-- through that join answers the HOST and nobody else — and "the session
-- closes for all" is a promise to everybody in the room.
--
-- Hence one narrow door. What it hands back is a SHAPE, not a filter someone
-- has to remember: a single word from `echo.call_status`, about a call whose
-- id the meeting already publishes to the same readers. It cannot return a
-- title, an owner, a duration or the existence of any other call, and it
-- answers only for a meeting the caller could already read — the meeting_read
-- terms restated here, because a definer function sees everything and must
-- therefore decide for itself (0077's own sentence, and the reason to write
-- it out rather than trust the caller's context).

begin;

create function echo.meeting_take_status(p_meeting uuid) returns text
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_status text;
begin
  -- meeting_read's terms (0145), restated: same org, active actor.
  select c.status::text into v_status
    from echo.meeting m
    join echo.call c on c.id = m.call_id
   where m.id = p_meeting
     and m.org_id = echo.actor_org_id()
     and echo.actor_is_active()
     and c.deleted_at is null;

  -- NULL is one answer with three honest readings, and the CALLER can tell
  -- them apart from the meeting row it already holds: no linked call
  -- (call_id is null), a linked call that has been purged or deleted
  -- (call_id set, status null), or a meeting this actor may not read at all
  -- (they would not have the row either). It never means "still recording".
  return v_status;
end;
$$;

comment on function echo.meeting_take_status(uuid) is
  'The status of the call a meeting is linked to, or NULL. The one bit a meeting reader needs that call_read will not give them: whether the take is still being made. Deliberately narrow — one word from echo.call_status, for a meeting they can already read.';

grant execute on function echo.meeting_take_status(uuid) to echo_app;
-- the agents read echo.meeting (0176) through the same query, and a missing
-- EXECUTE here would be a 42501 on every agent meeting read rather than a
-- missing column
grant execute on function echo.meeting_take_status(uuid) to echo_agent;

-- ── self-checks ────────────────────────────────────────────────────────────
do $check$
declare
  v_acl     aclitem[];
  v_prov    text;
  v_answer  text;
  v_subject uuid;
begin
  select p.proconfig[1], p.proacl into v_prov, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'meeting_take_status';
  if v_prov is null then
    raise exception '0204: meeting_take_status is missing or has no search_path';
  end if;
  -- Postgres stores the empty path as search_path="" (quoted) — the first
  -- draft of this check demanded the bare form and refused its own correct
  -- function. Both spellings mean the same empty path; anything else does not.
  if v_prov not in ('search_path=', 'search_path=""') then
    raise exception '0204: search_path is % — a definer body resolves at EXECUTION, so every name in it must be qualified against an empty path', v_prov;
  end if;
  if not (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'echo' and p.proname = 'meeting_take_status') then
    raise exception '0204: meeting_take_status is not SECURITY DEFINER — it would answer nothing for the colleague it exists for';
  end if;

  -- pg_proc.proacl, not information_schema: the catalogue VIEWS are
  -- permission-filtered and will report "(none)" for a grant that exists
  -- (rule 11's catalog instance, 2026-08-13).
  if v_acl is null or not (array_to_string(v_acl, ',') like '%echo_app=X%') then
    raise exception '0204: echo_app cannot execute meeting_take_status';
  end if;
  if not (array_to_string(v_acl, ',') like '%echo_agent=X%') then
    raise exception '0204: echo_agent cannot execute meeting_take_status';
  end if;

  -- Behaviour, on a subject that must EXIST before its answer means
  -- anything: with no actor there is no org and no active member, so a real
  -- linked meeting has to come back NULL. Where this database holds no such
  -- meeting the check says so out loud rather than passing — "did not run,
  -- result unknown" beats a question that could only ever have been
  -- answered yes. The full matrix is db/test/116, which seeds its own.
  perform set_config('echo.actor_id', '', true);
  select m.id into v_subject from echo.meeting m
   where m.call_id is not null limit 1;
  if v_subject is null then
    raise notice '0204: no linked meeting on this database — the no-actor case DID NOT RUN here; db/test/116 asserts it against seeded rows';
  else
    v_answer := echo.meeting_take_status(v_subject);
    if v_answer is not null then
      raise exception '0204: it answered % for a real meeting with no actor set — the door is open', v_answer;
    end if;
  end if;
end
$check$;

commit;
