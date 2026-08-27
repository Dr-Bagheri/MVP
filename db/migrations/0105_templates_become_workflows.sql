-- 0105 — W15: org-authored workflow_template rows become real workflows.
--
-- "A redirect is cheaper than a broken bookmark, and the same logic applies
-- to a saved process" (M41). Every ORG-authored template (org_id not null)
-- gains a workflow + version 1 carrying the faithful conversion of what the
-- template did: fetch the chosen source item, then ask over it with the
-- template's instructions. Two steps in the graph, one act for the person —
-- exactly what pressing the old card did.
--
-- What deliberately does NOT migrate:
--  * SYSTEM templates (org_id null). The new engine is org-scoped; shipped
--    starter workflows are P5's deliverable, authored against the final
--    grammar rather than converted. The old surface keeps serving system
--    templates until P5 replaces it — nothing breaks in the window.
--  * The template rows themselves. They stay, untouched, still served by
--    the existing routes; retiring the old surface is P5's decision, made
--    when its replacement is standing. Deleting the old door before the
--    new one opens is how a bookmark 404s.
--
-- Shape notes, pinned for core's validator (rule 10 — this SQL is the
-- producer of these graphs, and core/test's corpus asserts this exact
-- shape validates):
--  * `agent` is OMITTED on the ask step: absent = the base assistant
--    persona (system floor + step instruction), which is what templates
--    ran as. `agents` snapshot is {} accordingly.
--  * max_autonomy = 'watch': these graphs contain no propose/apply, and
--    the tightest true statement is the one worth enforcing.

begin;

with converted as (
  insert into echo.workflow
    (org_id, handle, name, description, icon, enabled, created_by, created_at)
  select
    t.org_id, t.slug, t.name, t.description, t.icon, t.enabled,
    t.created_by, t.created_at
  from echo.workflow_template t
  where t.org_id is not null
    and t.created_by is not null
    and not exists (
      select 1 from echo.workflow w
       where w.org_id = t.org_id and w.handle = t.slug
    )
  returning id, org_id, handle, created_by
),
versions as (
  insert into echo.workflow_version
    (workflow_id, org_id, version, graph, agents, max_autonomy, budget, published_by)
  select
    c.id, c.org_id, 1,
    jsonb_build_object(
      'entry', 's1',
      'steps', jsonb_build_array(
        jsonb_build_object(
          'id', 's1', 'kind', 'fetch',
          'source_kind', t.source_kind,
          'of', '{{trigger.source_ref}}'
        ),
        jsonb_build_object(
          'id', 's2', 'kind', 'ask',
          'from', 's1',
          'instruction', t.instructions
        )
      )
    ),
    '{}'::jsonb, 'watch', '{}'::jsonb, c.created_by
  from converted c
  join echo.workflow_template t
    on t.org_id = c.org_id and t.slug = c.handle
  returning id, workflow_id
)
update echo.workflow w
   set current_version_id = v.id
  from versions v
 where w.id = v.workflow_id;

commit;
