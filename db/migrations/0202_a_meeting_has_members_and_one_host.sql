-- 0202 — a meeting's members are MEMBERS, and the recording is the host's
-- (user directive, 2026-09-06: "for the meetings only the host should have
-- the ability to start the recording and share the screen for audio, and only
-- the host must have the ability to finish it, and after it finishes the
-- session should be closed for all — no, all that come to the meeting have
-- the ability to get it for themselves as well and it's a bug"; and "when
-- someone invites you to the meeting, like the invitation for chat, it must
-- come in the notification with the accept or reject button"; and "those
-- names are useless — the username and member name in user management should
-- be used").
--
-- ── part 1: who is coming, as ROWS ──────────────────────────────────────
--
-- `meeting.invitees` is a text[] and 0145 wrote the reason down: an invitee
-- outside the platform has no row to point at. That reasoning is still right
-- and it was applied to everybody, so a COLLEAGUE was stored as a string too
-- — whatever string the surface that added them happened to have. The
-- attendee panel of a real meeting reads «drbagheri», «دکتر باقری», «Sina
-- Sepasi»: one member twice under two spellings, beside another. A name is
-- not an identity, and every screen that wanted to say who was coming had to
-- guess which of the two it was looking at.
--
-- So a MEMBER is a row here, keyed by their account, and their name is read
-- from user management at the moment it is shown — a rename reaches every
-- meeting, and a person appears once. `invitees` keeps exactly what it was
-- justified for: the people with no account.
--
-- `attended_at` is a different fact from being invited, and it is the one
-- the transcript needs: who was actually in the room. Only the person
-- themselves may stamp it — attendance recorded by somebody else is a claim
-- about a person made by another, and it is unrepresentable rather than
-- forbidden.
--
-- ── part 2: the recording belongs to the host ───────────────────────────
--
-- Every active member could link a call to a meeting, so everyone who opened
-- one could start their own recording of it and hand it to the meeting —
-- which is the bug as reported. The wall is a TRIGGER rather than a narrower
-- update policy, because the narrowing is about ONE COLUMN and the rest of
-- the row is deliberately org-editable (0145: anybody may reschedule).
--
-- It refuses only while an actor is set. A purged call nulls this column
-- through 0145's `set null` FK, with no actor and nobody to refuse — and a
-- trigger that raised there would break the purge on exactly the path where
-- failing to delete is the worst outcome (0132's sentence, and 0188's shape:
-- a constraint that reads as deliberate and can only ever raise).

begin;

-- ── the members of a meeting ─────────────────────────────────────────────
create table echo.meeting_attendee (
  meeting_id  uuid not null,
  user_id     uuid not null,
  org_id      uuid not null references echo.org(id),
  added_by    uuid not null,
  created_at  timestamptz not null default now(),
  /* stamped when they opened the meeting while it was being held — "who was
     in the room", which the transcript's speaker roster reads */
  attended_at timestamptz,
  primary key (meeting_id, user_id),
  constraint meeting_attendee_meeting
    foreign key (meeting_id, org_id) references echo.meeting (id, org_id) on delete cascade,
  constraint meeting_attendee_user
    foreign key (user_id, org_id) references echo.app_user (id, org_id),
  constraint meeting_attendee_author
    foreign key (added_by, org_id) references echo.app_user (id, org_id)
);

create index meeting_attendee_by_user on echo.meeting_attendee (user_id, meeting_id);

comment on table echo.meeting_attendee is
  'the MEMBERS on a meeting, by account (0202). Their name is read from app_user when it is shown, so a rename reaches every meeting and one person appears once; meeting.invitees keeps the people with no account. attended_at = they were actually in the room.';

alter table echo.meeting_attendee enable row level security;
alter table echo.meeting_attendee force row level security;

/* WHO IS COMING is part of the meeting, and the meeting is org-readable
   (0145) — so this is too. */
create policy meeting_attendee_read on echo.meeting_attendee
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

/* ADDING somebody is not an administrative act — 0189's insert policy says
   the same thing about inviting to a meeting, and the meeting's own update
   policy lets any active member edit who is on it. One rule, not two. */
create policy meeting_attendee_add on echo.meeting_attendee
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and added_by = echo.actor_id());
create policy meeting_attendee_remove on echo.meeting_attendee
  for delete to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

/* YOUR OWN ATTENDANCE. Both halves name the actor, so stamping somebody
   else's presence is unrepresentable rather than checked for. */
create policy meeting_attendee_attend on echo.meeting_attendee
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active()
         and user_id = echo.actor_id())
  with check (org_id = echo.actor_org_id() and user_id = echo.actor_id());

create policy meeting_attendee_purge_read on echo.meeting_attendee
  for select to echo_purge using (true);
create policy meeting_attendee_purge_delete on echo.meeting_attendee
  for delete to echo_purge using (true);

grant select, insert, update, delete on echo.meeting_attendee to echo_app;
grant select on echo.meeting_attendee to echo_agent;
grant select, delete on echo.meeting_attendee to echo_purge;

-- ── the recording is the host's ──────────────────────────────────────────
create function echo.tg_meeting_recording_is_the_hosts() returns trigger
  language plpgsql
  set search_path = ''
as $fn$
begin
  if new.call_id is distinct from old.call_id
     and echo.actor_id() is not null
     and echo.actor_id() is distinct from old.created_by then
    raise exception 'only the meeting''s host may link or unlink its recording'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$fn$;

comment on function echo.tg_meeting_recording_is_the_hosts() is
  '0202: meeting.call_id moves only under the host''s own identity. Silent when no actor is set — that is the purge''s FK nulling a purged call, which must never raise.';

create trigger tg_meeting_recording_is_the_hosts
  before update on echo.meeting
  for each row execute function echo.tg_meeting_recording_is_the_hosts();

-- ── the purge, regenerated from the catalogue's own definition ───────────
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

  update echo.platform_audit
     set target_user_id = null, target_purged = true
   where target_user_id in (select id from echo.app_user where org_id = p_org);
  update echo.platform_audit
     set target_org_id = null, target_purged = true
   where target_org_id = p_org;

  -- the agent rooms (0164), children first








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
  delete from echo.task_recurrence        where org_id = p_org;
  delete from echo.task_column            where org_id = p_org;
  delete from echo.task_topic             where org_id = p_org;
  delete from echo.chat_reaction          where org_id = p_org;
  delete from echo.join_invite            where org_id = p_org;
  delete from echo.chat_mention           where org_id = p_org;
  delete from echo.chat_message           where org_id = p_org;
  delete from echo.chat_channel_member    where org_id = p_org;
  delete from echo.chat_channel           where org_id = p_org;
  delete from echo.project_member         where org_id = p_org;
  delete from echo.project                where org_id = p_org;
  delete from echo.mail_draft             where org_id = p_org;
  delete from echo.meeting_prep           where org_id = p_org;
  delete from echo.role_capability        where org_id = p_org;
  -- 0160: the meeting's decisions, action items, questions, risks and
  -- entities. They cascade from the meeting too, but the purge deletes by
  -- ORGANISATION and this table carries a NO ACTION link to echo.org — the
  -- exact shape that made the purge raise for thirteen tables in 0145.
  delete from echo.meeting_item          where org_id = p_org;
  -- 0159: the attachment ROWS. Their OBJECTS are removed first by the purge
  -- job, which finds them through platform_meeting_storage_paths — "the row
  -- is the map to the object; delete the map last".
  delete from echo.meeting_attachment     where org_id = p_org;
  -- 0202: the meeting's members, before the meetings they hang from
  delete from echo.meeting_attendee       where org_id = p_org;
  delete from echo.meeting                where org_id = p_org;
  delete from echo.meeting_topic          where org_id = p_org;

  -- 0201: a line's translations, before the lines they hang from
  delete from echo.transcript_translation where org_id = p_org;
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
  -- 0201: the translation requests, before the calls they name
  delete from echo.call_translation       where org_id = p_org;
  delete from echo.call                   where org_id = p_org;
  delete from echo.app_user               where org_id = p_org;
  delete from echo.org                    where id = p_org;

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
  v_missing text;
begin
  -- the wall is FORCED, and the agent role holds no write
  if not (select relforcerowsecurity from pg_class where oid = 'echo.meeting_attendee'::regclass) then
    raise exception '0202: row security is not FORCED on meeting_attendee';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'echo' and table_name = 'meeting_attendee'
       and grantee = 'echo_agent' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception '0202: the agent role may write a meeting attendee';
  end if;

  -- the trigger exists and is BEFORE UPDATE on the meeting
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'meeting' and t.tgname = 'tg_meeting_recording_is_the_hosts'
       and not t.tgisinternal
  ) then
    raise exception '0202: the host-only recording trigger is not installed';
  end if;

  -- purge coverage, derived from the catalogue (0145's instrument)
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
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
  if v_def !~ 'delete from echo\.meeting_attendee\s' then
    raise exception '0202: platform_purge_org does not name meeting_attendee';
  end if;
end
$check$;

commit;
