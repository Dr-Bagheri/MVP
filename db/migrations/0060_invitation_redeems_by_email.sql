-- Echo — 0060: an invitation redeems by VERIFIED EMAIL (user directive,
-- 2026-08-16: "invitation email does not send, make it simple — no token").
--
-- The token path (0043) exists so an out-of-band link cannot be forwarded:
-- the address match is what turns a forwarded link into a refusal. When the
-- platform itself emails the invitation, the person who arrives proves the
-- address a stronger way — the email in a VERIFIED JWT cannot be forwarded
-- at all. So the by-email door does not weaken 0043's posture; it *is* the
-- address match, with the token's job (delivery) done by the mailer.
--
-- D8's ledger: sixth pre-identity definer door, same reason as the fifth
-- (the redeemer has no app_user row yet, so no policy can see them).
--
-- NULL, not an exception, when there is nothing to redeem: every signup asks
-- this function first, and "no invitation" is the NORMAL answer that routes
-- to the org-choice path — absence is a value here, not a fault (rule 12).
-- The token door keeps raising: its callers hold a link and deserve a loud
-- answer about it.

create function echo.redeem_invitation_for_email(
  p_user_id uuid,
  p_email   citext
) returns echo.app_user
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_inv echo.invitation;
  v_row echo.app_user;
begin
  -- Newest live invitation for the address. Two orgs may have invited the
  -- same person (one-live-per-email is per org); the newest expresses the
  -- latest intent, and v1 identities hold one membership.
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
    (p_user_id, v_inv.org_id, p_email, '', v_inv.role, 'active', now(), v_inv.invited_by)
  returning * into v_row;

  update echo.invitation
     set redeemed_at = now(), redeemed_by = p_user_id
   where id = v_inv.id;

  return v_row;
end;
$$;

revoke all on function echo.redeem_invitation_for_email(uuid, citext) from public;
grant execute on function echo.redeem_invitation_for_email(uuid, citext) to echo_app;

comment on function echo.redeem_invitation_for_email(uuid, citext) is
  'Redeems the newest live invitation for a VERIFIED address at first sign-in: active member, granted role, invitation stamped. NULL when none — absence routes to the org-choice signup path. The JWT email is the address match (0043''s rule, stronger form).';
