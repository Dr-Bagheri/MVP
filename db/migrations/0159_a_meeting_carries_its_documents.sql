-- 0159 — a meeting carries its documents
--
-- User directive, asked three times and finally built: "add the attachments
-- as well" on the meeting's plan.
--
-- It was deferred twice for a good reason, which is worth stating because it
-- is what this migration is mostly about: a file is not a row. Adding a
-- dropzone is ten minutes; giving the files a home that an organisation can
-- be DELETED from is the actual work. So the ordering here is deliberate —
-- the table knows its object, the purge knows the table, and the purge's own
-- coverage check knows it too, before anything can upload a byte.
--
-- WHAT A ROW IS, and what it is not: a row is the RECORD of a file, not the
-- file. The bytes live in Supabase Storage under `storage_bucket` /
-- `storage_path`, exactly as a call's audio does (0004), and for the same
-- reason — the database is not a filesystem and a base64 column is a table
-- nobody can vacuum.
--
-- THE PURGE, and the ordering that matters: objects first, rows last. "The
-- row is the map to the object; delete the map last" (the 0132 purge
-- ruling). `platform_meeting_storage_paths` is how the purge job finds the
-- objects, and it is the twin of `platform_call_storage_paths` — same
-- signature, same root check, same exactly-one-of guard.

create table echo.meeting_attachment (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references echo.meeting(id) on delete cascade,
  -- org_id is DENORMALISED on purpose: the purge deletes by organisation, and
  -- a purge that has to join to find its own rows is a purge that breaks the
  -- day somebody adds a second path to a meeting.
  org_id          uuid not null references echo.org(id),
  name            text not null check (length(trim(name)) between 1 and 300),
  content_type    text not null check (length(content_type) between 1 and 200),
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_bucket  text not null default 'meeting-files',
  storage_path    text not null,
  created_by      uuid not null references echo.app_user(id),
  created_at      timestamptz not null default now(),
  -- one row per object: a second row pointing at the same bytes would make
  -- "delete the attachment" ambiguous about whether the object goes with it
  unique (storage_bucket, storage_path)
);

create index meeting_attachment_meeting_idx on echo.meeting_attachment (meeting_id);
create index meeting_attachment_org_idx on echo.meeting_attachment (org_id);

comment on table echo.meeting_attachment is
  'The RECORD of a file attached to a meeting; the bytes live in Storage. org_id is denormalised so the purge can delete by organisation without a join.';

alter table echo.meeting_attachment enable row level security;
alter table echo.meeting_attachment force row level security;

-- READ: whoever can see the meeting. Expressed as a read THROUGH the
-- meeting's own policies rather than as an org check, so this table can never
-- be more visible than the thing it hangs off.
create policy meeting_attachment_read on echo.meeting_attachment
  for select using (
    exists (select 1 from echo.meeting m where m.id = meeting_id)
  );

-- WRITE: the same wall, plus the actor stamping themselves. `created_by` is a
-- fact about who acted and must not be supplyable (0029's rule).
create policy meeting_attachment_insert on echo.meeting_attachment
  for insert with check (
    created_by = echo.actor_id()
    and org_id = echo.actor_org_id()
    and exists (select 1 from echo.meeting m where m.id = meeting_id)
  );

create policy meeting_attachment_delete on echo.meeting_attachment
  for delete using (
    exists (select 1 from echo.meeting m where m.id = meeting_id)
  );

grant select, insert, delete on echo.meeting_attachment to echo_app;
-- the agent reads nothing here and writes nothing: a document somebody
-- attached is not context the assistant was given
revoke all on echo.meeting_attachment from echo_agent;

-- ── the purge learns the table ─────────────────────────────────────────────
-- REGENERATED FROM THE CATALOGUE, not retyped. `create or replace` accepts a
-- stale body as cheerfully as a current one — it is not a diff — and 0155
-- proved that the hard way by reverting three migrations from a body four
-- revisions old. What follows is the live definition with ONE line added, and
-- the self-check at the foot asserts the line is there.
create or replace function echo.platform_purge_org(p_actor uuid, p_org uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  update echo.platform_audit
     set target_user_id = null, target_purged = true
   where target_user_id in (select id from echo.app_user where org_id = p_org);
  update echo.platform_audit
     set target_org_id = null, target_purged = true
   where target_org_id = p_org;

  delete from echo.workflow_step_output   where org_id = p_org;
  delete from echo.workflow_step_run      where org_id = p_org;
  delete from echo.workflow_run           where org_id = p_org;
  delete from echo.workflow_mute          where org_id = p_org;
  delete from echo.workflow_schedule      where org_id = p_org;
  delete from echo.workflow_auto_apply    where org_id = p_org;
  delete from echo.agent_workflow         where org_id = p_org;
  update echo.workflow set current_version_id = null where org_id = p_org;
  delete from echo.workflow_version       where org_id = p_org;
  delete from echo.workflow               where org_id = p_org;
  -- 0147's three, before the task rows they hang from
  delete from echo.task_event             where org_id = p_org;
  delete from echo.task_label_link        where org_id = p_org;
  delete from echo.task_label             where org_id = p_org;
  delete from echo.task_comment           where org_id = p_org;
  delete from echo.task_checklist_item    where org_id = p_org;
  delete from echo.task_assignee          where org_id = p_org;
  delete from echo.task                   where org_id = p_org;
  delete from echo.task_column            where org_id = p_org;
  delete from echo.task_topic             where org_id = p_org;
  delete from echo.mail_draft             where org_id = p_org;
  delete from echo.meeting_prep           where org_id = p_org;
  delete from echo.role_capability        where org_id = p_org;
  -- 0159: the attachment ROWS. Their OBJECTS are removed first by the purge
  -- job, which finds them through platform_meeting_storage_paths — "the row
  -- is the map to the object; delete the map last".
  delete from echo.meeting_attachment     where org_id = p_org;
  delete from echo.meeting                where org_id = p_org;
  delete from echo.meeting_topic          where org_id = p_org;

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

  insert into echo.platform_audit (actor_id, action, target_user_id, target_org_id, target_purged, reason)
  values (p_actor, 'org_purged', null, null, true,
          v_reason || ' [organization: ' || v_name || ']');
  return true;
end;
$function$;

create or replace function echo.platform_meeting_storage_paths(
  p_actor uuid, p_org uuid, p_user uuid
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
    select a.storage_bucket, a.storage_path
      from echo.meeting_attachment a
     where (p_org is not null and a.org_id = p_org)
        or (p_user is not null and a.created_by = p_user);
end;
$$;

revoke all on function echo.platform_meeting_storage_paths(uuid, uuid, uuid) from public;
grant execute on function echo.platform_meeting_storage_paths(uuid, uuid, uuid) to echo_app;

comment on function echo.platform_meeting_storage_paths(uuid, uuid, uuid) is
  'The twin of platform_call_storage_paths: where a purge finds the OBJECTS behind an organisation''s meeting attachments. Objects first, rows last.';

-- ── self-checks ────────────────────────────────────────────────────────────
do $$
declare
  v_org    uuid;
  v_person uuid := gen_random_uuid();
  v_meet   uuid;
  v_failed text;
begin
  -- 1) THE COVERAGE RULE, asserted the way 0145 wrote it: every org_id table
  --    is deleted by the purge or excepted with a reason. A new table that
  --    the purge does not know about makes the purge RAISE for any
  --    organisation that used the feature — 0132's sentence, proven twice.
  if position('delete from echo.meeting_attachment' in
       (select pg_get_functiondef(p.oid)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'echo' and p.proname = 'platform_purge_org')) = 0
  then
    raise exception
      'CHECK FAILED: platform_purge_org does not delete echo.meeting_attachment';
  end if;

  insert into echo.org (name, locale) values ('probe-0159', 'fa') returning id into v_org;
  insert into auth.users (id, email) values (v_person, 'probe-0159@example.test')
    on conflict (id) do nothing;
  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (v_person, v_org, 'probe-0159@example.test', 'probe', 'owner', 'active');
  insert into echo.meeting (org_id, title, scheduled_at, created_by)
  values (v_org, 'probe meeting', now(), v_person) returning id into v_meet;

  insert into echo.meeting_attachment
    (meeting_id, org_id, name, content_type, size_bytes, storage_path, created_by)
  values (v_meet, v_org, 'plan.pdf', 'application/pdf', 1024, 'probe/plan.pdf', v_person);

  -- 2) the STORAGE PATHS are findable by organisation — the purge's own read
  perform set_config('echo.actor_id', v_person::text, true);
  insert into echo.platform_operator (user_id, role, granted_by)
  values (v_person, 'platform_root', v_person);
  if not exists (
    select 1 from echo.platform_meeting_storage_paths(v_person, v_org, null)
     where path = 'probe/plan.pdf'
  ) then
    raise exception 'CHECK FAILED: the purge cannot find the object behind a row';
  end if;

  -- 3) deleting the MEETING takes its attachment rows (the FK cascade), so a
  --    meeting cannot leave orphans behind it
  delete from echo.meeting where id = v_meet;
  if exists (select 1 from echo.meeting_attachment where meeting_id = v_meet) then
    raise exception 'CHECK FAILED: an attachment outlived its meeting';
  end if;

  -- 4) the AGENT holds nothing here — a document somebody attached is not
  --    context the assistant was handed
  if has_table_privilege('echo_agent', 'echo.meeting_attachment', 'select') then
    v_failed := 'echo_agent can read meeting attachments';
  end if;
  if v_failed is not null then raise exception 'CHECK FAILED: %', v_failed; end if;

  raise notice '0159 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
