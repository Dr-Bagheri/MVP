-- Echo — 0033: say the right thing when refusing a non-owner.
--
-- The guard's message has read "only the owner may modify a call; others may
-- archive, delete or restore it" since 0011. The api session read it as saying
-- a non-owner member could do all three, then found that a non-admin could do
-- exactly one — and reported the gap. The message meant "an admin", and it no
-- longer describes the mechanism either: since 0032 neither delete nor restore
-- is an UPDATE at all.
--
-- A refusal message is documentation that arrives at the worst possible
-- moment, when someone is already confused about why they were refused. It
-- should name the door rather than describe the room.

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

  if from_app and new.deleted_at is distinct from old.deleted_at then
    raise exception
      'deletion is not an update: use echo.soft_delete_call() or echo.restore_call()'
      using errcode = 'insufficient_privilege';
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
      raise exception
        'only the owner may modify a call; an admin may archive it, and may delete or restore it through echo.soft_delete_call() / echo.restore_call()'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

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
