-- 0145 — MEETINGS, and the purge learns the tables it never knew.
--
-- ── part 1: the meeting table ────────────────────────────────────────────
-- User directive, 2026-08-31 (the reference adoption): "add a part name
-- meeting and add the online section that we dont have". A meeting is a
-- SCHEDULED fact — title, when, how it is held — that later gains a record:
--
--   · mode: upload | in_person | online. Online is the section we did not
--     have: the recorder's system-audio source captures both sides of an
--     online meeting, so an online meeting starts the recorder on that
--     source instead of the microphone.
--   · agenda as jsonb [{title, minutes}] and invitees as text[] — editing
--     either IS editing the meeting, so the UPDATE grant covers both and no
--     new DELETE joins the closed list. (The reference also shows file
--     attachments; there is no general attachment store in v1 and this
--     table deliberately does not pretend otherwise.)
--   · call_id: the record the meeting produced, composite-FK'd ON DELETE
--     SET NULL — a purged call must never take the org's meeting plan.
--
-- Org-shared exactly as the task board (0144): any active member reads and
-- reschedules, created_by is pinned, and the row never deletes — archived_at
-- is the only way off the list.
--
-- ── part 2: platform_purge_org, regenerated with its missing deletes ─────
-- Found while writing part 1, by asking the catalogue which org_id tables
-- the purge body names: THIRTEEN tables were missing — the whole M41
-- workflow family (0104), mail_draft (0114), meeting_prep (0116),
-- role_capability, agent_workflow, and the six task tables from 0144.
-- Every one carries a NO ACTION foreign key to echo.org, so the purge
-- RAISES for any org that ever used workflows, mail drafts, meeting prep
-- or the task board — "a purge that raises is a purge that does not run,
-- on the one path where failing to delete is the worst outcome" (0132's
-- own sentence, and this is the same defect one wave later: the function
-- enumerates, and nothing made a new table report for enumeration).
--
-- The instrument that ends the class ships WITH this migration: the
-- coverage check at the foot (and its standing twin in db/test) derives
-- the table list from the CATALOGUE — every echo table carrying org_id
-- must be named in the purge body or in the exceptions list, each
-- exception with its reason. Rule 13½: derive the coverage list from the
-- producer, never hand-enumerate.
--
-- One cycle to break: workflow.current_version_id → workflow_version →
-- workflow. The pointer is nullable, so the purge nulls it first.

begin;

-- ── the meeting table ────────────────────────────────────────────────────
create table echo.meeting (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references echo.org(id),
  title            text not null check (length(trim(title)) between 1 and 300),
  scheduled_at     timestamptz not null,
  duration_minutes integer check (duration_minutes between 1 and 1440),
  -- the reference's three holding modes; online = the recorder's system source
  mode             text not null default 'in_person'
                   check (mode in ('upload', 'in_person', 'online')),
  topic            text check (length(topic) <= 120),
  location         text check (length(location) <= 300),
  description      text not null default '' check (length(description) <= 8000),
  -- names or addresses as typed — deliberately NOT app_user FKs: the member
  -- directory is admin-gated, and a picker members cannot populate would
  -- lie; an invitee may also be outside the platform entirely
  invitees         text[] not null default '{}',
  -- [{title, minutes}] — the pre-meeting plan; shape asserted, content free
  agenda           jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(agenda) = 'array'),
  call_id          uuid,
  archived_at      timestamptz,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint meeting_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  constraint meeting_call_org
    foreign key (call_id, org_id) references echo.call (id, org_id)
    on delete set null
);

create index meeting_org_when_idx on echo.meeting (org_id, scheduled_at)
  where archived_at is null;
create index meeting_call_idx on echo.meeting (call_id) where call_id is not null;

comment on table echo.meeting is
  'Scheduled meetings (0145, the reference adoption). Org-shared like the task board; mode ''online'' maps to the recorder''s system-audio source; call_id is the record the meeting produced (SET NULL — a purged call never takes the plan). Archived, never deleted.';

alter table echo.meeting enable row level security;
alter table echo.meeting force row level security;

create policy meeting_read on echo.meeting
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy meeting_insert on echo.meeting
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());
create policy meeting_update on echo.meeting
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id());

grant select, insert, update on echo.meeting to echo_app;

-- ── platform_purge_org, regenerated ──────────────────────────────────────
-- The 0132 body verbatim (verified byte-equal to the live definition before
-- this file was written), plus the block of missing deletes at the head of
-- the delete list — children before parents inside each family; the block
-- as a whole references the old list's tables only through SET NULL or
-- CASCADE edges, so head placement is safe.

CREATE OR REPLACE FUNCTION echo.platform_purge_org(p_actor uuid, p_org uuid, p_reason text)
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

  -- sever the ledger's references AND declare why (0084): the rows stay,
  -- their subject is gone, and target_purged is the named reason
  update echo.platform_audit
     set target_user_id = null, target_purged = true
   where target_user_id in (select id from echo.app_user where org_id = p_org);
  update echo.platform_audit
     set target_org_id = null, target_purged = true
   where target_org_id = p_org;

  -- 0145: the thirteen tables this function never learned (M41 workflows,
  -- M43 mail drafts, M44 meeting prep, role_capability, agent_workflow,
  -- the 0144 task board) plus 0145's own meeting table. Children first;
  -- the workflow<->workflow_version cycle breaks by nulling the pointer.
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
  delete from echo.task_comment           where org_id = p_org;
  delete from echo.task_checklist_item    where org_id = p_org;
  delete from echo.task_assignee          where org_id = p_org;
  delete from echo.task                   where org_id = p_org;
  delete from echo.task_column            where org_id = p_org;
  delete from echo.task_topic             where org_id = p_org;
  delete from echo.mail_draft             where org_id = p_org;
  delete from echo.meeting_prep           where org_id = p_org;
  delete from echo.role_capability        where org_id = p_org;
  delete from echo.meeting                where org_id = p_org;

  -- 0132: the two deletes for the removed outbound-delivery feature stood
  -- here. They are named in this file's header, not here — the check at the
  -- foot asserts this body mentions that feature NOWHERE, and it fired on
  -- its first run against an earlier version of this very comment, which
  -- spelled the table names. An absolute check that cannot rot is worth
  -- more than a comment that repeats what the header already says.
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
$function$;

-- ── self-checks ──────────────────────────────────────────────────────────
do $check$
declare
  v_def     text;
  v_args    integer;
  v_missing text;
begin
  select p.pronargs into strict v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if v_args <> 3 then
    raise exception 'platform_purge_org should take 3 arguments, found %', v_args;
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo' and p.proname = 'platform_purge_org') <> 1 then
    raise exception 'platform_purge_org has an overload — the wrong signature was installed beside the right one';
  end if;

  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  -- COVERAGE, derived from the catalogue (the instrument this migration
  -- exists to install): every echo table carrying org_id is deleted by the
  -- purge, or stands in the exceptions list WITH its reason.
  --   · deletion_record — ON DELETE CASCADE to org by design: the record
  --     of member deletions outlives everything except the org itself,
  --     and dies exactly when the org does.
  select string_agg(t.relname, ', ' order by t.relname) into v_missing
    from (
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
       where n.nspname = 'echo' and c.relkind = 'r'
         and a.attname = 'org_id' and not a.attisdropped
         and c.relname not in ('deletion_record')
    ) t
   where v_def !~ ('delete from echo\.' || t.relname || '\s');
  if v_missing is not null then
    raise exception 'platform_purge_org does not delete: % — a purge that raises is a purge that does not run', v_missing;
  end if;

  if v_def ~ 'webhook' then
    raise exception 'platform_purge_org still mentions a webhook';
  end if;
end
$check$;

commit;
