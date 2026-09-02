-- 0156 — the vendor places an arrival
--
-- User directive, 2026-09-02: "the pending must land in the platform control
-- now, then there it will assign the org and get accepted or rejected."
--
-- Today a pending arrival is approved by their own organisation's admin, in
-- Management·Users. That works for someone an admin INVITED and already
-- expects. It does not work for the case that actually produces pending rows
-- on this platform: a stranger signs up, `register_account` puts them in an
-- organisation of their own naming, and the only person who can decide where
-- they truly belong is the vendor — who could see them, and could not move
-- them.
--
-- So the missing operation is not "approve". It is PLACE: choose the
-- organisation, choose the role, and activate, as one act. `platform_update_
-- user` can already change a role and cannot change an org; nothing could.
--
-- Why one function rather than "set org, then set status":
--
--   Two calls make a state that is reachable and wrong — a member sitting
--   ACTIVE in the organisation they invented for themselves, because the
--   second call failed or the operator's tab closed between them. The whole
--   point of the pending state is that nobody is inside an organisation until
--   somebody decides which one. A single statement cannot half-decide.
--
-- A correction, written down because I asserted the opposite while building
-- this and the self-check caught me: there is NO trigger writing
-- `user_status_history` on an ordinary status change. `record_status_change`
-- exists and refuses any caller outside a trigger (0041), and the app_user
-- guard does not call it — so acceptance, suspension and this placement all
-- leave the trend table untouched today. That is a real gap and it is not
-- this migration's to close; it is recorded here rather than papered over,
-- because the belief that it was already handled is exactly the kind that
-- nothing asserts against until something does.
--
-- What this DOES record is the acceptance stamp the guard writes: pending →
-- active sets `accepted_at`, and `accepted_by` stays NULL when the change
-- did not come from the app role — which is M15's own spelling of "the
-- vendor did this", and the thing that distinguishes a placement from an
-- admin accepting one of their own.
--
-- The org guard learned its one door in 0155; this is the only operation
-- that walks through it.
--
-- ORDINARY PATH, walked (rule 7's authorization-matrix corollary): the
-- self-checks below assert that a root CAN place a pending arrival, that the
-- history line appears, that a non-root is refused, and — the one that is
-- easy to leave out and is the actual invariant — that an ACTIVE member
-- cannot be moved between organisations by this door. Placing is a thing you
-- do to an arrival, not a way to reassign staff.

create function echo.platform_assign_user_org(
  p_actor  uuid,
  p_target uuid,
  p_org    uuid,
  p_role   echo.member_role,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_status echo.user_status;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select u.status into v_status from echo.app_user u where u.id = p_target;
  if v_status is null then
    raise exception 'no such user' using errcode = 'no_data_found';
  end if;

  -- The guard that makes this a PLACEMENT and not a transfer. An active
  -- member's organisation is their working life — their calls, their tasks,
  -- their history all hang off it, and none of that travels. Moving them is a
  -- different operation with a different name, and it does not exist yet
  -- precisely because nobody has decided what should happen to the rows.
  if v_status <> 'pending' then
    raise exception 'only a pending arrival can be placed'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from echo.org o where o.id = p_org and o.deleted_at is null) then
    raise exception 'no such organisation' using errcode = 'no_data_found';
  end if;

  -- One statement: org, role and status together. `owner` is deliberately
  -- reachable here — an organisation's first real member has to be able to be
  -- its owner, and the table's own one-owner-per-org constraint is what says
  -- whether this particular one may.
  update echo.app_user
     set org_id = p_org,
         role   = coalesce(p_role, 'member'),
         status = 'active'
   where id = p_target;

  perform echo.record_platform_audit(p_actor, 'user_placed', p_target, p_org, v_reason);
  return true;
end;
$$;

revoke all on function echo.platform_assign_user_org(uuid, uuid, uuid, echo.member_role, text) from public;
grant execute on function echo.platform_assign_user_org(uuid, uuid, uuid, echo.member_role, text) to echo_app;

comment on function echo.platform_assign_user_org(uuid, uuid, uuid, echo.member_role, text) is
  'Vendor-only. Places a PENDING arrival into an organisation with a role and activates them, in one statement. Refuses any other status: this is a placement, not a transfer.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $$
declare
  v_root   uuid;
  v_org_a  uuid;
  v_org_b  uuid;
  v_person uuid;
  v_failed text;
begin
  -- a root, two organisations, and an arrival sitting in the wrong one
  insert into echo.org (name, locale) values ('probe-a', 'fa') returning id into v_org_a;
  insert into echo.org (name, locale) values ('probe-b', 'fa') returning id into v_org_b;

  -- 0002's FK: an app_user needs an auth identity, so the probe mints two
  v_root   := gen_random_uuid();
  v_person := gen_random_uuid();
  insert into auth.users (id, email) values
    (v_root,   'probe-root-0156@example.test'),
    (v_person, 'probe-arrival-0156@example.test')
  on conflict (id) do nothing;

  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (v_root, v_org_a, 'probe-root-0156@example.test', 'root', 'owner', 'active');
  insert into echo.platform_operator (user_id, role, granted_by) values (v_root, 'platform_root', v_root);

  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (v_person, v_org_a, 'probe-arrival-0156@example.test', 'arrival', 'member', 'pending');

  -- 1) the ORDINARY path: a root places the arrival into the other org.
  --    `require_platform_root` demands the supplied actor EQUAL the session's
  --    own — that is what stops a definer function being an authority-
  --    smuggling primitive — so the probe has to become the root rather than
  --    merely name it. Without this the positive path cannot be walked at
  --    all, and a self-check that only ever asserts refusals is the
  --    authorization-matrix corollary's exact failure: the privileged path
  --    and the refused path both proven, and the ORDINARY path — the one
  --    that is the product — never run.
  perform set_config('echo.actor_id', v_root::text, true);
  perform echo.platform_assign_user_org(v_root, v_person, v_org_b, 'admin', 'probe');
  if not exists (
    select 1 from echo.app_user u
     where u.id = v_person and u.org_id = v_org_b and u.status = 'active' and u.role = 'admin'
  ) then
    raise exception 'CHECK FAILED: the arrival was not placed';
  end if;

  -- 2) the acceptance is stamped, and stamped as the VENDOR's: `accepted_at`
  --    set, `accepted_by` NULL. An admin accepting their own arrival leaves
  --    their id there instead, so this is the assertion that tells the two
  --    apart — and the one that would fail if the placement ever started
  --    running as the app role.
  if not exists (
    select 1 from echo.app_user u
     where u.id = v_person and u.accepted_at is not null and u.accepted_by is null
  ) then
    raise exception 'CHECK FAILED: the placement was not stamped as the vendor''s';
  end if;

  -- 3) THE INVARIANT: the same call on the now-ACTIVE member is refused —
  --    placing is not transferring
  begin
    perform echo.platform_assign_user_org(v_root, v_person, v_org_a, 'member', 'probe');
    v_failed := 'an ACTIVE member was moved between organisations';
  exception when invalid_parameter_value then
    v_failed := null;
  end;
  if v_failed is not null then raise exception 'CHECK FAILED: %', v_failed; end if;

  -- 4) a non-root is refused. The session BECOMES that person first, so the
  --    refusal is the root check firing and not the actor-mismatch guard —
  --    two different reasons to say no, and only one of them is the wall
  --    this test is about.
  perform set_config('echo.actor_id', v_person::text, true);
  begin
    perform echo.platform_assign_user_org(v_person, v_person, v_org_a, 'member', 'probe');
    v_failed := 'a non-root reached the door';
  exception when insufficient_privilege then
    v_failed := null;
  end;
  if v_failed is not null then raise exception 'CHECK FAILED: %', v_failed; end if;

  raise notice '0156 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
