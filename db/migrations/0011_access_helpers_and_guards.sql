-- Echo — 0011: readability helpers, and the integrity rules that survive a
-- bug in core/.
--
-- RLS answers "which rows may this identity touch". It cannot answer "which
-- COLUMNS of a row may this identity change" — and several of our rulings are
-- exactly that shape:
--   * an admin may delete any recording, but may not rewrite one they don't
--     own (SPEC);
--   * a member must not be able to promote themselves (M15);
--   * a summary version, once written, is not editable (invariant 4);
--   * a voice joins the org directory only when its owner links it (M11).
-- Column grants cover the agent, because the agent has its own role. For
-- humans, everyone arrives as echo_app, so these are triggers.

create function echo.purge_window() returns interval
  language sql immutable parallel safe
as $$ select interval '30 days' $$;

comment on function echo.purge_window() is
  'The M11 purge window, in one place. Deletion is soft; hard purge happens after this.';

-- ---------------------------------------------------------------------------
-- Call readability — the rule the whole product turns on, written once.
-- ---------------------------------------------------------------------------

create function echo.can_read_call(target_call uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from echo.call c
    where c.id = target_call
      and c.org_id = echo.actor_org_id()
      and echo.actor_is_active()
      and (c.owner_id = echo.actor_id() or c.scope = 'org' or echo.actor_is_admin())
      -- Soft-deleted calls stay visible to admins for the purge window (M11)
      -- and disappear for everyone else.
      and (c.deleted_at is null or echo.actor_is_admin())
  );
$$;

create function echo.owns_call(target_call uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from echo.call c
    where c.id = target_call
      and c.owner_id = echo.actor_id()
      and c.deleted_at is null
      and echo.actor_is_active()
  );
$$;

comment on function echo.can_read_call(uuid) is
  'SPEC''s scope rule: own call, or org-scoped, or admin. Every child table''s read policy delegates here.';

-- ---------------------------------------------------------------------------
-- echo.call — owner/admin column split, and the soft-delete stamp.
-- ---------------------------------------------------------------------------

create function echo.tg_call_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
begin
  if new.org_id is distinct from old.org_id or new.owner_id is distinct from old.owner_id then
    raise exception 'a call cannot change org or owner'
      using errcode = 'check_violation';
  end if;

  -- An admin may delete any recording (M11) but may not rewrite one they do
  -- not own. The worker is not an exception: it runs as the call's owner (M3),
  -- so it lands on the owner branch like any other write by that person.
  if old.owner_id is distinct from actor then
    if new.title          is distinct from old.title
    or new.scope          is distinct from old.scope
    or new.language       is distinct from old.language
    or new.source         is distinct from old.source
    or new.started_at     is distinct from old.started_at
    or new.status         is distinct from old.status
    or new.duration_ms    is distinct from old.duration_ms
    or new.failure_reason is distinct from old.failure_reason then
      raise exception 'only the owner may modify a call; others may archive, delete or restore it'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- The current-summary pointer is normally moved by the trigger in 0008, but
  -- the column is still a column: keep it honest so that it can only ever name
  -- one of this call's own versions.
  if new.current_summary_id is distinct from old.current_summary_id
     and new.current_summary_id is not null
     and not exists (
       select 1 from echo.summary s
       where s.id = new.current_summary_id and s.call_id = new.id
     ) then
    raise exception 'a call''s current summary must be one of its own versions'
      using errcode = 'check_violation';
  end if;

  -- Deletion stamps itself. Whoever the caller claims deleted it, the record
  -- says who actually did.
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at  := now();
    new.deleted_by  := actor;
    new.purge_after := now() + echo.purge_window();
  elsif new.deleted_at is null and old.deleted_at is not null then
    new.deleted_by  := null;
    new.purge_after := null;
  elsif new.deleted_at is not null then
    -- Already deleted: the window cannot be extended or brought forward.
    new.deleted_at  := old.deleted_at;
    new.deleted_by  := old.deleted_by;
    new.purge_after := old.purge_after;
  end if;

  return new;
end;
$$;

create trigger call_guard
  before update on echo.call
  for each row execute function echo.tg_call_guard();

-- ---------------------------------------------------------------------------
-- echo.app_user — nobody promotes themselves (M15).
-- ---------------------------------------------------------------------------

create function echo.tg_app_user_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
  -- Is this an application connection, or the operator?
  --
  -- The authority rules below govern the product's roles. The database owner
  -- is outside them by definition — it can do anything regardless of what a
  -- trigger says — and that is the seam the vendor-acceptance path in 0015
  -- runs through: accepting a brand-new org is a commercial decision that
  -- belongs to no org's admin (M15 amendment), so it must not be reachable
  -- from core/. core/ is echo_app; it never gets here with this false.
  --
  -- Deliberately the effective role itself, not pg_has_role(): membership is
  -- transitive and grantable, so a role_has_membership test would call the
  -- operator "an app connection" the moment anyone granted echo_app to the
  -- owner — which is exactly what a test harness does to be able to SET ROLE.
  -- core/ connects AS these roles; inside a SECURITY DEFINER function
  -- current_user is the function's owner, which is the seam we want.
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  -- Integrity, not authority: true on every path, operator included.
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id then
    raise exception 'a user cannot change identity or org'
      using errcode = 'check_violation';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email is owned by the auth provider, not by this table'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role is distinct from old.role or new.status is distinct from old.status then
    if from_app then
      if not echo.actor_is_admin() then
        raise exception 'only an admin may change a role or a membership status'
          using errcode = 'insufficient_privilege';
      end if;
      -- The one thing an admin may not do: change their own. Acceptance and
      -- promotion are decisions about someone else, always.
      if actor = old.id then
        raise exception 'an admin may not change their own role or status'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
    -- Acceptance records itself (M15). accepted_by is the admin who accepted;
    -- NULL with accepted_at set means the vendor did, which is the only way a
    -- founding admin of a brand-new org can become active.
    if old.status = 'pending' and new.status = 'active' then
      new.accepted_at := now();
      -- On the operator path accepted_by is NULL by construction, not by
      -- luck: whatever identity happens to be set on the connection, a vendor
      -- acceptance must not be recorded as some org admin's decision.
      new.accepted_by := case when from_app then actor else null end;
    end if;
  end if;

  return new;
end;
$$;

create trigger app_user_guard
  before update on echo.app_user
  for each row execute function echo.tg_app_user_guard();

-- ---------------------------------------------------------------------------
-- echo.summary — versions are written once and numbered by the database.
-- ---------------------------------------------------------------------------

create function echo.tg_summary_version() returns trigger
  language plpgsql
  security definer          -- numbering must not depend on what the caller can see
  set search_path = ''
as $$
begin
  if new.version is null then
    select coalesce(max(s.version), 0) + 1
      into new.version
      from echo.summary s
     where s.call_id = new.call_id;
  end if;
  return new;
end;
$$;

create trigger summary_version
  before insert on echo.summary
  for each row execute function echo.tg_summary_version();

create function echo.tg_reject_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger summary_immutable
  before update on echo.summary
  for each row execute function echo.tg_reject_update();

create trigger admin_action_immutable
  before update on echo.admin_action
  for each row execute function echo.tg_reject_update();

-- ---------------------------------------------------------------------------
-- echo.agent_run — a run may progress, but it may not be rewritten
-- (invariant 5: runs are replayable).
-- ---------------------------------------------------------------------------

create function echo.tg_agent_run_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.org_id   is distinct from old.org_id
  or new.actor_id is distinct from old.actor_id
  or new.call_id  is distinct from old.call_id
  or new.skill_id is distinct from old.skill_id
  or new.kind     is distinct from old.kind
  or new.model    is distinct from old.model
  or new.request  is distinct from old.request
  or new.started_at is distinct from old.started_at then
    raise exception 'an agent run cannot be rewritten, only advanced'
      using errcode = 'insufficient_privilege';
  end if;

  -- Steps append; they never shrink or get replaced wholesale.
  if jsonb_array_length(new.steps) < jsonb_array_length(old.steps) then
    raise exception 'agent run steps are append-only'
      using errcode = 'insufficient_privilege';
  end if;

  if old.status <> 'running' then
    raise exception 'a finished agent run is closed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger agent_run_guard
  before update on echo.agent_run
  for each row execute function echo.tg_agent_run_guard();

-- ---------------------------------------------------------------------------
-- echo.transcript_segment — a correction keeps the line's identity and its
-- place on the timeline, and marks itself as edited (SPEC).
-- ---------------------------------------------------------------------------

create function echo.tg_transcript_edit() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.call_id  is distinct from old.call_id
  or new.org_id   is distinct from old.org_id
  or new.part_id  is distinct from old.part_id
  or new.seq      is distinct from old.seq
  or new.start_ms is distinct from old.start_ms
  or new.end_ms   is distinct from old.end_ms then
    raise exception 'a corrected line keeps its identity and its timing'
      using errcode = 'insufficient_privilege';
  end if;

  if new.text is distinct from old.text then
    new.edited_at := now();
    new.edited_by := echo.actor_id();
  end if;

  return new;
end;
$$;

create trigger transcript_segment_edit
  before update on echo.transcript_segment
  for each row execute function echo.tg_transcript_edit();

-- ---------------------------------------------------------------------------
-- echo.call_speaker — the M11 directory-privacy rule.
--
-- A voice from a private call does not join the org's shared directory by
-- being recorded. It joins when the OWNER links it — not when an admin who
-- can merely read the call decides to.
-- ---------------------------------------------------------------------------

create function echo.tg_call_speaker_link_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  linking boolean := new.person_id is not null
                     and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id);
begin
  if linking then
    if not echo.owns_call(new.call_id) then
      raise exception 'only the call''s owner may link a voice to the speaker directory'
        using errcode = 'insufficient_privilege';
    end if;
    new.linked_by := echo.actor_id();
    new.linked_at := now();
  elsif new.person_id is null then
    new.linked_by := null;
    new.linked_at := null;
  end if;

  return new;
end;
$$;

create trigger call_speaker_link_guard
  before insert or update on echo.call_speaker
  for each row execute function echo.tg_call_speaker_link_guard();
