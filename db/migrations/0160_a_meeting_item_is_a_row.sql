-- 0160 — an action item is a row, not a paragraph
--
-- User directive, 2026-09-02: "for action items and questions and risks and
-- entities make it like this that user can add edit and remove them like the
-- images — it does not need for AI to make them, the AI can add it as well
-- like the user if its asked to".
--
-- WHY THIS IS A MIGRATION AND NOT A COMPONENT CHANGE. Until today those five
-- panels were SLICES OF THE SUMMARY'S PROSE: `Review.tsx` parsed the summary
-- body, matched headings against a regex, and rendered the paragraphs under
-- each. That design can only ever be read-only, and not because nobody wrote
-- the buttons — because there is nothing to edit. "Delete this action item"
-- against a slice of prose means rewriting a model's paragraph and hoping the
-- headings still line up. A thing a person is meant to tick, reword and
-- remove is a ROW, and it was never going to be anything else.
--
-- It also fixes the honest complaint underneath the directive ("the action
-- item and decisions are empty"): they were empty because they are derived
-- from a summary, and a summary only exists after a recording is processed.
-- A person who wants to write down a decision BEFORE the audio is ready had
-- no way to, and the screen could not tell them why.
--
-- THE WALL, and the part worth reading twice. `source` is not a column the
-- caller fills in. echo_app may only ever insert 'user'; echo_agent may only
-- ever insert 'ai'; and echo_agent holds INSERT and NOTHING ELSE. So:
--
--     the assistant can add an item, and cannot edit or remove one.
--
-- That sentence is a grant, not a prompt (M43's rule, applied to a second
-- surface). "The AI rewrote my decision" is not a bug we have to test for; it
-- is a state the database refuses. And the provenance badge on screen is a
-- fact about which role wrote the row, so it cannot lie either.
--
-- `at_ms` is the moment in the recording an item came from — nullable,
-- because a person typing one in the plan stage is not at a moment. A click
-- on it seeks the audio there, which is only meaningful for the ones that
-- have one; the two states are different and the column says which.

create table echo.meeting_item (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references echo.meeting(id) on delete cascade,
  -- denormalised for the purge, exactly as 0159 argued: a purge that has to
  -- join to find its own rows breaks the day the join changes
  org_id      uuid not null references echo.org(id),
  kind        text not null check (kind in ('decision','action','question','risk','entity')),
  body        text not null check (length(trim(body)) between 1 and 2000),
  -- WHO SAID SO. Not supplyable: the policies below pin it per role.
  source      text not null check (source in ('user','ai')),
  -- an action item can be ticked; the other four kinds ignore it
  done        boolean not null default false,
  -- free text on purpose: an owner may be an invitee who has no row here,
  -- which is the same reason `meeting.invitees` is text (0145)
  owner       text check (owner is null or length(trim(owner)) between 1 and 120),
  -- the moment in the recording, when there is one
  at_ms       integer check (at_ms is null or at_ms >= 0),
  position    integer not null default 0,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint meeting_item_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id)
);

create index meeting_item_meeting_idx on echo.meeting_item (meeting_id, kind, position);
create index meeting_item_org_idx on echo.meeting_item (org_id);

comment on table echo.meeting_item is
  'Decisions, action items, questions, risks and entities as ROWS (0160). '
  'source is pinned by ROLE, not supplied: echo_app writes user, echo_agent '
  'writes ai and holds insert only — the assistant can add an item and can '
  'never edit or remove one.';

alter table echo.meeting_item enable row level security;
alter table echo.meeting_item force row level security;

-- READ: whoever can see the meeting, expressed as a read THROUGH the
-- meeting's own policies (0159's shape) so this table can never be more
-- visible than the thing it hangs off.
create policy meeting_item_read on echo.meeting_item
  for select using (
    exists (select 1 from echo.meeting m where m.id = meeting_id)
  );

create policy meeting_item_insert on echo.meeting_item
  for insert to echo_app with check (
    created_by = echo.actor_id()
    and org_id = echo.actor_org_id()
    and source = 'user'
    and exists (select 1 from echo.meeting m where m.id = meeting_id)
  );

create policy meeting_item_update on echo.meeting_item
  for update to echo_app using (
    exists (select 1 from echo.meeting m where m.id = meeting_id)
  ) with check (
    -- an edit may change the words and the tick; it may not relabel who said
    -- it, move it to another meeting, or hand it to another organisation
    org_id = echo.actor_org_id()
    and exists (select 1 from echo.meeting m where m.id = meeting_id)
  );

create policy meeting_item_delete on echo.meeting_item
  for delete to echo_app using (
    exists (select 1 from echo.meeting m where m.id = meeting_id)
  );

-- THE AGENT'S HALF: one policy, insert only, source forced.
create policy meeting_item_agent_insert on echo.meeting_item
  for insert to echo_agent with check (
    source = 'ai'
    and created_by = echo.actor_id()
    and org_id = echo.actor_org_id()
    and exists (select 1 from echo.meeting m where m.id = meeting_id)
  );

grant select, insert, update, delete on echo.meeting_item to echo_app;
grant select, insert on echo.meeting_item to echo_agent;

-- `source` must not drift on an UPDATE either. A policy predicate could say
-- so, but it would be one more thing running as the caller; a trigger is the
-- altitude the promise is made at, and it holds for every role at once.
create or replace function echo.tg_meeting_item_immutable()
  returns trigger language plpgsql
  set search_path = '' as $$
begin
  if new.source is distinct from old.source then
    raise exception 'meeting_item.source is a fact about who wrote the row and cannot be changed'
      using errcode = 'check_violation';
  end if;
  if new.meeting_id is distinct from old.meeting_id then
    raise exception 'a meeting item cannot be moved to another meeting'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger meeting_item_immutable
  before update on echo.meeting_item
  for each row execute function echo.tg_meeting_item_immutable();

-- ── the purge learns the table ─────────────────────────────────────────────
-- REGENERATED FROM THE CATALOGUE, not retyped — 0159's note, and the reason
-- for it, apply unchanged: `create or replace` is not a diff, and a body four
-- revisions old installs as cheerfully as a current one.
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
  -- 0160: the meeting's decisions, action items, questions, risks and
  -- entities. They cascade from the meeting too, but the purge deletes by
  -- ORGANISATION and this table carries a NO ACTION link to echo.org — the
  -- exact shape that made the purge raise for thirteen tables in 0145.
  delete from echo.meeting_item          where org_id = p_org;
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

-- ── self-checks ────────────────────────────────────────────────────────────
do $$
declare
  v_org    uuid;
  v_person uuid := gen_random_uuid();
  v_meet   uuid;
  v_item   uuid;
  v_failed text;
begin
  -- 1) the purge knows the table. The standing instrument (test/102) derives
  --    this from the catalogue every run; this one catches it at APPLY time,
  --    which is the moment the mistake is cheapest to fix.
  if position('delete from echo.meeting_item' in
       (select pg_get_functiondef(p.oid)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'echo' and p.proname = 'platform_purge_org')) = 0
  then
    raise exception 'CHECK FAILED: platform_purge_org does not delete echo.meeting_item';
  end if;

  -- 2) THE WALL, stated as grants. This is the sentence the whole migration
  --    exists to make true, so it is asserted in both directions: what the
  --    agent HAS, and what it must never have.
  if not has_table_privilege('echo_agent', 'echo.meeting_item', 'insert') then
    v_failed := 'echo_agent cannot add an item (it is meant to be able to)';
  elsif has_table_privilege('echo_agent', 'echo.meeting_item', 'update') then
    v_failed := 'echo_agent can EDIT a meeting item';
  elsif has_table_privilege('echo_agent', 'echo.meeting_item', 'delete') then
    v_failed := 'echo_agent can DELETE a meeting item';
  end if;
  if v_failed is not null then raise exception 'CHECK FAILED: %', v_failed; end if;

  insert into echo.org (name, locale) values ('probe-0160', 'fa') returning id into v_org;
  insert into auth.users (id, email) values (v_person, 'probe-0160@example.test')
    on conflict (id) do nothing;
  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (v_person, v_org, 'probe-0160@example.test', 'probe', 'owner', 'active');
  insert into echo.meeting (org_id, title, scheduled_at, created_by)
  values (v_org, 'probe meeting', now(), v_person) returning id into v_meet;

  insert into echo.meeting_item (meeting_id, org_id, kind, body, source, created_by)
  values (v_meet, v_org, 'action', 'probe action', 'user', v_person)
  returning id into v_item;

  -- 3) an edit may change the words; it may not change WHO SAID SO. The
  --    trigger is what makes the provenance badge on screen unable to lie,
  --    and it is enforced for every role at once — a policy predicate would
  --    only bind the roles it happens to be written for.
  begin
    update echo.meeting_item set source = 'ai' where id = v_item;
    raise exception 'CHECK FAILED: a meeting item''s source could be rewritten';
  exception when check_violation then
    null;
  end;

  -- ... and the ordinary edit still works, which is the half that is the
  -- product (rule 7's authorization-matrix corollary: asserting the refusal
  -- leaves the permitted path unproven)
  update echo.meeting_item set body = 'edited', done = true where id = v_item;
  if not exists (select 1 from echo.meeting_item
                  where id = v_item and body = 'edited' and done) then
    raise exception 'CHECK FAILED: an ordinary edit did not apply';
  end if;

  -- 4) the items die with their meeting
  delete from echo.meeting where id = v_meet;
  if exists (select 1 from echo.meeting_item where meeting_id = v_meet) then
    raise exception 'CHECK FAILED: an item outlived its meeting';
  end if;

  raise notice '0160 self-checks passed';
  raise exception 'rollback the probe' using errcode = 'restrict_violation';
exception when restrict_violation then
  null;
end;
$$;
