-- NeurAI Platform — 0083: INSTANT PURGE from the console's trash views
-- (user directive, 2026-08-23: "add instant purge as well here — and for
-- organizations as well").
--
-- The 7-day window (0068) stamps `purge_after`; these are the DOORS that
-- execute the erasure NOW, root-walled and reasoned like every console
-- action. The api deletes the STORAGE OBJECTS FIRST (the objects-first
-- ruling: the row is the map to the object, delete the map last) using
-- `platform_call_storage_paths` below, and only then calls the purge
-- function — a purge that cannot keep the whole promise must not keep
-- half.
--
-- USER purge = the 0044 tombstone's ruled erasure (identity emptied,
-- email replaced, the row KEPT as a stone — hard-deleting an app_user
-- would tear FKs across the schema and the platform audit RESTRICTs it
-- anyway) plus a full purge of the calls they owned. ORG purge deletes
-- the tenancy whole: every org-scoped row, members included, then the
-- org row; the platform audit's references to the purged org/users are
-- SEVERED to null first (the proposal_decision precedent: the row's
-- content purges — the FACT of the action is not content, and the
-- operator's reason is the surviving record).

alter type echo.platform_audit_action add value if not exists 'user_purged';
alter type echo.platform_audit_action add value if not exists 'org_purged';

-- ─── objects-first support: the audio the api must delete BEFORE rows ──────
create function echo.platform_call_storage_paths(
  p_actor uuid,
  p_org   uuid,
  p_user  uuid
) returns table (bucket text, path text)
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform echo.require_platform_root(p_actor);
  if (p_org is null) = (p_user is null) then
    raise exception 'exactly one of org or user' using errcode = 'check_violation';
  end if;
  return query
    select p.storage_bucket, p.storage_path
      from echo.call_part p
      join echo.call c on c.id = p.call_id
     where p.storage_path is not null
       and ((p_org is not null and c.org_id = p_org)
         or (p_user is not null and c.owner_id = p_user));
end;
$$;

-- ─── USER: erase the person, purge their calls, leave the trash ────────────
create function echo.platform_purge_user(
  p_actor  uuid,
  p_target uuid,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason text;
  v_row    echo.app_user;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  if exists (select 1 from echo.platform_operator where user_id = p_target) then
    raise exception 'a platform root is not purged through this action'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from echo.app_user u where u.id = p_target;
  if not found then
    raise exception 'no such user' using errcode = 'no_data_found';
  end if;
  -- the trash-view precondition: purge finishes a deletion, it never
  -- starts one — a live account must go through soft delete's window door
  if v_row.deleted_at is null then
    raise exception 'only a deleted user can be purged'
      using errcode = 'check_violation';
  end if;

  -- their OWNED calls go whole, rows-after-objects (the api already swept
  -- the storage via platform_call_storage_paths before calling this)
  delete from echo.transcript_segment s using echo.call c
    where s.call_id = c.id and c.owner_id = p_target;
  delete from echo.summary s using echo.call c
    where s.call_id = c.id and c.owner_id = p_target;
  delete from echo.call_speaker s using echo.call c
    where s.call_id = c.id and c.owner_id = p_target;
  delete from echo.call_part p using echo.call c
    where p.call_id = c.id and c.owner_id = p_target;
  -- runs die with their calls (0046's BEFORE DELETE stamps truncation on
  -- surviving messages; proposal_decision links are SET NULL by 0029)
  delete from echo.agent_run r using echo.call c
    where r.call_id = c.id and c.owner_id = p_target;
  delete from echo.call c where c.owner_id = p_target;

  -- the 0044 erasure, platform edition — the row stays, the person leaves
  update echo.app_user u
     set display_name    = '',
         display_name_en = null,
         avatar_url      = null,
         preferred_model = null,
         email           = ('deleted-' || u.id::text || '@tombstone.invalid')::public.citext,
         status          = 'disabled',
         tombstoned_at   = coalesce(u.tombstoned_at, now()),
         tombstoned_by   = coalesce(u.tombstoned_by, p_actor),
         -- purged = FINISHED: it leaves the trash list, nothing pends
         deleted_at      = null,
         deleted_by      = null,
         purge_after     = null
   where u.id = p_target;

  perform echo.record_platform_audit(p_actor, 'user_purged', p_target, null, v_reason);
  return true;
end;
$$;

-- ─── ORG: the tenancy goes whole ───────────────────────────────────────────
create function echo.platform_purge_org(
  p_actor  uuid,
  p_org    uuid,
  p_reason text
) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_reason  text;
  v_deleted timestamptz;
  v_name    text;
begin
  perform echo.require_platform_root(p_actor);
  v_reason := echo.platform_reason(p_reason);

  select o.deleted_at, o.name into v_deleted, v_name
    from echo.org o where o.id = p_org;
  if not found then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  if v_deleted is null then
    raise exception 'only a deleted organization can be purged'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from echo.platform_operator po
      join echo.app_user u on u.id = po.user_id
     where u.org_id = p_org
  ) then
    raise exception 'an organization holding a platform root is not purged; revoke the root first'
      using errcode = 'insufficient_privilege';
  end if;

  -- sever the platform audit's references (RESTRICT FKs): the rows stay —
  -- the record that actions happened is not the purged content — and the
  -- org's NAME rides this entry's reason as the surviving identifier
  update echo.platform_audit set target_user_id = null
   where target_user_id in (select id from echo.app_user where org_id = p_org);
  update echo.platform_audit set target_org_id = null
   where target_org_id = p_org;

  -- children before parents, the whole tenancy (composite org-scoped FKs
  -- mean nothing outside the org can reference any of this)
  delete from echo.webhook_delivery       where org_id = p_org;
  delete from echo.webhook                where org_id = p_org;
  delete from echo.transcript_segment     where org_id = p_org;
  delete from echo.summary                where org_id = p_org;
  delete from echo.call_speaker           where org_id = p_org;
  delete from echo.call_note              where org_id = p_org;
  delete from echo.call_part              where org_id = p_org;
  delete from echo.agent_message_feedback f using echo.agent_message m
    where f.message_id = m.id and m.org_id = p_org;
  delete from echo.agent_message          where org_id = p_org;
  delete from echo.agent_session_share sh using echo.agent_session s
    where sh.session_id = s.id and s.org_id = p_org;
  delete from echo.agent_session          where org_id = p_org;
  delete from echo.agent_card             where org_id = p_org;
  delete from echo.agent_rule             where org_id = p_org;
  delete from echo.proposal_decision      where org_id = p_org;
  delete from echo.agent_run              where org_id = p_org;
  delete from echo.assistant_agent        where org_id = p_org;
  delete from echo.api_key                where org_id = p_org;
  delete from echo.invitation             where org_id = p_org;
  delete from echo.skill                  where org_id = p_org;
  delete from echo.person                 where org_id = p_org;
  delete from echo.connector_secret       where org_id = p_org;
  delete from echo.connector_connection   where org_id = p_org;
  delete from echo.workflow_template      where org_id = p_org;
  delete from echo.admin_action           where org_id = p_org;
  delete from echo.user_status_history    where org_id = p_org;
  delete from echo.call                   where org_id = p_org;
  delete from echo.app_user               where org_id = p_org;
  delete from echo.org                    where id = p_org;

  perform echo.record_platform_audit(
    p_actor, 'org_purged', null, null,
    v_reason || ' [organization: ' || v_name || ']');
  return true;
end;
$$;

revoke all on function echo.platform_call_storage_paths(uuid, uuid, uuid) from public;
revoke all on function echo.platform_purge_user(uuid, uuid, text) from public;
revoke all on function echo.platform_purge_org(uuid, uuid, text) from public;
grant execute on function echo.platform_call_storage_paths(uuid, uuid, uuid) to echo_app;
grant execute on function echo.platform_purge_user(uuid, uuid, text) to echo_app;
grant execute on function echo.platform_purge_org(uuid, uuid, text) to echo_app;

comment on function echo.platform_purge_user(uuid, uuid, text) is
  'Instant purge (0083): the 0044 erasure plus a full purge of the user''s owned calls. Trash-view rows only; roots refused; the api sweeps storage objects FIRST.';
comment on function echo.platform_purge_org(uuid, uuid, text) is
  'Instant purge (0083): the whole tenancy, children before parents, audit references severed to null. Trash-view rows only; org with a root refused; the api sweeps storage objects FIRST.';
