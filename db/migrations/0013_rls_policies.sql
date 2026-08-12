-- Echo — 0013: row level security. The wall (M3).
--
-- Read this file as the definition of who may see what; core/'s WHERE clauses
-- are the normal path, and these policies are what catches every bug in it.
--
-- Two conventions throughout:
--   * every policy requires echo.actor_is_active() somewhere in its chain, so
--     a pending or disabled person, or anyone in a suspended org, sees
--     nothing at all (M15);
--   * a NULL identity fails every predicate. No identity, no rows (invariant 2).
--
-- FORCE ROW LEVEL SECURITY on every table: policies apply even to the table
-- owner. Superusers still bypass, which is why core/ never connects as one.

-- Purgeability, for the echo_purge policies below.
create function echo.call_is_purgeable(target_call uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from echo.call c
    where c.id = target_call
      and c.deleted_at is not null
      and c.purge_after <= now()
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'org', 'app_user', 'call', 'call_part', 'person', 'call_speaker',
    'transcript_segment', 'skill', 'agent_run', 'summary',
    'api_key', 'webhook', 'webhook_delivery', 'admin_action'
  ] loop
    execute format('alter table echo.%I enable row level security', t);
    execute format('alter table echo.%I force  row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- org
-- ---------------------------------------------------------------------------

create policy org_read on echo.org for select to echo_app, echo_agent
  using (id = echo.actor_org_id() and echo.actor_is_active());

create policy org_admin_update on echo.org for update to echo_app
  using      (id = echo.actor_org_id() and echo.actor_is_admin())
  with check (id = echo.actor_org_id() and echo.actor_is_admin());

-- No INSERT policy: orgs are created only by echo.register_account() (0015),
-- the one narrow, fixed-shape path that runs before an identity exists.

-- ---------------------------------------------------------------------------
-- app_user
--
-- A pending person may read their own row — that is how the UI can say
-- "waiting for approval" — and nothing else anywhere.
-- ---------------------------------------------------------------------------

create policy app_user_read on echo.app_user for select to echo_app, echo_agent
  using (
    id = echo.actor_id()
    or (org_id = echo.actor_org_id() and echo.actor_is_active())
  );

create policy app_user_write on echo.app_user for update to echo_app
  using (
    id = echo.actor_id()
    or (org_id = echo.actor_org_id() and echo.actor_is_admin())
  )
  with check (
    id = echo.actor_id()
    or (org_id = echo.actor_org_id() and echo.actor_is_admin())
  );

create policy app_user_admin_insert on echo.app_user for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin());

-- ---------------------------------------------------------------------------
-- call — SPEC's whole access model in four policies.
-- ---------------------------------------------------------------------------

create policy call_read on echo.call for select to echo_app, echo_agent
  using (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (owner_id = echo.actor_id() or scope = 'org' or echo.actor_is_admin())
    and (deleted_at is null or echo.actor_is_admin())
  );

create policy call_insert on echo.call for insert to echo_app
  with check (
    org_id = echo.actor_org_id()
    and owner_id = echo.actor_id()
    and echo.actor_is_active()
    and deleted_at is null
  );

-- Owner may edit; admin may archive/delete/restore. WHICH columns each may
-- touch is settled by the trigger in 0011 — RLS cannot express that.
create policy call_update on echo.call for update to echo_app
  using (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (owner_id = echo.actor_id() or echo.actor_is_admin())
  )
  with check (
    org_id = echo.actor_org_id()
    and (owner_id = echo.actor_id() or echo.actor_is_admin())
  );

-- No DELETE policy for echo_app or echo_agent at all: deletion is soft.
create policy call_purge_read on echo.call for select to echo_purge
  using (deleted_at is not null and purge_after <= now());
create policy call_purge_delete on echo.call for delete to echo_purge
  using (deleted_at is not null and purge_after <= now());

-- ---------------------------------------------------------------------------
-- Everything hanging off a call delegates to the same two questions:
-- can I read that call, and do I own it.
-- ---------------------------------------------------------------------------

create policy call_part_read on echo.call_part for select to echo_app, echo_agent
  using (echo.can_read_call(call_id));
create policy call_part_write on echo.call_part for insert to echo_app
  with check (echo.owns_call(call_id) and org_id = echo.actor_org_id());
create policy call_part_update on echo.call_part for update to echo_app
  using (echo.owns_call(call_id)) with check (echo.owns_call(call_id));
create policy call_part_purge_read on echo.call_part for select to echo_purge
  using (echo.call_is_purgeable(call_id));
create policy call_part_purge_delete on echo.call_part for delete to echo_purge
  using (echo.call_is_purgeable(call_id));

create policy transcript_read on echo.transcript_segment for select to echo_app, echo_agent
  using (echo.can_read_call(call_id));
create policy transcript_insert on echo.transcript_segment for insert to echo_app
  with check (echo.owns_call(call_id) and org_id = echo.actor_org_id());
-- The agent's "correct a transcript" tool lives here. It reaches only the
-- caller's own calls — an admin who can read every call still cannot rewrite
-- one they don't own (SPEC) — and column grants (0014) limit it to the text.
create policy transcript_update on echo.transcript_segment for update to echo_app, echo_agent
  using (echo.owns_call(call_id)) with check (echo.owns_call(call_id));
create policy transcript_purge_read on echo.transcript_segment for select to echo_purge
  using (echo.call_is_purgeable(call_id));
create policy transcript_purge_delete on echo.transcript_segment for delete to echo_purge
  using (echo.call_is_purgeable(call_id));

create policy call_speaker_read on echo.call_speaker for select to echo_app, echo_agent
  using (echo.can_read_call(call_id));
create policy call_speaker_insert on echo.call_speaker for insert to echo_app, echo_agent
  with check (echo.owns_call(call_id) and org_id = echo.actor_org_id());
create policy call_speaker_update on echo.call_speaker for update to echo_app, echo_agent
  using (echo.owns_call(call_id)) with check (echo.owns_call(call_id));
create policy call_speaker_purge_read on echo.call_speaker for select to echo_purge
  using (echo.call_is_purgeable(call_id));
create policy call_speaker_purge_delete on echo.call_speaker for delete to echo_purge
  using (echo.call_is_purgeable(call_id));

create policy summary_read on echo.summary for select to echo_app, echo_agent
  using (echo.can_read_call(call_id));
-- "Replace a summary" = insert a new version, as the caller, on the caller's
-- own call. There is no UPDATE policy and no DELETE policy for anyone.
create policy summary_insert on echo.summary for insert to echo_app, echo_agent
  with check (
    echo.owns_call(call_id)
    and org_id = echo.actor_org_id()
    and created_by = echo.actor_id()
  );
create policy summary_purge_read on echo.summary for select to echo_purge
  using (echo.call_is_purgeable(call_id));
create policy summary_purge_delete on echo.summary for delete to echo_purge
  using (echo.call_is_purgeable(call_id));

-- ---------------------------------------------------------------------------
-- person — the org's shared speaker directory. Org-wide by nature; the M11
-- privacy rule lives on the LINK (0011), not on the directory entry.
-- ---------------------------------------------------------------------------

create policy person_read on echo.person for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy person_insert on echo.person for insert to echo_app, echo_agent
  with check (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and created_by = echo.actor_id()
  );
create policy person_update on echo.person for update to echo_app, echo_agent
  using      (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

-- ---------------------------------------------------------------------------
-- skill — system < org < user (M4).
-- ---------------------------------------------------------------------------

create policy skill_read on echo.skill for select to echo_app, echo_agent
  using (
    level = 'system'
    or (org_id = echo.actor_org_id() and echo.actor_is_active()
        and (level = 'org' or user_id = echo.actor_id()))
  );

create policy skill_org_write on echo.skill for all to echo_app
  using      (level = 'org' and org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (level = 'org' and org_id = echo.actor_org_id() and echo.actor_is_admin());

create policy skill_user_write on echo.skill for all to echo_app
  using      (level = 'user' and user_id = echo.actor_id() and echo.actor_is_active())
  with check (level = 'user' and user_id = echo.actor_id() and echo.actor_is_active());

-- System skills are shipped by migration and are read-only to every role.

-- ---------------------------------------------------------------------------
-- agent_run — you see your own runs; admins see the org's (audit, M10).
-- ---------------------------------------------------------------------------

create policy agent_run_read on echo.agent_run for select to echo_app, echo_agent
  using (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (actor_id = echo.actor_id() or echo.actor_is_admin())
  );
create policy agent_run_insert on echo.agent_run for insert to echo_app, echo_agent
  with check (
    org_id = echo.actor_org_id()
    and actor_id = echo.actor_id()
    and echo.actor_is_active()
  );
create policy agent_run_advance on echo.agent_run for update to echo_app, echo_agent
  using      (actor_id = echo.actor_id() and echo.actor_is_active())
  with check (actor_id = echo.actor_id() and echo.actor_is_active());
create policy agent_run_purge_read on echo.agent_run for select to echo_purge
  using (call_id is not null and echo.call_is_purgeable(call_id));
create policy agent_run_purge_delete on echo.agent_run for delete to echo_purge
  using (call_id is not null and echo.call_is_purgeable(call_id));

-- ---------------------------------------------------------------------------
-- Gateway + audit — admin surfaces.
-- ---------------------------------------------------------------------------

create policy api_key_admin on echo.api_key for all to echo_app
  using      (org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin());

create policy webhook_admin on echo.webhook for all to echo_app
  using      (org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin());

create policy webhook_delivery_read on echo.webhook_delivery for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_admin());
-- The worker queues and retries deliveries while running as a member.
create policy webhook_delivery_write on echo.webhook_delivery for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());
create policy webhook_delivery_advance on echo.webhook_delivery for update to echo_app
  using      (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy admin_action_read on echo.admin_action for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_admin());
-- Anyone may write their own audit line; nobody may edit or remove one.
create policy admin_action_insert on echo.admin_action for insert to echo_app
  with check (
    org_id = echo.actor_org_id()
    and actor_id = echo.actor_id()
    and echo.actor_is_active()
  );
