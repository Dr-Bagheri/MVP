-- Echo — 0024: failure_reason means failure.
--
-- The companion guard held back from 0023 until the worker's write had moved.
-- Backend 2 has confirmed it: failure_reason now appears only in failCall
-- (which sets status = 'failed' in the same statement) and in markPartMissing,
-- which is call_part.failure_reason and untouched by a call-level check.
--
-- With 0023's summary_skipped_reason carrying the honest version, a
-- failure_reason on a non-failed call has no remaining legitimate meaning.

-- ---------------------------------------------------------------------------
-- The resume path, handled before it can bite.
--
-- M7: a failed call is visibly failed AND resumable. Resuming moves status
-- away from 'failed' — and if the reason were left behind, the constraint
-- below would reject the resume itself, turning a recovery path into an error.
-- So the reason is cleared where it stops being true, by the same principle as
-- 0023's skip reason: the data drops its own stale claim rather than the
-- worker remembering to.
--
-- Keeping a history of past failures is an audit question, not a column on the
-- live row; agent_run and the admin action log are where history lives.
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

  -- Leaving 'failed' means the reason no longer describes the call.
  if old.status = 'failed' and new.status is distinct from old.status then
    new.failure_reason := null;
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

alter table echo.call
  add constraint call_failure_reason_means_failed
  check (failure_reason is null or status = 'failed');

comment on constraint call_failure_reason_means_failed on echo.call is
  'A reason for failure only exists while the call is failed. A finished-without-a-summary call uses summary_skipped_reason (0023).';
