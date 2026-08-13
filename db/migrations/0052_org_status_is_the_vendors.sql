-- Echo — 0052: an organization's status is the vendor's, and getting into
-- suspension must not be easier than getting out.
--
-- Asked to verify the vendor-accept path for pending orgs, I found it present
-- and audited (echo.vendor_accept_org, 0015/0036) — and found the real
-- one-way door next to it.
--
-- ===========================================================================
-- Measured, not reasoned:
--
--   owner suspends their OWN org:  1 row  — ALLOWED
--   same owner tries to undo it:   0 rows — LOCKED OUT
--   org status now:                suspended
--
-- `org_admin_update` let any admin write any column of their own org,
-- including `status`. Suspending it takes one UPDATE — and every predicate
-- that would authorise the reverse (`actor_is_admin`, `actor_is_active`)
-- requires the org to be active, so the reverse is unreachable from inside the
-- product. An admin could brick their own organization for everyone, forever,
-- and the only exit is an operator with raw SQL.
--
-- Two rules were each correct: admins manage their org; a suspended org grants
-- nobody anything. Together they make a door that opens one way, and the org
-- itself is the thing on the wrong side of it.
-- ===========================================================================

alter table echo.org
  add column status_changed_at timestamptz;

comment on column echo.org.status_changed_at is
  'When the vendor last changed this org''s status. NULL means never changed since creation.';

-- Suspension is a commercial decision about a customer, so it is not an
-- application capability at all — not for an admin, not for an owner. The
-- guard says so at the altitude where it cannot be forgotten.
create function echo.tg_org_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if from_app and new.status is distinct from old.status then
    raise exception
      'an organization''s status is set by the vendor, not from the application'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;

  return new;
end;
$$;

create trigger org_guard
  before update on echo.org
  for each row execute function echo.tg_org_guard();

-- ---------------------------------------------------------------------------
-- The named way in and out. Both directions through one door, deliberately:
-- an operation that can only suspend would rebuild the one-way street it
-- exists to remove.
-- ---------------------------------------------------------------------------

create function echo.vendor_set_org_status(p_org uuid, p_status echo.org_status)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_current echo.org_status;
begin
  select o.status into v_current from echo.org o where o.id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;

  -- Already there is not a failure, matching soft_delete_call and
  -- vendor_accept_org: a retry answers false, a refusal raises.
  if v_current = p_status then
    return false;
  end if;

  update echo.org set status = p_status where id = p_org;
  return true;
end;
$$;

revoke all on function echo.vendor_set_org_status(uuid, echo.org_status) from public;
grant execute on function echo.vendor_set_org_status(uuid, echo.org_status) to echo_vendor;

comment on function echo.vendor_set_org_status(uuid, echo.org_status) is
  'Suspend or reactivate an organization. Vendor-only, both directions — the operator path exists so that suspension is never a door that opens one way.';

-- Members' own statuses are untouched by this: a suspended org changes what
-- its people can reach, not who they are, and writing "disabled" across a
-- customer's staff because their invoice is late would be a lie the status
-- history would then carry forever.
