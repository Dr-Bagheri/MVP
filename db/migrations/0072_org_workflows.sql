-- NeurAI Platform — 0072: org-authored workflows (user directive, 2026-08-20:
-- "add the create workflow button too with full function").
--
-- 0065 shipped workflow_template as GLOBAL config: seeded rows, read-only,
-- no owner column. Making creation real needs tenancy first: an org's
-- workflow must be invisible to every other org, or the create button is a
-- cross-tenant broadcast. Seeded platform rows keep org_id NULL and stay
-- visible to everyone; org rows carry org_id and follow the wall.
--
-- Creation is ADMIN-gated (M29's org-skill precedent: a workflow's
-- instructions become prompt content for whoever runs it — org-wide prompt
-- surface is org configuration, not a member free-for-all). created_by must
-- equal the acting admin — a fact must not be supplyable (0029's rule) — and
-- its FK is SET NULL so attribution outlives accounts without blocking
-- their erasure.

alter table echo.workflow_template
  add column org_id     uuid references echo.org(id),
  add column created_by uuid references echo.app_user(id) on delete set null;

comment on column echo.workflow_template.org_id is
  'NULL = platform-seeded, visible to every org. Set = this org''s own workflow, invisible outside it.';

-- The read policy learns tenancy: platform rows for everyone active, org
-- rows only inside their org. Recreated, not patched — a policy is one
-- sentence and half-edits to sentences are how they stop being true.
drop policy workflow_template_read on echo.workflow_template;
create policy workflow_template_read on echo.workflow_template for select to echo_app
  using (
    echo.actor_is_active() and enabled
    and (org_id is null or org_id = echo.actor_org_id())
  );

-- Admins create org workflows. Platform rows (org_id null) are NOT mintable
-- through the app role — with check refuses them, so the seeded namespace
-- stays the migration's alone.
create policy workflow_template_admin_insert on echo.workflow_template
  for insert to echo_app
  with check (
    echo.actor_is_active() and echo.role_is_admin()
    and org_id = echo.actor_org_id()
    and created_by = echo.actor_id()
  );

grant insert on echo.workflow_template to echo_app;
