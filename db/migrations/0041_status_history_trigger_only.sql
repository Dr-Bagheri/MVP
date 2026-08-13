-- Echo — 0041: let the trigger write history without letting the api write it.
--
-- 0040 revoked EXECUTE on record_status_change from everyone, which stopped
-- the api from authoring trends and also stopped the trigger from recording
-- them: the guard is SECURITY INVOKER, so it calls the helper AS the caller,
-- and the caller had no grant. Every status change failed.
--
-- The obvious fixes are both wrong:
--   * grant EXECUTE to echo_app — then the api can call it directly and
--     fabricate any history it likes, which is the one property this table
--     exists to have;
--   * make the guard SECURITY DEFINER — then current_user inside it becomes
--     the owner, `from_app` goes false, and the entire authorization block
--     stops applying to application connections. The history would be perfect
--     and the wall would be gone.
--
-- So: grant the EXECUTE, and make the function refuse to be called except
-- from inside a trigger. pg_trigger_depth() is zero for a direct call and
-- non-zero under a trigger, which is exactly the distinction needed — the
-- capability is available to the path that must have it and to no other.

create or replace function echo.record_status_change(
  p_user uuid, p_org uuid, p_old echo.user_status, p_new echo.user_status, p_by uuid
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if pg_trigger_depth() = 0 then
    raise exception 'status history is written by the app_user trigger, not by callers'
      using errcode = 'insufficient_privilege';
  end if;

  insert into echo.user_status_history (app_user_id, org_id, old_status, new_status, changed_by)
  values (p_user, p_org, p_old, p_new, p_by);
end;
$$;

grant execute on function echo.record_status_change(uuid, uuid, echo.user_status, echo.user_status, uuid)
  to echo_app;
