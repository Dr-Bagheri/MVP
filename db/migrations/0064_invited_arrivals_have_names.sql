-- Echo — 0064: the by-email door carries a DISPLAY NAME (found live: the
-- first invited arrival landed as an ACTIVE member with display_name '' —
-- a nameless row in every roster, because 0060's insert hardcoded '').
--
-- The name comes from the caller (core derives it from the verified email's
-- local part when the person typed nothing); '' stays legal — the profile
-- screen is where people name themselves properly.

drop function echo.redeem_invitation_for_email(uuid, citext);

create function echo.redeem_invitation_for_email(
  p_user_id      uuid,
  p_email        citext,
  p_display_name text default ''
) returns echo.app_user
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_inv echo.invitation;
  v_row echo.app_user;
begin
  select * into v_inv
  from echo.invitation i
  where i.email = p_email
    and i.redeemed_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  order by i.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  insert into echo.app_user
    (id, org_id, email, display_name, role, status, accepted_at, accepted_by)
  values
    (p_user_id, v_inv.org_id, p_email, coalesce(p_display_name, ''),
     v_inv.role, 'active', now(), v_inv.invited_by)
  returning * into v_row;

  update echo.invitation
     set redeemed_at = now(), redeemed_by = p_user_id
   where id = v_inv.id;

  return v_row;
end;
$$;

revoke all on function echo.redeem_invitation_for_email(uuid, citext, text) from public;
grant execute on function echo.redeem_invitation_for_email(uuid, citext, text) to echo_app;

comment on function echo.redeem_invitation_for_email(uuid, citext, text) is
  'Redeems the newest live invitation for a VERIFIED address at first sign-in (0060, name added 0064): active member, granted role, invitation stamped. NULL when none.';
