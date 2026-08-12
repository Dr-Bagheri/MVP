-- Echo — 0023: why there is no summary, without calling it a failure.
--
-- M5's ladder has a terminal rung: when no model resolves, the summarize step
-- completes the call and records why, rather than failing it. Until now that
-- reason landed in call.failure_reason on a `ready` row — a lie in the
-- opposite direction to the one we usually worry about. The call did not fail;
-- it finished without a summary, which is visible and retryable.

alter table echo.call
  add column summary_skipped_reason text;

comment on column echo.call.summary_skipped_reason is
  'Why the summarize step completed without writing one (M5 amendment). A skipped summary is not a failed call — failure_reason stays for failures.';

-- ---------------------------------------------------------------------------
-- The claim cannot outlive the condition it describes.
--
-- A call that HAS a summary is not a call whose summary was skipped, so the
-- two must never be true at once. This is the same shape as D15's word-timing
-- flag: rather than trusting the worker to remember to clear an excuse, the
-- data clears it at the moment it stops being true, and a constraint makes
-- that provable instead of merely intended.
-- ---------------------------------------------------------------------------

alter table echo.call
  add constraint call_skip_reason_excludes_summary
  check (current_summary_id is null or summary_skipped_reason is null);

-- The pointer move already fires at exactly the right moment — a summary has
-- just landed for this call — so the clearing belongs here rather than in a
-- step the worker has to remember. Note the reason is cleared whenever ANY
-- version arrives, not only when the pointer advances: a late-arriving older
-- version still means a summary exists, and the excuse is still false.
create or replace function echo.tg_summary_move_pointer() returns trigger
  language plpgsql
  security definer          -- the caller has no grant on echo.call, by design
  set search_path = ''
as $$
begin
  update echo.call c
     set current_summary_id =
           case
             when c.current_summary_id is null then new.id
             when new.version >= (select s.version from echo.summary s
                                   where s.id = c.current_summary_id) then new.id
             -- Only ever forward: a replay or repair writing an older version
             -- must not drag the pointer backwards.
             else c.current_summary_id
           end,
         summary_skipped_reason = null
   where c.id = new.call_id;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Which version is presented, and why one is missing, are both part of the
-- record — so under Q4 as ratified, a non-owner may not write either.
-- ---------------------------------------------------------------------------

create or replace function echo.tg_call_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if new.org_id is distinct from old.org_id or new.owner_id is distinct from old.owner_id then
    raise exception 'a call cannot change org or owner'
      using errcode = 'check_violation';
  end if;

  if new.current_summary_id is distinct from old.current_summary_id
     and new.current_summary_id is not null
     and not exists (
       select 1 from echo.summary s
       where s.id = new.current_summary_id and s.call_id = new.id
     ) then
    raise exception 'a call''s current summary must be one of its own versions'
      using errcode = 'check_violation';
  end if;

  if from_app and old.owner_id is distinct from actor then
    if new.title          is distinct from old.title
    or new.scope          is distinct from old.scope
    or new.language       is distinct from old.language
    or new.source         is distinct from old.source
    or new.started_at     is distinct from old.started_at
    or new.status         is distinct from old.status
    or new.duration_ms    is distinct from old.duration_ms
    or new.failure_reason is distinct from old.failure_reason
    or new.current_summary_id is distinct from old.current_summary_id
    or new.summary_skipped_reason is distinct from old.summary_skipped_reason then
      raise exception 'only the owner may modify a call; others may archive, delete or restore it'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at  := now();
    new.deleted_by  := actor;
    new.purge_after := now() + echo.purge_window();
  elsif new.deleted_at is null and old.deleted_at is not null then
    new.deleted_by  := null;
    new.purge_after := null;
  elsif new.deleted_at is not null then
    new.deleted_at  := old.deleted_at;
    new.deleted_by  := old.deleted_by;
    new.purge_after := old.purge_after;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- NOT done here, deliberately: the companion guard that `failure_reason`
-- means failure — i.e. check (failure_reason is null or status = 'failed').
--
-- The worker currently writes the skip reason into failure_reason on a ready
-- row, which is the very thing this migration exists to replace. Adding that
-- constraint now would break a running consumer mid-flight, which is the same
-- mistake as dropping a queue out from under one. It lands once Backend 2
-- confirms the write has moved.
-- ---------------------------------------------------------------------------
