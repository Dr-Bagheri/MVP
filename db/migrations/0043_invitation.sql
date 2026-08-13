-- Echo — 0043: the invite door (M24, "Add user = BOTH doors").
--
-- An invitation is an artifact with a show-once token, exactly like an API
-- key: the link is displayed to the inviter for out-of-band delivery, and the
-- database keeps only its hash. v1 has no email path; that is a designed seam,
-- not a missing feature.
--
-- ===========================================================================
-- The semantics the dispatch left open: an invited person arrives ACTIVE.
--
-- The acceptance gate (M15) exists to answer one question — should this person
-- be here? An invitation already answers it: an admin or owner named this
-- individual, chose their role, and handed them a link. Making them then wait
-- for an acceptance is a gate with no decision behind it, and a queue of
-- pending people nobody remembers inviting is how a real one gets rubber-
-- stamped.
--
-- This is M24's own reasoning for the direct-creation door — "admin vouching =
-- acceptance built in" — applied to the door that involves strictly more
-- deliberation, since inviting someone means naming them in advance.
--
-- The three arrival paths, stated together so the gate stays coherent:
--   invited            → active   (someone vouched, by name)
--   self-signup, join  → pending  (nobody vouched)
--   self-signup, new org → pending until the vendor accepts (D13)
--
-- Deviation from the dispatch, deliberately: the inviter's role decides WHAT
-- ROLE they may grant, not whether acceptance is needed. "Accepted-or-pending
-- per the inviter's role" would mean an admin's invitee waits while an owner's
-- does not — a difference the invitee experiences and cannot explain.
-- ===========================================================================

create table echo.invitation (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references echo.org(id),

  email        citext not null,
  -- The role they will arrive with. Never 'owner': ownership transfers by an
  -- explicit act (D22), and an invitation is not one.
  role         echo.member_role not null,

  invited_by   uuid not null references echo.app_user(id),

  -- Shown once, stored hashed — the token itself never reaches this table,
  -- these logs, or a backup (invariant 7).
  token_sha256 text not null,
  token_prefix text not null,

  expires_at   timestamptz not null,
  redeemed_at  timestamptz,
  redeemed_by  uuid references echo.app_user(id),
  revoked_at   timestamptz,
  revoked_by   uuid references echo.app_user(id),
  created_at   timestamptz not null default now(),

  constraint invitation_token_key unique (token_sha256),
  constraint invitation_role_not_owner check (role <> 'owner'),
  constraint invitation_inviter_same_org
    foreign key (invited_by, org_id) references echo.app_user (id, org_id),
  constraint invitation_redeemer_same_org
    foreign key (redeemed_by, org_id) references echo.app_user (id, org_id),
  constraint invitation_redeem_consistent
    check (num_nonnulls(redeemed_at, redeemed_by) in (0, 2)),
  constraint invitation_revoke_consistent
    check (num_nonnulls(revoked_at, revoked_by) in (0, 2)),
  -- An invitation that was both redeemed and revoked describes two different
  -- histories.
  constraint invitation_not_both
    check (redeemed_at is null or revoked_at is null)
);

-- One live invitation per address per org. Re-inviting someone should replace
-- the outstanding link rather than leave two working ones in the world.
create unique index invitation_one_live_per_email
  on echo.invitation (org_id, email)
  where redeemed_at is null and revoked_at is null;

create index invitation_org_idx on echo.invitation (org_id, created_at desc);

alter table echo.invitation enable row level security;
alter table echo.invitation force  row level security;

-- Admins see and issue invitations; only the owner may invite an admin, for
-- the same reason only the owner may promote one (D22) — an admin who could
-- invite a peer could create someone they then cannot manage.
create policy invitation_read on echo.invitation for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_admin());

create policy invitation_issue on echo.invitation for insert to echo_app
  with check (
    org_id = echo.actor_org_id()
    and echo.actor_is_admin()
    and invited_by = echo.actor_id()
    and (not echo.role_is_admin(role) or echo.actor_is_owner())
  );

-- Update is for revoking. Redemption goes through the function below, because
-- the person redeeming has no app_user row yet and therefore no identity.
create policy invitation_revoke on echo.invitation for update to echo_app
  using      (org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin());

grant select, insert, update on echo.invitation to echo_app;

-- What an invitation says cannot change after it is issued: the address, the
-- role and the token are what the recipient was told, and an invitation whose
-- terms move is not an invitation.
create function echo.tg_invitation_immutable() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.org_id       is distinct from old.org_id
  or new.email        is distinct from old.email
  or new.role         is distinct from old.role
  or new.invited_by   is distinct from old.invited_by
  or new.token_sha256 is distinct from old.token_sha256
  or new.expires_at   is distinct from old.expires_at then
    raise exception 'an invitation''s terms are fixed when it is issued; revoke it and send another'
      using errcode = 'insufficient_privilege';
  end if;

  if new.revoked_at is not null and old.revoked_at is null then
    new.revoked_at := now();
    new.revoked_by := coalesce(echo.actor_id(), new.revoked_by);
  end if;

  return new;
end;
$$;

create trigger invitation_immutable
  before update on echo.invitation
  for each row execute function echo.tg_invitation_immutable();

-- ---------------------------------------------------------------------------
-- Redemption.
--
-- A pre-identity door, like register_account: the redeemer has authenticated
-- with the auth provider and has no app_user row yet, so no policy can see
-- them. D8's ledger is enumerated-with-reasons; this is the fifth entry.
--
-- The address must match. The link is handed over out of band, so a forwarded
-- one would otherwise let an unintended person join an organization under
-- someone else's invitation — a bearer token where a named invitation was
-- meant. Requiring the match turns forwarding into a refusal, and the person
-- who was actually meant to join is re-invited at their real address.
-- ---------------------------------------------------------------------------

create function echo.redeem_invitation(
  p_token_sha256 text,
  p_user_id      uuid,
  p_email        citext
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
  where i.token_sha256 = p_token_sha256
    and i.redeemed_at is null
    and i.revoked_at is null
    and i.expires_at > now();

  -- One answer for expired, revoked, already-used and never-existed: a
  -- redemption endpoint that distinguishes them is a probe for valid tokens.
  if not found then
    raise exception 'this invitation cannot be redeemed'
      using errcode = 'insufficient_privilege';
  end if;

  if v_inv.email is distinct from p_email then
    raise exception 'this invitation was issued to a different address'
      using errcode = 'insufficient_privilege';
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

revoke all on function echo.redeem_invitation(text, uuid, citext) from public;
grant execute on function echo.redeem_invitation(text, uuid, citext) to echo_app;

comment on function echo.redeem_invitation(text, uuid, citext) is
  'Turns an invitation token into an ACTIVE member: the invitation is the acceptance (M15/M24). Refuses expired, revoked, used, unknown and wrong-address identically.';
