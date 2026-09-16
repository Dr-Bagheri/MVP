-- 0226 — a project sits in a folder
--
-- User directive (2026-09-16): "the bar in project second sub menu is just
-- folder and new folder button, not the new projects, fix it" — after the
-- morning's round had drawn the projects page's second row as a chip PER
-- PROJECT with a `+` that opened the project dialog. The board's second row
-- is its FOLDERS (task_topic, 0144); the meetings page's is its folders
-- (meeting_topic, 0151); the projects page is the third surface with the
-- same row and had nothing to put in it, because a project had no folder.
--
-- So a project folder is a row, modelled on meeting_topic down to its shape
-- and its purge line — the same idea one domain over, and a second shape
-- for one concept is two things to keep in step. What differs is the WALL:
-- a folder here groups an admin's surface (0186: creating, renaming and
-- membership of a project are an admin's acts), so making or renaming a
-- folder is an admin's act too — a member who cannot make a project has no
-- folder to file one in. Reading did not move: every active member reads
-- every project, and the folders those projects sit in.
--
-- `project.folder_id` is NULLABLE and null is the ordinary state: «بدون
-- پوشه» is the absence of a folder, never a folder named that. The FK is
-- COMPOSITE (a project must not point at another organisation's folder —
-- structure refuses that where a policy would only refuse the people it
-- happens to run as, D9) and its SET NULL NAMES ITS COLUMN (0188's lesson,
-- test 109's class): a bare `set null` over a key holding NOT NULL org_id
-- can only ever raise, and it reads as deliberate.

begin;

create table echo.project_folder (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references echo.org(id),
  name        text not null check (length(trim(name)) between 1 and 80),
  archived_at timestamptz,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  constraint project_folder_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  -- one name per org: the strip cannot show the same folder twice and a
  -- rename cannot collide into an existing one
  constraint project_folder_name_unique unique (org_id, name),
  -- the composite target the project points at (see the FK below)
  constraint project_folder_id_org_key unique (id, org_id)
);

create index project_folder_org_idx on echo.project_folder (org_id) where archived_at is null;

comment on table echo.project_folder is
  'Project folders (0226): the projects page''s second row, org-shared, '
  'modelled on meeting_topic (0151). An admin''s to make and rename — a '
  'folder groups an admin''s surface (0186) — and every active member reads.';

alter table echo.project_folder enable row level security;
alter table echo.project_folder force row level security;

-- READ: every active member, and the agent by name (0181's own rule for the
-- project table: an agent listing projects may say which folder each is in)
create policy project_folder_read on echo.project_folder
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

-- WRITE: an admin's act, both halves (0186's shape for the project itself)
create policy project_folder_insert on echo.project_folder
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and echo.actor_is_admin()
              and created_by = echo.actor_id());

create policy project_folder_update on echo.project_folder
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_admin())
  with check (org_id = echo.actor_org_id() and echo.actor_is_admin());

-- ARCHIVED, never deleted — no role holds DELETE (the closed allow-list in
-- the db suite asserts that); the projects in it are re-pointed by the FK
grant select, insert, update on echo.project_folder to echo_app;
grant select on echo.project_folder to echo_agent;

-- ─── the project points at one ────────────────────────────────────────────
alter table echo.project
  add column folder_id uuid,
  add constraint project_folder_same_org
    foreign key (folder_id, org_id) references echo.project_folder (id, org_id)
    on delete set null (folder_id);

create index project_folder_id_idx on echo.project (folder_id) where folder_id is not null;

comment on column echo.project.folder_id is
  'The project''s folder (0226). Null is the ordinary state — «بدون پوشه» '
  'is the absence of a folder, never a folder named that.';

-- ─── the purge learns the new table (0145's rule) ─────────────────────────
-- Regenerated from the function's own definition (0132), never retyped. The
-- anchor is found by PATTERN rather than by its spacing: the body pads its
-- table names into a column, and 0151 recorded a `replace` that matched a
-- single-spaced line and silently patched nothing.
do $regen$
declare
  v_def    text;
  v_anchor text;
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position('echo.project_folder' in v_def) > 0 then
    raise exception '0226 FAILED: the purge already names project_folder — this migration would double it';
  end if;

  v_anchor := (regexp_match(v_def, 'delete from echo\.project\s+where org_id = p_org;'))[1];
  if v_anchor is null then
    raise exception
      '0226 FAILED: the purge body has moved on — its project line is not where this migration expects it. Re-read the function before editing it.';
  end if;

  -- children first: the project (re-pointed to null by the FK) goes before
  -- the folder it pointed at, which is a child of nothing but the org
  v_def := replace(
    v_def, v_anchor,
    v_anchor || E'\n' || '  delete from echo.project_folder         where org_id = p_org;');
  execute v_def;
end $regen$;

-- ─── self-checks ──────────────────────────────────────────────────────────
do $check$
declare
  v_def     text;
  v_missing text;
  v_cols    int;
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  -- (1) the purge names the new table — 0145's derived coverage, asked
  --     here without assuming the spacing
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0
   where n.nspname = 'echo' and c.relkind = 'r'
     and c.relname = 'project_folder'
     and v_def !~ ('delete\s+from\s+echo\.' || c.relname || '\s+where\s+org_id');
  if v_missing is not null then
    raise exception '0226 FAILED: the purge does not delete %', v_missing;
  end if;
  -- and it did not lose the line it was anchored on
  if v_def !~ 'delete\s+from\s+echo\.project\s+where\s+org_id' then
    raise exception '0226 FAILED: the regenerated purge lost the project line';
  end if;

  -- (2) the SET NULL names its column (0188's class, test 109): a bare
  --     set-null over (folder_id, org_id) would raise on every folder archive
  --     that ever became a delete, and read as deliberate
  select coalesce(array_length(confdelsetcols, 1), 0) into v_cols
    from pg_constraint where conname = 'project_folder_same_org';
  if v_cols <> 1 then
    raise exception '0226 FAILED: project_folder_same_org must null exactly one column (folder_id), it names %', v_cols;
  end if;

  -- (3) the agent may not invent folders, and nobody may delete one
  if has_table_privilege('echo_agent', 'echo.project_folder', 'INSERT') then
    raise exception '0226 FAILED: the agent role may create project folders';
  end if;
  if has_table_privilege('echo_app', 'echo.project_folder', 'DELETE')
     or has_table_privilege('echo_agent', 'echo.project_folder', 'DELETE') then
    raise exception '0226 FAILED: a role holds DELETE on project_folder — folders are archived, never deleted';
  end if;

  -- (4) RLS is forced, so the table owner cannot bypass it either
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'echo' and c.relname = 'project_folder'
                    and c.relrowsecurity and c.relforcerowsecurity) then
    raise exception '0226 FAILED: project_folder is not under forced RLS';
  end if;
end $check$;

commit;
