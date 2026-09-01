-- 0147 — the task board's remaining depth, taken from the reference itself
-- (user directive, 2026-09-01: "do the same for tasks too, it has details and
-- deeps, get everything for it"). Walked in their product, feature by
-- feature, before a line was written:
--
--   · LABELS are org-level entities, not free text: the reference's new-task
--     dialog lists برچسب‌ها as chips with a COLOUR and a pencil that renames
--     or recolours them everywhere at once. 0144's `task.labels text[]` can
--     hold names and cannot hold that — renaming a label would have to
--     rewrite every row that ever used it, and two rows could disagree about
--     its colour. So: a table, and a link table.
--   · HISTORY is a real tab («تاریخچه ۲» beside «نظرها»), rendering rows like
--     «سینا تسک را انجام‌شده کرد · ۴۱ دقیقه پیش». That is an append-only
--     event log, and it cannot be derived from the task's current state:
--     "who moved this, and when" is exactly what the current state has
--     forgotten.
--   · COLUMN COLOURS: their column header carries «تغییر رنگ ستون». 0144's
--     four tones are too few for a board a team arranges, so the closed set
--     widens — closed still, because a free colour is how a board stops
--     matching the theme.
--
-- The old `task.labels` column STAYS for now and is left unread: dropping a
-- column in the same migration that replaces it turns one reversible step
-- into two irreversible ones, and nothing writes it any more. It goes in a
-- later migration once the api has run without it.

begin;

-- ── labels ───────────────────────────────────────────────────────────────
create table echo.task_label (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references echo.org(id),
  name       text not null check (length(trim(name)) between 1 and 40),
  -- a CLOSED tone set: the chips must stay on the theme's palette, and a
  -- hex column is how a board ends up with eleven greens
  color      text not null default 'grey'
             check (color in ('grey', 'blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint task_label_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id)
);

create unique index task_label_org_name_idx
  on echo.task_label (org_id, lower(trim(name)));

comment on table echo.task_label is
  'Task labels (0147): org-level entities with a closed tone set — renaming or recolouring one changes every card that wears it, which is the whole reason this is a table and not a text[] on the task.';

-- ── the link ─────────────────────────────────────────────────────────────
create table echo.task_label_link (
  task_id  uuid not null references echo.task(id),
  label_id uuid not null references echo.task_label(id),
  org_id   uuid not null references echo.org(id),
  added_at timestamptz not null default now(),
  primary key (task_id, label_id)
);

create index task_label_link_label_idx on echo.task_label_link (label_id);

comment on table echo.task_label_link is
  'Which labels a card wears (0147). DELETE is granted — the call_note class again: taking a label off a card is editing the card, and a removed-flag would be a second spelling of absence every count must remember to exclude.';

-- ── history ──────────────────────────────────────────────────────────────
create table echo.task_event (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references echo.task(id),
  org_id     uuid not null references echo.org(id),
  actor_id   uuid not null,
  -- a CLOSED vocabulary: the reader renders a sentence per kind, and an
  -- unknown kind would render as nothing at all
  kind       text not null check (kind in (
               'created', 'done', 'undone', 'moved', 'renamed', 'priority',
               'due_set', 'due_cleared', 'assigned', 'unassigned',
               'label_added', 'label_removed', 'archived', 'restored')),
  -- codes and NAMES only, never a description's contents (the audit rule:
  -- a log that quotes the body becomes a second copy of the body)
  detail     jsonb not null default '{}'::jsonb
             check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  constraint task_event_actor_org
    foreign key (actor_id, org_id) references echo.app_user (id, org_id)
);

create index task_event_task_idx on echo.task_event (task_id, created_at desc);

comment on table echo.task_event is
  'The card''s history (0147) — append-only: no UPDATE and no DELETE for any app role. "Who moved this and when" is precisely what the current row has forgotten, so it cannot be derived and must be written down.';

-- ── the column tone set widens ───────────────────────────────────────────
alter table echo.task_column drop constraint task_column_tone_check;
alter table echo.task_column add constraint task_column_tone_check
  check (tone in ('grey', 'blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink'));

-- ── the wall ─────────────────────────────────────────────────────────────
alter table echo.task_label       enable row level security;
alter table echo.task_label       force  row level security;
alter table echo.task_label_link  enable row level security;
alter table echo.task_label_link  force  row level security;
alter table echo.task_event       enable row level security;
alter table echo.task_event       force  row level security;

create policy task_label_rw on echo.task_label
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

create policy task_label_link_rw on echo.task_label_link
  for all to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy task_event_read on echo.task_event
  for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy task_event_insert on echo.task_event
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and actor_id = echo.actor_id());

-- grants: DELETE only where the header argues for it; the event log takes
-- neither UPDATE nor DELETE — an edited history is not a history
grant select, insert, update, delete on echo.task_label      to echo_app;
grant select, insert, delete         on echo.task_label_link to echo_app;
grant select, insert                 on echo.task_event      to echo_app;

-- ── the purge learns the three new tables (0145's instrument would fail
--    this migration otherwise, which is exactly what it is for) ──────────
create or replace function echo.platform_purge_org(p_actor uuid, p_org uuid, p_reason text)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  delete from echo.meeting                where org_id = p_org;

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

-- ── self-checks ──────────────────────────────────────────────────────────
do $check$
declare
  v_def     text;
  v_missing text;
  bad       int;
begin
  -- the append-only rules, by GRANT rather than by convention
  if exists (
    select 1 from information_schema.role_table_grants
     where grantee = 'echo_app' and table_schema = 'echo'
       and table_name = 'task_event' and privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception 'task_event gained UPDATE or DELETE — an edited history is not a history';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where grantee = 'echo_agent' and table_schema = 'echo'
       and table_name like 'task%'
  ) then
    raise exception 'echo_agent reached the task tables without a decision';
  end if;

  select count(*) into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relname like 'task%' and c.relkind = 'r'
     and not (c.relrowsecurity and c.relforcerowsecurity);
  if bad > 0 then
    raise exception 'a task table is missing enabled+forced RLS';
  end if;

  -- 0145's coverage rule, re-run here: every org-scoped table is purged
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
    raise exception 'platform_purge_org does not delete: %', v_missing;
  end if;
end
$check$;

commit;
