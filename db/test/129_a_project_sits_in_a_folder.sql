-- db/0226 — a project sits in a folder.
--
-- THE WHOLE MATRIX for the projects page's second row (rule 7's corollary:
-- "the ordinary path is the product"): an admin makes, renames and archives
-- a folder; a member reads it and can do none of those; a project points at
-- one; losing the folder leaves the project standing with its pointer
-- cleared and its org intact (0188's class — the FK names its column); the
-- purge knows the table; nobody may delete a folder row.
--
--   alice  owner,  org A  (actor_is_admin() is true for owner AND admin)
--   bob    member, org A, ACTIVE — the ordinary member the wall is about
--          (02, not 04: 04 is dan, who is PENDING, and every "a member
--          cannot" line would pass while measuring actor_is_active())

reset role;
select t.ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'echo' and c.relname = 'project_folder'),
  '0226: echo.project_folder exists');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0226 tests run under a non-bypass product role');

-- ─── A MEMBER MAY NOT MAKE ONE ──────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, ACTIVE member
select t.denied(
  $$insert into echo.project_folder (org_id, name, created_by)
    values (echo.actor_org_id(), 'پوشهٔ باب', echo.actor_id())$$,
  '0226: a member cannot create a project folder');

-- ─── AN ADMIN MAKES ONE, AND A PROJECT SITS IN IT ──────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner
insert into echo.project_folder (id, org_id, name, created_by)
values ('f6000000-0000-4000-8000-000000000f01'::uuid, echo.actor_org_id(), 'مشتریان', echo.actor_id());
select t.ok(
  (select count(*) from echo.project_folder where id = 'f6000000-0000-4000-8000-000000000f01') = 1,
  '0226: an admin created a folder and can read it back');

insert into echo.project (id, org_id, name, created_by, folder_id)
values ('a6000000-0000-4000-8000-000000000f26'::uuid, echo.actor_org_id(), 'بانک بندر',
        echo.actor_id(), 'f6000000-0000-4000-8000-000000000f01');
select t.ok(
  (select folder_id from echo.project where id = 'a6000000-0000-4000-8000-000000000f26')
    = 'f6000000-0000-4000-8000-000000000f01'::uuid,
  '0226: a project points at its folder');

-- a folder id that is not one of this organisation's is refused by
-- STRUCTURE (the composite FK over (folder_id, org_id)), not by whoever
-- happens to be running — an id this org never minted is the same refusal
-- as another org's
select t.denied(
  $$update echo.project set folder_id = 'f6000000-0000-4000-8000-0000000000ff'
     where id = 'a6000000-0000-4000-8000-000000000f26'$$,
  '0226: a project cannot point at a folder id its organisation does not hold');

-- ─── A MEMBER READS, AND CHANGES NOTHING ────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob
select t.ok(
  (select count(*) from echo.project_folder where id = 'f6000000-0000-4000-8000-000000000f01') = 1,
  '0226: a member reads the folder — reading did not move with the write wall');
-- an UPDATE walled by a policy is NOT refused: it matches zero rows and
-- succeeds (0186's note), so the assertion is on the record afterwards
select t.writes_nothing(
  $$update echo.project_folder set name = 'پوشهٔ باب'
     where id = 'f6000000-0000-4000-8000-000000000f01'$$,
  '0226: a member renaming a folder changes nothing');
select t.writes_nothing(
  $$update echo.project_folder set archived_at = now()
     where id = 'f6000000-0000-4000-8000-000000000f01'$$,
  '0226: a member archiving a folder changes nothing');

-- ─── AN ADMIN RENAMES AND ARCHIVES; NOBODY DELETES ──────────────────────
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice
update echo.project_folder set name = 'مشتریان کلیدی' where id = 'f6000000-0000-4000-8000-000000000f01';
select t.ok(
  (select name from echo.project_folder where id = 'f6000000-0000-4000-8000-000000000f01') = 'مشتریان کلیدی',
  '0226: an admin renames a folder');
update echo.project_folder set archived_at = now() where id = 'f6000000-0000-4000-8000-000000000f01';
select t.ok(
  (select archived_at is not null from echo.project_folder where id = 'f6000000-0000-4000-8000-000000000f01'),
  '0226: an admin archives a folder');
-- archiving the folder leaves the project pointing at it — the strip hides
-- an archived folder; the record does not forget where the project was
select t.ok(
  (select folder_id from echo.project where id = 'a6000000-0000-4000-8000-000000000f26') is not null,
  '0226: an archived folder is still the project''s folder');
select t.denied(
  $$delete from echo.project_folder where id = 'f6000000-0000-4000-8000-000000000f01'$$,
  '0226: nobody deletes a folder from the product role — archived, never deleted');

-- ─── LOSING THE FOLDER LEAVES THE PROJECT STANDING (0188''s class) ──────
-- at OWNER altitude, as the purge runs: the SET NULL names its column, so
-- the project keeps its org and loses only the pointer — a bare set-null
-- over (folder_id, org_id) would have RAISED here and read as deliberate
reset role;
delete from echo.project_folder where id = 'f6000000-0000-4000-8000-000000000f01';
select t.ok(
  (select folder_id is null and org_id = '0a000000-0000-4000-8000-00000000000a'::uuid
     from echo.project where id = 'a6000000-0000-4000-8000-000000000f26'),
  '0226: deleting a folder clears the project''s pointer and keeps its org');

-- ─── THE PURGE KNOWS THE TABLE (0145''s rule) ───────────────────────────
select t.ok(
  (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'echo' and p.proname = 'platform_purge_org')
    ~ 'delete\s+from\s+echo\.project_folder\s+where\s+org_id',
  '0226: platform_purge_org deletes project folders');

-- ─── THE AGENT READS AND MAY NOT WRITE ──────────────────────────────────
select t.ok(
  has_table_privilege('echo_agent', 'echo.project_folder', 'SELECT')
  and not has_table_privilege('echo_agent', 'echo.project_folder', 'INSERT')
  and not has_table_privilege('echo_agent', 'echo.project_folder', 'UPDATE'),
  '0226: the agent may read folders and may not write them');
