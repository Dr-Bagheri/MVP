-- NeurAI Platform — 0084: the audit ledger survives a purge (the 0083
-- instant-purge's first live run found this: `platform_audit_target_present`
-- refused both the severed references and the target-less 'org_purged'
-- entry — 23514, the whole purge rolled back, nothing half-deleted).
--
-- The constraint's spirit stands: an audit line names its subject. What it
-- could not express is the one legitimate exception — THE SUBJECT WAS
-- PURGED. So the exception becomes explicit: `target_purged` declares WHY
-- a row carries no reference (rule 12: name the nothing), the check admits
-- exactly that case, and a row can still never silently lose its target.

alter table echo.platform_audit
  add column target_purged boolean not null default false;

alter table echo.platform_audit
  drop constraint platform_audit_target_present;
alter table echo.platform_audit
  add constraint platform_audit_target_present
  check (target_user_id is not null or target_org_id is not null or target_purged);

comment on column echo.platform_audit.target_purged is
  'True = this row''s subject was purged (0084): its FK references were severed on purpose, and the reason text is the surviving identifier.';

-- ─── the org purge, re-issued with the declaration ─────────────────────────
create or replace function echo.platform_purge_org(
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

  -- sever the ledger's references AND declare why (0084): the rows stay,
  -- their subject is gone, and target_purged is the named reason
  update echo.platform_audit
     set target_user_id = null, target_purged = true
   where target_user_id in (select id from echo.app_user where org_id = p_org);
  update echo.platform_audit
     set target_org_id = null, target_purged = true
   where target_org_id = p_org;

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

  -- the purge's own entry: no target CAN exist — the declaration carries it
  insert into echo.platform_audit (actor_id, action, target_user_id, target_org_id, target_purged, reason)
  values (p_actor, 'org_purged', null, null, true,
          v_reason || ' [organization: ' || v_name || ']');
  return true;
end;
$$;
