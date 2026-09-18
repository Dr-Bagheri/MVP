-- 0230 — the entity spine
--
-- User directive (2026-09-18): "start building the entity spine for the
-- organizational brain". The approaches doc
-- (docs/ORGANIZATIONAL-BRAIN-APPROACHES.md) names this as the one thing every
-- approach needs first: a canonical node per real-world thing, and a way to
-- say "this identifier names that thing", so a fact learned from a meeting, a
-- mailbox and a CRM can be about the SAME customer.
--
-- ── WHY A SPINE AND NOT A COLUMN ──────────────────────────────────────────
--
-- The product already has the pain. `person.app_user_id` (0005, unique-indexed
-- in 0100) is the link between a directory person and an account, and it is
-- NULL on every row of the live organisation — because the only writer is an
-- admin pressing a control, and the server's guess
-- (`echo.fa_fold(display_name) = echo.fa_fold(display_name)`, directory.ts)
-- cannot cross a transliteration: the directory is written «سینا سپاسی» and
-- the account is "Sina Sepasi". One nullable column per pair of things does
-- not scale to a CRM id, a Slack handle and a mailbox address, and each new
-- pair would be another column and another migration.
--
-- So: ONE node table and ONE alias table. Everything that names a thing —
-- an account id, a directory row, a project row, an email, a handle, a
-- provider's own id — is a row pointing at the node.
--
-- ── NAMES ARE NOT ALIASES, AND THAT IS THE POINT ──────────────────────────
--
-- A name is not an identifier. Two colleagues in this organisation are both
-- «سینا», so `unique (org_id, source, kind, value)` over names would refuse
-- the second one — and worse, a system that treats a name as an identifier is
-- the one that silently attaches a colleague's identity to somebody else's
-- voice (the 2026-09-16 finding, where naming a speaker created a new person).
-- Names live on the NODE, with fold indexes for searching; matching by name
-- returns CANDIDATES to a resolver, never a link.
--
-- ── CONFIDENCE AND EVIDENCE CARRY THE PROVENANCE ──────────────────────────
--
-- `confidence` distinguishes an asserted link (an admin pressed it, or the
-- provider handed us its own id: 1.0) from an inferred one, and `evidence`
-- says where it came from. That is rule 6's shape — derived artifacts are
-- rebuildable and carry provenance — and it is what lets a later pass ASK
-- rather than assume. This migration writes only asserted aliases; the
-- fold-guess deliberately stays a query, not a row.

begin;

-- ─── the node ─────────────────────────────────────────────────────────────

create table echo.entity (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references echo.org(id),
  -- a closed vocabulary: a kind nobody can query for is a kind nobody added
  -- on purpose. `organization` is an EXTERNAL org (a customer, a supplier) —
  -- `echo.org` is the tenant and is not an entity.
  kind            text not null check (kind in ('person','organization','project','document','topic')),
  display_name    text not null check (length(trim(display_name)) between 1 and 200),
  display_name_en text check (display_name_en is null or length(trim(display_name_en)) between 1 and 200),
  -- kind-specific facts, deliberately open: the spine must not need a
  -- migration to learn that a customer has an industry
  attrs           jsonb not null default '{}' check (jsonb_typeof(attrs) = 'object'),
  -- two nodes turn out to be one thing (echo.person's own merge shape, 0096):
  -- the loser keeps its aliases and points at the winner, so no history is
  -- lost and no id a caller already holds stops resolving
  merged_into     uuid,
  merged_at       timestamptz,
  merged_by       uuid,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  constraint entity_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  -- 0188's lesson: a composite key holding NOT NULL org_id must NAME the
  -- column it nulls, or the cascade can only ever raise
  constraint entity_merged_same_org
    foreign key (merged_into, org_id) references echo.entity (id, org_id)
    on delete set null (merged_into),
  constraint entity_merged_not_self check (merged_into is null or merged_into <> id),
  constraint entity_id_org_key unique (id, org_id)
);

create index entity_org_kind_idx on echo.entity (org_id, kind) where merged_into is null;
-- the name search the resolver offers as CANDIDATES (never as a link), folded
-- so «سینا سپاسی» and a differently-typed «سينا سپاسي» meet
create index entity_name_fold_idx on echo.entity (org_id, echo.fa_fold(display_name));
create index entity_name_en_fold_idx on echo.entity (org_id, echo.fa_fold(display_name_en))
  where display_name_en is not null;

comment on table echo.entity is
  'The organizational brain''s canonical node (0230): one row per real-world '
  'thing — a person, an external organization, a project, a document, a topic. '
  'Names live here; identifiers live in echo.entity_alias. echo.org is the '
  'tenant and is never an entity.';

alter table echo.entity enable row level security;
alter table echo.entity force row level security;

create policy entity_read on echo.entity
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy entity_insert on echo.entity
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

create policy entity_update on echo.entity
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

-- MERGED, never deleted: no role holds DELETE (the closed allow-list in
-- db/test/50 asserts that), so a node a fact points at cannot vanish under it
grant select, insert, update on echo.entity to echo_app;
grant select on echo.entity to echo_agent;

-- ─── the aliases: every identifier that names the node ────────────────────

create table echo.entity_alias (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references echo.org(id),
  entity_id  uuid not null,
  -- where the identifier comes from. 'neurai' is our own rows; the rest are
  -- the connector vocabulary (core/src/api/vocabulary.ts CONNECTOR_PROVIDERS)
  -- plus 'crm' for a system read through a replica rather than a connector.
  source     text not null check (source in (
               'neurai','google','microsoft','zoom','slack','telegram','jira',
               'notion','github','whatsapp','dropbox','mcp','crm','manual')),
  -- what KIND of identifier it is. No 'name' — see the header.
  kind       text not null check (kind in (
               'app_user','person','project','email','handle','phone','domain','external_id')),
  value      text not null check (length(trim(value)) between 1 and 320),
  -- 1.0 = asserted (a provider's own id, or a human pressed it). Anything
  -- less is inferred and is a thing to ASK about, never to act on silently.
  confidence real not null default 1 check (confidence > 0 and confidence <= 1),
  evidence   jsonb not null default '{}' check (jsonb_typeof(evidence) = 'object'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint entity_alias_entity_org
    foreign key (entity_id, org_id) references echo.entity (id, org_id) on delete cascade,
  constraint entity_alias_author_org
    foreign key (created_by, org_id) references echo.app_user (id, org_id),
  -- one identifier names one thing, per organisation. This is the constraint
  -- that makes resolution a lookup rather than a search.
  constraint entity_alias_unique unique (org_id, source, kind, value)
);

create index entity_alias_entity_idx on echo.entity_alias (entity_id);
-- the resolver's own index: "who is slack handle @sara" is one probe
create index entity_alias_lookup_idx on echo.entity_alias (org_id, kind, echo.fa_fold(value));

comment on table echo.entity_alias is
  'Every identifier that names an entity (0230): an account id, a directory '
  'row, a project row, an email, a handle, a provider''s own id. Unique per '
  '(org, source, kind, value), so resolution is a lookup. NAMES ARE NOT HERE — '
  'two people share a name; names live on echo.entity and match as candidates.';

alter table echo.entity_alias enable row level security;
alter table echo.entity_alias force row level security;

create policy entity_alias_read on echo.entity_alias
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

create policy entity_alias_insert on echo.entity_alias
  for insert to echo_app
  with check (org_id = echo.actor_org_id() and echo.actor_is_active()
              and created_by = echo.actor_id());

create policy entity_alias_update on echo.entity_alias
  for update to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_active())
  with check (org_id = echo.actor_org_id() and echo.actor_is_active());

grant select, insert, update on echo.entity_alias to echo_app;
grant select on echo.entity_alias to echo_agent;

-- ─── the backfill: the spine starts holding what we already know ──────────
--
-- An empty spine proves nothing, and the rows we already have are asserted
-- facts: an account IS a person, a directory row IS a person, a project IS a
-- project. Written at owner altitude here, so RLS is not in the way; every
-- alias below is confidence 1 because each is an id we hold, not a guess.
--
-- The one thing this does NOT do is cross the transliteration gap by name.
-- A fold match between «سینا سپاسی» and "Sina Sepasi" is a CANDIDATE, and
-- writing it here would be the product deciding who somebody is on the
-- strength of a string — the exact mistake 2026-09-16 removed from the voice
-- picker. The indexes above make that query cheap; a human or a confirmed
-- match writes the alias later.

do $backfill$
declare
  r_org     record;
  v_author  uuid;
  v_entity  uuid;
  r_row     record;
begin
  for r_org in select id from echo.org loop
    -- an author every row can point at: the owner, else the earliest member
    select u.id into v_author
      from echo.app_user u
     where u.org_id = r_org.id and u.tombstoned_at is null
     order by (u.role::text = 'owner') desc, u.created_at asc
     limit 1;
    continue when v_author is null;

    -- 1. every account is a person node
    for r_row in
      select u.id, u.display_name, u.display_name_en, u.email::text as email, u.username
        from echo.app_user u
       where u.org_id = r_org.id and u.tombstoned_at is null
    loop
      insert into echo.entity (org_id, kind, display_name, display_name_en, created_by, attrs)
      values (r_org.id, 'person', coalesce(nullif(btrim(r_row.display_name), ''), r_row.email),
              r_row.display_name_en, v_author, jsonb_build_object('seeded_from', 'app_user'))
      returning id into v_entity;

      insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by, evidence)
      values (r_org.id, v_entity, 'neurai', 'app_user', r_row.id::text, v_author,
              jsonb_build_object('backfill', '0230'))
      on conflict do nothing;

      if r_row.email is not null and btrim(r_row.email) <> '' then
        insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by, evidence)
        values (r_org.id, v_entity, 'neurai', 'email', lower(btrim(r_row.email)), v_author,
                jsonb_build_object('backfill', '0230'))
        on conflict do nothing;
      end if;

      if r_row.username is not null and btrim(r_row.username) <> '' then
        insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by, evidence)
        values (r_org.id, v_entity, 'neurai', 'handle', lower(btrim(r_row.username)), v_author,
                jsonb_build_object('backfill', '0230'))
        on conflict do nothing;
      end if;
    end loop;

    -- 2. every directory person: attached to its account's node when an admin
    --    has already said who it is, otherwise a node of its own
    for r_row in
      select p.id, p.display_name, p.app_user_id
        from echo.person p
       where p.org_id = r_org.id and p.merged_into is null
    loop
      v_entity := null;
      if r_row.app_user_id is not null then
        select a.entity_id into v_entity
          from echo.entity_alias a
         where a.org_id = r_org.id and a.source = 'neurai'
           and a.kind = 'app_user' and a.value = r_row.app_user_id::text
         limit 1;
      end if;

      if v_entity is null then
        insert into echo.entity (org_id, kind, display_name, created_by, attrs)
        values (r_org.id, 'person', coalesce(nullif(btrim(r_row.display_name), ''), 'unnamed'),
                v_author, jsonb_build_object('seeded_from', 'person'))
        returning id into v_entity;
      end if;

      insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by, evidence)
      values (r_org.id, v_entity, 'neurai', 'person', r_row.id::text, v_author,
              jsonb_build_object('backfill', '0230'))
      on conflict do nothing;
    end loop;

    -- 3. every project is a project node
    for r_row in
      select pr.id, pr.name from echo.project pr
       where pr.org_id = r_org.id and pr.archived_at is null
    loop
      insert into echo.entity (org_id, kind, display_name, created_by, attrs)
      values (r_org.id, 'project', coalesce(nullif(btrim(r_row.name), ''), 'unnamed'),
              v_author, jsonb_build_object('seeded_from', 'project'))
      returning id into v_entity;

      insert into echo.entity_alias (org_id, entity_id, source, kind, value, created_by, evidence)
      values (r_org.id, v_entity, 'neurai', 'project', r_row.id::text, v_author,
              jsonb_build_object('backfill', '0230'))
      on conflict do nothing;
    end loop;
  end loop;
end $backfill$;

-- ─── the purge learns the two new tables (0145's rule, 0182's method) ─────
-- Regenerated from the function's own definition, never retyped: `create or
-- replace` accepts a stale body as cheerfully as a current one, and a wrong
-- signature installs a SECOND OVERLOAD rather than failing (0132).

do $regen$
declare
  v_def    text;
  v_anchor text;
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position('echo.entity' in v_def) > 0 then
    raise exception '0230 FAILED: the purge already names an entity table — this migration would double it';
  end if;

  -- anchored by PATTERN, not by spacing: the body pads its table names into a
  -- column and 0151 recorded a replace that matched nothing and patched nothing
  v_anchor := (regexp_match(v_def, 'delete from echo\.project\s+where org_id = p_org;'))[1];
  if v_anchor is null then
    raise exception
      '0230 FAILED: the purge body has moved on — its project line is not where this migration expects it. Re-read the function before editing it.';
  end if;

  -- children first: the alias is a child of the entity
  v_def := replace(
    v_def, v_anchor,
    v_anchor || E'\n'
      || '  delete from echo.entity_alias           where org_id = p_org;' || E'\n'
      || '  delete from echo.entity                 where org_id = p_org;');
  execute v_def;
end $regen$;

-- ─── self-checks ──────────────────────────────────────────────────────────

do $chk$
declare
  v_def       text;
  v_count     int;
  v_missing   text;
  v_entities  int;
  v_aliases   int;
  v_bad       int;
begin
  -- the purge names both, exactly once each, and lost nothing in the trip
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';

  if position('delete from echo.entity ' in v_def) = 0
     or position('delete from echo.entity_alias' in v_def) = 0 then
    raise exception 'CHECK FAILED: the regenerated purge does not delete the entity tables';
  end if;
  if position('delete from echo.entity_alias' in v_def) > position('delete from echo.entity ' in v_def) then
    raise exception 'CHECK FAILED: the purge deletes the entity before its aliases';
  end if;

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_purge_org';
  if v_count <> 1 then
    raise exception 'CHECK FAILED: platform_purge_org has % overloads', v_count;
  end if;

  select string_agg(t.relname, ', ' order by t.relname) into v_missing
    from pg_class t join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'echo' and t.relkind = 'r'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = t.oid and a.attname = 'org_id' and a.attnum > 0)
     and t.relname <> 'deletion_record'
     and position('echo.' || t.relname || ' ' in v_def) = 0
     and position('echo.' || t.relname || E'\n' in v_def) = 0;
  if v_missing is not null then
    raise exception 'CHECK FAILED: the purge no longer names: %', v_missing;
  end if;

  -- RLS is enabled AND forced on both (0183 exists because 0181 forgot)
  select count(*) into v_count from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'echo' and c.relname in ('entity','entity_alias')
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_count <> 2 then
    raise exception 'CHECK FAILED: entity/entity_alias are not both RLS enabled AND forced';
  end if;

  -- No PRODUCT role may DELETE (the closed allow-list's shape, db/test/50).
  -- Scoped to `echo\_%` on purpose: `role_table_grants` also reports the
  -- table OWNER's implicit privileges, and the first draft of this check
  -- counted those and refused its own correct migration — rule 11's catalogue
  -- trap, where the instrument answers a question next to the one asked.
  select count(*) into v_count from information_schema.role_table_grants
   where table_schema = 'echo' and table_name in ('entity','entity_alias')
     and privilege_type = 'DELETE' and grantee like 'echo\_%';
  if v_count <> 0 then
    raise exception 'CHECK FAILED: a product role holds DELETE on the spine (% grants)', v_count;
  end if;

  -- the backfill landed and is internally consistent
  select count(*) into v_entities from echo.entity;
  select count(*) into v_aliases  from echo.entity_alias;
  if v_entities > 0 and v_aliases = 0 then
    raise exception 'CHECK FAILED: % entities and no aliases — the backfill wrote nodes nothing can resolve', v_entities;
  end if;

  -- every account in a backfilled org resolves to exactly one node
  select count(*) into v_bad
    from echo.app_user u
   where u.tombstoned_at is null
     and exists (select 1 from echo.entity e where e.org_id = u.org_id)
     and (select count(*) from echo.entity_alias a
           where a.org_id = u.org_id and a.source = 'neurai'
             and a.kind = 'app_user' and a.value = u.id::text) <> 1;
  if v_bad > 0 then
    raise exception 'CHECK FAILED: % accounts do not resolve to exactly one entity', v_bad;
  end if;

  -- a directory person an admin HAS linked shares its account's node — the
  -- gap this spine exists to close, asserted rather than assumed
  select count(*) into v_bad
    from echo.person p
    join echo.entity_alias pa
      on pa.org_id = p.org_id and pa.source = 'neurai' and pa.kind = 'person' and pa.value = p.id::text
    join echo.entity_alias ua
      on ua.org_id = p.org_id and ua.source = 'neurai' and ua.kind = 'app_user'
     and ua.value = p.app_user_id::text
   where p.app_user_id is not null and p.merged_into is null
     and pa.entity_id <> ua.entity_id;
  if v_bad > 0 then
    raise exception 'CHECK FAILED: % linked directory people sit on a different node from their account', v_bad;
  end if;
end $chk$;

commit;
