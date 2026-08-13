-- Echo — 0044: true delete as a tombstone (M24).
--
-- "True delete must preserve the append-only audit; anonymize/tombstone the
-- person, references survive." So the row does not go: it is emptied of the
-- person and left in place, because `admin_action`, `proposal_decision`,
-- `agent_run`, `summary.created_by` and every corrected transcript line point
-- at it. Removing the row would either cascade the audit away or break it —
-- and an audit trail with holes where the interesting people used to be is
-- worse than none.
--
-- ===========================================================================
-- The username is RESERVED, not freed (steward-ratified).
--
-- Freeing it would let a newcomer wear a departed colleague's handle, and
-- every historical reference to @sara would silently start resolving to
-- someone else. In a product whose purpose is an accurate record of who said
-- what in a meeting, a handle that changes owner is a small forgery machine,
-- and the damage lands retroactively on records already written.
--
-- The objection — that reserving leaks the handle existed — is bounded by a
-- decision already made: usernames are unique per ORG (0039), so the leak
-- reaches future members of the organization where that person actually
-- worked, who could learn as much from any transcript they appear in.
--
-- References therefore resolve to "a deleted person, formerly @x". Record
-- accuracy is the product; full erasure is a platform-level request and is
-- outside v1.
-- ===========================================================================

alter table echo.app_user
  add column tombstoned_at timestamptz,
  add column tombstoned_by uuid references echo.app_user(id);

alter table echo.app_user
  add constraint app_user_tombstone_consistent
  check (num_nonnulls(tombstoned_at, tombstoned_by) in (0, 2));

comment on column echo.app_user.tombstoned_at is
  'True-deleted (M24): the person is gone, the row remains so the audit trail still resolves. username is kept deliberately — see 0044.';

-- The email rule loosens for operator paths only.
--
-- "email is owned by the auth provider" is right for every application write,
-- and anonymizing a tombstone is not one. Gated on from_app, the same seam
-- D13 already uses: application connections cannot touch it, the definer
-- paths can.
create or replace function echo.tg_app_user_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id then
    raise exception 'a user cannot change identity or org'
      using errcode = 'check_violation';
  end if;

  if from_app and new.email is distinct from old.email then
    raise exception 'email is owned by the auth provider, not by this table'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role is distinct from old.role or new.status is distinct from old.status then
    if from_app then
      if actor = old.id then
        raise exception 'nobody changes their own role or status'
          using errcode = 'insufficient_privilege';
      end if;

      if new.role = 'owner' then
        raise exception 'ownership is transferred by an explicit action, not by a role change'
          using errcode = 'insufficient_privilege';
      end if;
      if old.role = 'owner' then
        raise exception 'the owner''s own role and status are not changed by anyone'
          using errcode = 'insufficient_privilege';
      end if;

      if (echo.role_is_admin(old.role) or echo.role_is_admin(new.role))
         and not echo.actor_is_owner() then
        raise exception 'only the owner may change an admin, or make one'
          using errcode = 'insufficient_privilege';
      end if;

      if not echo.actor_is_admin() then
        raise exception 'only an admin may change a role or a membership status'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    if old.status = 'pending' and new.status = 'active' then
      new.accepted_at := now();
      new.accepted_by := case when from_app then actor else null end;
    end if;

    if new.status is distinct from old.status then
      perform echo.record_status_change(
        old.id, old.org_id, old.status, new.status,
        case when from_app then actor else null end
      );
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The operation itself. Owner-only: M23 gives the owner the org-level
-- irreversibles, and this is the most irreversible thing in the product.
-- ---------------------------------------------------------------------------

create function echo.tombstone_user(p_user uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_actor uuid := echo.actor_id();
  v_row   echo.app_user;
  v_call  uuid;
begin
  if not echo.actor_is_owner() then
    raise exception 'only the owner may delete a person'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
  from echo.app_user u
  where u.id = p_user and u.org_id = echo.actor_org_id();

  if not found then
    raise exception 'no such person in this organization'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.id = v_actor then
    raise exception 'the owner cannot delete themselves; transfer ownership first'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.role = 'owner' then
    raise exception 'the owner is not deletable while they own the organization'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent: deleting an already-deleted person is not an error.
  if v_row.tombstoned_at is not null then
    return false;
  end if;

  -- Their calls go with them, as deletions attributed to whoever did this —
  -- M11 semantics compose, so the 30-day purge window applies exactly as it
  -- would to any other deletion and the audio is removed on the same schedule.
  for v_call in
    select c.id from echo.call c
    where c.owner_id = p_user and c.deleted_at is null
  loop
    perform echo.soft_delete_call(v_call);
  end loop;

  update echo.app_user u
     set display_name    = '',
         display_name_en = null,
         avatar_url      = null,
         preferred_model = null,
         -- Unique and NOT NULL, so it is replaced rather than cleared. The
         -- address is what identifies a person to a mail server; the id is
         -- what identifies them to this database.
         email           = ('deleted-' || u.id::text || '@tombstone.invalid')::citext,
         status          = 'disabled',
         tombstoned_at   = now(),
         tombstoned_by   = v_actor
         -- username is deliberately NOT cleared. See the header.
   where u.id = p_user;

  return true;
end;
$$;

revoke all on function echo.tombstone_user(uuid) from public;
grant execute on function echo.tombstone_user(uuid) to echo_app;

comment on function echo.tombstone_user(uuid) is
  'M24 true delete: empties the person, keeps the row so the audit still resolves, keeps the username so references cannot be re-pointed at someone else.';
