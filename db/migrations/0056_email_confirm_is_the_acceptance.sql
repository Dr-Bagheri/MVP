-- ---------------------------------------------------------------------------
-- 0056 — email confirmation IS the acceptance (M15 amendment, user 2026-08-15).
--
-- The vendor gate on self-registration is retired. A person who signs up,
-- confirms their email, and FOUNDS A NEW ORG lands ACTIVE — owner of an empty
-- org that contains nothing anyone else could leak into. Supabase's
-- email-confirmation is the entire gate (it is what proves the mailbox is
-- theirs), so the product no longer holds them in a waiting room afterwards.
--
-- JOINING AN EXISTING ORG does NOT ride this amendment. That path stays
-- 'pending' exactly as before: an org id is an identifier, not an invitation,
-- and "I typed an org's id and confirmed my own email" must never become
-- membership in someone else's data. The sanctioned self-serve join is the
-- invitation (0043, D25: address-matched, active on redeem); the pending row
-- remains for an admin to accept in-product.
--
-- vendor_accept_org / vendor_pending_orgs stay as shipped: they simply find
-- no founders any more. They remain correct for any legacy pending founder
-- and cost nothing standing.
-- ---------------------------------------------------------------------------

create or replace function echo.register_account(
  p_user_id      uuid,
  p_email        citext,
  p_display_name text default '',
  p_org_name     text default null,
  p_join_org     uuid default null
) returns echo.app_user
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_org    uuid;
  v_role   echo.member_role;
  v_status echo.user_status;
  v_row    echo.app_user;
begin
  if p_user_id is null or p_email is null then
    raise exception 'registration requires an auth user id and an email'
      using errcode = 'null_value_not_allowed';
  end if;

  if p_join_org is not null then
    perform 1 from echo.org o where o.id = p_join_org and o.status = 'active';
    if not found then
      raise exception 'no such organization' using errcode = 'foreign_key_violation';
    end if;
    v_org    := p_join_org;
    v_role   := 'member';
    -- joining someone else's org: pending until THEIR admin says yes.
    v_status := 'pending';
  else
    insert into echo.org (name)
    values (coalesce(nullif(btrim(p_org_name), ''), nullif(btrim(p_display_name), ''), p_email::text))
    returning id into v_org;
    v_role   := 'owner';
    -- founding an empty org: the confirmed email IS the acceptance (0056).
    v_status := 'active';
  end if;

  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (p_user_id, v_org, p_email, coalesce(btrim(p_display_name), ''), v_role, v_status)
  returning * into v_row;

  return v_row;
end;
$$;

-- The 0015 comment promised "Always produces status=pending (M15)" — no
-- longer true, and a comment that promises the old world is worse than none.
comment on function echo.register_account(uuid, citext, text, text, uuid) is
  'The only way an app_user row is created without an existing identity. '
  'Founder of a NEW org: status=active — email confirmation is the acceptance '
  '(M15 as amended 2026-08-15, migration 0056). Joining an EXISTING org: '
  'status=pending until that org''s admin accepts; the invitation flow (0043) '
  'is the self-serve join path.';
