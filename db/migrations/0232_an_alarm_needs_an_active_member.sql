-- 0232 — an alarm belongs to an ACTIVE member.
--
-- Found by 0231's own test file, on its first run, and left visible rather
-- than folded back into 0231 (which is applied and checksummed): the write
-- policy asked `org_id = echo.actor_org_id()` and stopped there, so a PENDING
-- member — somebody who has signed up and whom nobody has let in yet — could
-- insert rows into their own alarm list. `actor_org_id()` answers for a
-- membership that EXISTS; `actor_is_active()` is the one that answers for a
-- membership that is switched on, and M15's own comment on it says "every
-- policy requires it".
--
-- Nothing was reachable: a pending person meets the 403 at identity long
-- before a route, so no surface could have called this. What was wrong is
-- that the TABLE would have allowed it, and this schema's whole posture is
-- that the database refuses rather than that no caller happens to ask.
--
-- The composed form (`actor_is_active() and org_id = actor_org_id()`) rather
-- than the old `echo.actor_in_org()` helper: that function was DROPPED in
-- 0034 as two spellings of one rule with one of them unexercised, and
-- bringing it back to save five words would be re-minting the drift.
--
-- READ is deliberately left alone. A suspended member seeing the alarms they
-- themselves set is not a leak — they are their own rows, `actor_id()` is
-- still the wall, and a person locked out mid-day should not also have their
-- own list vanish. The insert is where the harm would be.

begin;

drop policy reminder_own_write on echo.reminder;
create policy reminder_own_write on echo.reminder
  for insert to echo_app with check (
    echo.actor_is_active()
    and user_id = echo.actor_id()
    and created_by = echo.actor_id()
    and org_id = echo.actor_org_id()
  );

drop policy reminder_ack_own_write on echo.reminder_ack;
create policy reminder_ack_own_write on echo.reminder_ack
  for insert to echo_app with check (
    echo.actor_is_active()
    and user_id = echo.actor_id()
    and org_id = echo.actor_org_id()
  );

do $check$
declare
  v_names text;
begin
  -- both write paths now ask the M15 gate, and the four own-only policies on
  -- `reminder` are still all present (a DROP + CREATE is where one goes
  -- missing)
  select string_agg(policyname, ',' order by policyname) into v_names
    from pg_policies
   where schemaname = 'echo' and tablename = 'reminder'
     and policyname like 'reminder_own_%';
  if v_names <> 'reminder_own_delete,reminder_own_read,reminder_own_update,reminder_own_write' then
    raise exception '0232 FAILED: echo.reminder lost a policy in the rewrite (%)', coalesce(v_names, 'none');
  end if;

  select string_agg(tablename, ', ' order by tablename) into v_names
    from pg_policies
   where schemaname = 'echo' and tablename in ('reminder', 'reminder_ack')
     and cmd = 'INSERT' and coalesce(with_check, '') not like '%actor_is_active()%';
  if v_names is not null then
    raise exception '0232 FAILED: an alarm insert on % does not ask actor_is_active()', v_names;
  end if;

  -- the DISCRIMINATING half: the check above passes vacuously on a table with
  -- no insert policy at all
  if (select count(*) from pg_policies
       where schemaname = 'echo' and tablename in ('reminder', 'reminder_ack')
         and cmd = 'INSERT') <> 2 then
    raise exception '0232 FAILED: the two insert policies are not both there — the check above had nothing to find';
  end if;
end
$check$;

commit;
