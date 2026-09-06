-- 0201 — a translation is a row: the transcript's translation, prepared by
-- the transcriber, stored beside the record (2026-09-06; user directive:
-- "run translate_record through Soniox instead of a language model").
--
-- Until today a transcript's translation was a language-model call whose
-- text lived only in the page that asked for it — re-clicking re-ran the
-- model, nothing was kept, and the model saw text rather than audio. The
-- transcriber translates the AUDIO (one pass, transcription and one-way
-- translation together), which takes minutes for a long record, so the
-- request becomes a job and the answer becomes rows:
--
--   · echo.call_translation      — one request per (call, language): its
--                                  status (queued → ready | failed), who
--                                  asked, when it finished, why it failed.
--   · echo.transcript_translation — one translated text per (line, language),
--                                  hanging from the line (cascade: a line
--                                  that goes takes its translations).
--
-- THE WALL DID NOT MOVE. Both tables answer to the call's own readers
-- (echo.can_read_call), a request may be made by anyone who can READ the
-- call (a reader wants the translation; it changes nothing about the
-- record), and only the call's OWNER — the identity the worker runs as —
-- writes the rows and moves the status. The agent role reads and never
-- writes; the purge role deletes and nothing else. The transcript stays the
-- single source of truth: a translation is a derived artifact with its
-- provenance in the row (the provider's model), rebuildable by asking again.
--
-- The queue `echo_translate` carries the job (pgmq, like 0104's), and the
-- purge learns both tables in the same transaction — regenerated from the
-- catalogue's own definition, never retyped (0132; the coverage check at
-- the foot and db/test/102 would refuse a purge that forgot either).

begin;

-- ── the request ──────────────────────────────────────────────────────────
create table echo.call_translation (
  call_id       uuid not null references echo.call(id) on delete cascade,
  language      text not null
    constraint call_translation_language_is_a_tag check (language ~ '^[a-z]{2,3}$'),
  org_id        uuid not null references echo.org(id),
  status        text not null default 'queued'
    constraint call_translation_status_known check (status in ('queued', 'ready', 'failed')),
  requested_by  uuid references echo.app_user(id) on delete set null,
  requested_at  timestamptz not null default now(),
  finished_at   timestamptz,
  error_type    text,
  -- what produced the rows: the provider's model name (invariant 4)
  model         text,
  primary key (call_id, language)
);

comment on table echo.call_translation is
  'a transcript translation REQUEST per (call, language): queued when asked, ready when the transcriber''s rows landed, failed with an error type otherwise; readers of the call read it, only the owner (the worker) moves it';

create index call_translation_org_idx on echo.call_translation (org_id);

-- ── the rows ─────────────────────────────────────────────────────────────
create table echo.transcript_translation (
  segment_id    uuid not null references echo.transcript_segment(id) on delete cascade,
  language      text not null
    constraint transcript_translation_language_is_a_tag check (language ~ '^[a-z]{2,3}$'),
  call_id       uuid not null references echo.call(id) on delete cascade,
  org_id        uuid not null references echo.org(id),
  text          text not null,
  created_at    timestamptz not null default now(),
  primary key (segment_id, language)
);

comment on table echo.transcript_translation is
  'one translated text per (line, language), as the transcriber prepared it from the audio; hangs from the line, read by the call''s readers, written by the owner''s job';

create index transcript_translation_call_idx on echo.transcript_translation (call_id, language);
create index transcript_translation_org_idx on echo.transcript_translation (org_id);

-- ── the wall ─────────────────────────────────────────────────────────────
alter table echo.call_translation enable row level security;
alter table echo.call_translation force row level security;
alter table echo.transcript_translation enable row level security;
alter table echo.transcript_translation force row level security;

-- readers of the call read both
create policy call_translation_read on echo.call_translation for select to echo_app, echo_agent
  using (echo.can_read_call(call_id));
create policy transcript_translation_read on echo.transcript_translation for select to echo_app, echo_agent
  using (echo.can_read_call(call_id));

-- a reader may ASK; the owner's job moves the status and writes the lines
create policy call_translation_request on echo.call_translation for insert to echo_app
  with check (echo.can_read_call(call_id) and org_id = echo.actor_org_id());
create policy call_translation_progress on echo.call_translation for update to echo_app
  using (echo.owns_call(call_id) or echo.can_read_call(call_id))
  with check (echo.can_read_call(call_id) and org_id = echo.actor_org_id());
create policy transcript_translation_write on echo.transcript_translation for insert to echo_app
  with check (echo.owns_call(call_id) and org_id = echo.actor_org_id());
create policy transcript_translation_rewrite on echo.transcript_translation for update to echo_app
  using (echo.owns_call(call_id)) with check (echo.owns_call(call_id));

-- the purge role, exactly as the transcript's rows (0013)
create policy call_translation_purge_read on echo.call_translation for select to echo_purge
  using (echo.call_is_purgeable(call_id));
create policy call_translation_purge_delete on echo.call_translation for delete to echo_purge
  using (echo.call_is_purgeable(call_id));
create policy transcript_translation_purge_read on echo.transcript_translation for select to echo_purge
  using (echo.call_is_purgeable(call_id));
create policy transcript_translation_purge_delete on echo.transcript_translation for delete to echo_purge
  using (echo.call_is_purgeable(call_id));

grant select, insert, update on echo.call_translation to echo_app;
grant select on echo.call_translation to echo_agent;
grant select, delete on echo.call_translation to echo_purge;
grant select, insert, update on echo.transcript_translation to echo_app;
grant select on echo.transcript_translation to echo_agent;
grant select, delete on echo.transcript_translation to echo_purge;

-- ── the queue ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'pgmq absent on this server — echo_translate not created here';
    return;
  end if;
  if not exists (
    select 1 from pgmq.list_queues() where queue_name = 'echo_translate'
  ) then
    perform pgmq.create('echo_translate');
  end if;
end;
$$;

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

  -- coverage, derived from the catalogue (0145's instrument): every echo
  -- table carrying org_id is deleted by the purge, or stands in the
  -- exceptions list with its reason (deletion_record — cascades from org
  -- by design).
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
  -- the two of this migration, by name, so a regenerated body that lost
  -- them cannot pass on the exceptions list alone
  if v_def !~ 'delete from echo\.transcript_translation\s' or v_def !~ 'delete from echo\.call_translation\s' then
    raise exception '0201: platform_purge_org does not name both translation tables';
  end if;

  -- the wall: RLS forced on both, and the agent role holds no write
  if not (select relforcerowsecurity from pg_class where oid = 'echo.call_translation'::regclass)
     or not (select relforcerowsecurity from pg_class where oid = 'echo.transcript_translation'::regclass) then
    raise exception '0201: row security is not FORCED on a translation table';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'echo' and table_name in ('call_translation', 'transcript_translation')
       and grantee = 'echo_agent' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception '0201: the agent role may write a translation';
  end if;
end
$check$;

commit;
