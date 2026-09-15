-- 0218: a demo organisation is born whole, cleared without losing its
-- accounts, and reachable only through its own console door.
--
-- Self-contained, like every file here: alice is seated as the fixture
-- platform root at owner altitude, and the whole file rolls back.
--
-- The behaviour lives HERE rather than in 0218's self-checks for a mechanical
-- reason stated in that migration: it adds two `platform_audit_action` values,
-- and a new enum value cannot be used in the transaction that created it — so
-- nothing in 0218 may call a door that names one.
--
-- THE COVERAGE CHECK BELOW IS WHY THIS FILE NEEDS NO WORK when new org-scoped
-- tables arrive. It does not enumerate anything: it asks the CATALOGUE
-- for every org-scoped table and demands each one be empty, so
-- `telegram_identity`, `telegram_link_code` and `skill_version` were covered on
-- the day they were created, by the same two queries that cover the rest.
--
-- No psql meta-commands: the runner hands each file to `db.query()`, so there
-- is no `\gset` and no `:variable`. The new organisation's id is carried in a
-- temp table, which rolls back with everything else.

reset role;
insert into echo.platform_operator (user_id)
values ('01000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;

-- the three identities a demo organisation's accounts borrow. Written by hand
-- at owner altitude exactly as the fixture does, and for the same reason: an
-- auth.users row is not evidence anybody ever signed up.
insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-0000000000d1', 'demo-owner@demo.neurai.invalid'),
  ('d2000000-0000-4000-8000-0000000000d2', 'demo-two@demo.neurai.invalid'),
  ('d3000000-0000-4000-8000-0000000000d3', 'demo-three@demo.neurai.invalid');

set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

-- ── the ordinary path: an organisation and its people in one run ──────────
create temp table demo_ref on commit drop as
select echo.platform_create_demo_org(
  '01000000-0000-4000-8000-000000000001',
  'سازمان دموی آزمایشی', 'fa', date '2026-09-09',
  $json$[
    {"id":"d1000000-0000-4000-8000-0000000000d1","email":"demo-owner@demo.neurai.invalid",
     "display_name":"سارا احمدی","display_name_en":"Sara Ahmadi","username":"sara",
     "job_title":"مدیر محصول","role":"owner"},
    {"id":"d2000000-0000-4000-8000-0000000000d2","email":"demo-two@demo.neurai.invalid",
     "display_name":"رضا کریمی","display_name_en":"Reza Karimi","username":"reza",
     "job_title":"مدیر ارشد فنی","role":"member"},
    {"id":"d3000000-0000-4000-8000-0000000000d3","email":"demo-three@demo.neurai.invalid",
     "display_name":"مینا رستمی","display_name_en":"Mina Rostami","username":"mina",
     "job_title":"کارشناس فروش","role":"member"}
  ]$json$::jsonb,
  'seeding a demo organisation for a rehearsal') as id;

select t.ok((select id from demo_ref) is not null,
  'the platform root creates a demo organisation');

-- read it back through its OWN door — the ambient product read cannot see
-- somebody else's organisation, which is 0091 working
select t.ok(
  (select count(*) from echo.platform_demo_orgs('01000000-0000-4000-8000-000000000001') d
    where d.id = (select id from demo_ref)) = 1,
  'the demo tab lists it');
select t.ok(
  (select d.demo->>'language' from echo.platform_demo_orgs('01000000-0000-4000-8000-000000000001') d
    where d.id = (select id from demo_ref)) = 'fa',
  'and records the CONTENT language on the row');
select t.ok(
  (select d.demo->>'demo_date' from echo.platform_demo_orgs('01000000-0000-4000-8000-000000000001') d
    where d.id = (select id from demo_ref)) = '2026-09-09',
  'and the day its timeline is measured from');
select t.ok(
  (select d.owner_email from echo.platform_demo_orgs('01000000-0000-4000-8000-000000000001') d
    where d.id = (select id from demo_ref)) = 'demo-owner@demo.neurai.invalid',
  'and names the presenter, which is the address the console shows once');
select t.ok(
  (select d.member_count from echo.platform_demo_orgs('01000000-0000-4000-8000-000000000001') d
    where d.id = (select id from demo_ref)) = 3,
  'and counts the humans, not the agents');
select t.ok(
  not exists (
    select 1 from echo.platform_demo_orgs('01000000-0000-4000-8000-000000000001') d
     where d.id = '0a000000-0000-4000-8000-00000000000a'),
  'and lists ONLY demos — a customer''s organisation has no `demo` mark and never appears');

-- ── the seats ─────────────────────────────────────────────────────────────
reset role;
select t.ok(
  (select count(*) from echo.app_user u, demo_ref r
    where u.org_id = r.id and u.kind = 'human' and u.status = 'active') = 3,
  'all three people are seated ACTIVE — a demo nobody can sign into is not a demo');
select t.ok(
  (select count(*) from echo.app_user u, demo_ref r
    where u.org_id = r.id and u.kind = 'human' and u.role = 'owner') = 1,
  'exactly one of them is the owner');
select t.ok(
  (select accepted_by is null and accepted_at is not null from echo.app_user
    where id = 'd1000000-0000-4000-8000-0000000000d1'),
  'the vendor placed them: accepted_at stamped, accepted_by NULL (M15''s spelling)');
select t.ok(
  (select timezone from echo.app_user where id = 'd1000000-0000-4000-8000-0000000000d1')
    = 'Asia/Tehran',
  'and they read the demo''s own clock, not the browser''s');
select t.ok(
  (select locale from echo.app_user where id = 'd1000000-0000-4000-8000-0000000000d1') = 'fa',
  'and their interface is the content''s language');
select t.ok(
  (select username from echo.app_user where id = 'd2000000-0000-4000-8000-0000000000d2') = 'reza',
  'the handles the pack fixes are written verbatim — a re-seed finds the accounts by them');

-- 0171's trigger fires on the org insert, so the agents arrive WITH the
-- organisation; the door provisions none itself
select t.ok(
  (select count(*) from echo.app_user u, demo_ref r
    where u.org_id = r.id and u.kind = 'agent') >= 2,
  'Roya and Ava arrive with the organisation (0171''s trigger), unprovisioned by this door');

-- ── the shape rules ───────────────────────────────────────────────────────
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.raises(
  $$select echo.platform_create_demo_org(
      '01000000-0000-4000-8000-000000000001', 'دموی بی‌آدم', 'fa',
      date '2026-09-09', '[]'::jsonb, 'nobody in it')$$,
  '22023',
  'a demo organisation with no people is refused');

select t.raises(
  $$select echo.platform_create_demo_org(
      '01000000-0000-4000-8000-000000000001', 'دموی دوزبانه', 'de',
      date '2026-09-09',
      $j$[{"id":"d2000000-0000-4000-8000-0000000000d2","email":"a@demo.neurai.invalid","display_name":"x","role":"owner"},
          {"id":"d3000000-0000-4000-8000-0000000000d3","email":"b@demo.neurai.invalid","display_name":"y"}]$j$::jsonb,
      'an unknown language')$$,
  '22023',
  'only the languages a content pack exists for are accepted');

select t.raises(
  $$select echo.platform_create_demo_org(
      '01000000-0000-4000-8000-000000000001', 'دموی بی‌مالک', 'fa',
      date '2026-09-09',
      $j$[{"id":"d2000000-0000-4000-8000-0000000000d2","email":"a@demo.neurai.invalid","display_name":"x"},
          {"id":"d3000000-0000-4000-8000-0000000000d3","email":"b@demo.neurai.invalid","display_name":"y"}]$j$::jsonb,
      'nobody in charge')$$,
  '22023',
  'a demo organisation with no owner is refused — the console names ONE person');

select t.raises(
  $$select echo.platform_create_demo_org(
      '01000000-0000-4000-8000-000000000001', 'دموی دومالکه', 'fa',
      date '2026-09-09',
      $j$[{"id":"d2000000-0000-4000-8000-0000000000d2","email":"a@demo.neurai.invalid","display_name":"x","role":"owner"},
          {"id":"d3000000-0000-4000-8000-0000000000d3","email":"b@demo.neurai.invalid","display_name":"y","role":"owner"}]$j$::jsonb,
      'two in charge')$$,
  '22023',
  'and so is a second owner — an account nobody was told about');

select t.raises(
  $$select echo.platform_create_demo_org(
      '01000000-0000-4000-8000-000000000001', 'شرکت الف', 'fa', date '2026-09-09',
      $j$[{"id":"d2000000-0000-4000-8000-0000000000d2","email":"a@demo.neurai.invalid","display_name":"x","role":"owner"},
          {"id":"d3000000-0000-4000-8000-0000000000d3","email":"b@demo.neurai.invalid","display_name":"y"}]$j$::jsonb,
      'the name of a real organisation')$$,
  '23505',
  'the name is signup''s JOIN KEY, so a twin of a live organisation is refused');

-- ── the clear: content goes, ACCOUNTS STAY ────────────────────────────────
-- content the clear has to remove, written at owner altitude as the fixture
-- writes its own
reset role;
insert into echo.person (id, org_id, display_name, title, created_by)
select 'd4000000-0000-4000-8000-0000000000d4', r.id, 'NAI', 'director',
       'd1000000-0000-4000-8000-0000000000d1' from demo_ref r;
insert into echo.call (id, org_id, owner_id, title, scope, status, source, language)
select 'd5000000-0000-4000-8000-0000000000d5', r.id,
       'd1000000-0000-4000-8000-0000000000d1', 'a seeded record', 'org', 'ready', 'web', 'fa'
  from demo_ref r;
insert into echo.task_column (id, org_id, name, position, created_by)
select 'd6000000-0000-4000-8000-0000000000d6', r.id, 'بک‌لاگ', 1,
       'd1000000-0000-4000-8000-0000000000d1' from demo_ref r;
insert into echo.task (id, org_id, column_id, title, position, created_by)
select 'd7000000-0000-4000-8000-0000000000d7', r.id,
       'd6000000-0000-4000-8000-0000000000d6', 'ارسال پیشنهاد قیمت', 1,
       'd1000000-0000-4000-8000-0000000000d1' from demo_ref r;
insert into echo.task_assignee (task_id, user_id, org_id)
select 'd7000000-0000-4000-8000-0000000000d7', 'd2000000-0000-4000-8000-0000000000d2', r.id
  from demo_ref r;

-- the subject EXISTS before the clear — a zero-row delete passes any ordering
-- vacuously, which is 87_instant_purge's own lesson
select t.ok(
  (select count(*) from echo.task t2, demo_ref r where t2.org_id = r.id) = 1
  and (select count(*) from echo.call c, demo_ref r where c.org_id = r.id) = 1
  and (select count(*) from echo.person p, demo_ref r where p.org_id = r.id) = 1,
  'the demo organisation has content to clear');

-- THE NEGATIVE CONTROL for the coverage probe below. It must be able to
-- answer "these tables still have rows" — a probe that can only ever come
-- back empty would certify any clear, including one that deleted nothing.
select t.ok(
  (select string_agg(x.relname, ', ' order by x.relname)
     from (
       select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'echo' and c.relkind = 'r'
          and a.attname = 'org_id' and not a.attisdropped
          and c.relname not in ('app_user', 'deletion_record')
     ) x, demo_ref r
    where (xpath('/row/c/text()',
            query_to_xml(format('select count(*) as c from echo.%I where org_id = %L',
                                x.relname, r.id), false, true, '')))[1]::text::bigint > 0
  ) is not null,
  'the coverage probe can see rows when there are rows — the control');

set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
create temp table clear_ref on commit drop as
select echo.platform_clear_demo_org(
  '01000000-0000-4000-8000-000000000001', (select id from demo_ref), date '2026-09-16',
  're-seeding the demo for next week') as rows_removed;

select t.ok((select rows_removed from clear_ref) >= 5,
  'the clear reports how many rows it removed');

-- measured at OWNER altitude: under echo_app an empty answer and an
-- invisible one are the same picture (rule 11's counting corollary)
reset role;
select t.ok(
  (select count(*) from echo.task t2, demo_ref r where t2.org_id = r.id) = 0
  and (select count(*) from echo.task_assignee a, demo_ref r where a.org_id = r.id) = 0
  and (select count(*) from echo.task_column c, demo_ref r where c.org_id = r.id) = 0
  and (select count(*) from echo.call c, demo_ref r where c.org_id = r.id) = 0
  and (select count(*) from echo.person p, demo_ref r where p.org_id = r.id) = 0,
  'the content is gone — children and parents alike, in whatever order the FK graph needed');

-- THE COVERAGE CHECK, derived from the catalogue rather than from a list
-- somebody keeps by hand. This is 102_purge_coverage's shape pointed at the
-- clear door: an org-scoped table the dynamic loop somehow skips shows up
-- here as a table with rows left in it, on the day it is added.
select t.ok(
  (select string_agg(x.relname, ', ' order by x.relname)
     from (
       select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'echo' and c.relkind = 'r'
          and a.attname = 'org_id' and not a.attisdropped
          and c.relname not in ('app_user', 'deletion_record')
     ) x, demo_ref r
    where (xpath('/row/c/text()',
            query_to_xml(format('select count(*) as c from echo.%I where org_id = %L',
                                x.relname, r.id), false, true, '')))[1]::text::bigint > 0
  ) is null,
  'every org-scoped table except app_user is empty after the clear');

select t.ok(
  (select count(*) from echo.app_user u, demo_ref r
    where u.org_id = r.id and u.kind = 'human' and u.status = 'active') = 3,
  'THE ACCOUNTS SURVIVE — the credentials were shown once and a re-seed must not void them');
select t.ok(
  (select o.demo->>'demo_date' from echo.org o, demo_ref r where o.id = r.id) = '2026-09-16',
  'and the row carries the NEW demo date');
select t.ok(
  (select o.demo->>'reseeded_at' from echo.org o, demo_ref r where o.id = r.id) is not null,
  'and says it has been re-seeded');
select t.ok(
  (select o.demo->>'seeded_at' from echo.org o, demo_ref r where o.id = r.id) is not null,
  'without losing when it was first seeded');

-- ── the clear cannot be pointed at a real organisation ────────────────────
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.raises(
  $$select echo.platform_clear_demo_org(
      '01000000-0000-4000-8000-000000000001',
      '0a000000-0000-4000-8000-00000000000a', date '2026-09-16', 'pointing at a customer')$$,
  '23514',
  'a customer''s organisation has no `demo` mark and cannot be emptied by this door');

-- the control: the SAME actor, the SAME kind of call, on the demo org,
-- SUCCEEDS — without it the refusal above is equally satisfied by a door
-- that refuses everything
select t.ok(
  echo.platform_clear_demo_org(
    '01000000-0000-4000-8000-000000000001', (select id from demo_ref), date '2026-09-16',
    'the control: clearing the demo again') >= 0,
  'while the demo organisation is cleared by the same call — the discriminating pair');

select t.raises(
  $$select echo.platform_clear_demo_org(
      '01000000-0000-4000-8000-000000000001',
      'ffffffff-0000-4000-8000-00000000ffff', date '2026-09-16', 'no such org')$$,
  'P0002',
  'and an organisation that does not exist is named as missing, not as forbidden');

-- ── the walls ─────────────────────────────────────────────────────────────
-- erin is an ORG OWNER in the other tenancy: org rank buys nothing at
-- platform altitude, which is the discriminating case (a plain member would
-- be refused by things that are not this wall)
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.denied(
  $$select echo.platform_create_demo_org(
      '05000000-0000-4000-8000-000000000005', 'دموی قاچاقی', 'fa', date '2026-09-09',
      $j$[{"id":"d2000000-0000-4000-8000-0000000000d2","email":"a@demo.neurai.invalid","display_name":"x","role":"owner"},
          {"id":"d3000000-0000-4000-8000-0000000000d3","email":"b@demo.neurai.invalid","display_name":"y"}]$j$::jsonb,
      'trying')$$,
  'an org owner who is not platform root creates no demo organisation');
select t.denied(
  $$select * from echo.platform_demo_orgs('05000000-0000-4000-8000-000000000005')$$,
  'and cannot list them either');
select t.denied(
  $$select echo.platform_clear_demo_org(
      '05000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000000',
      date '2026-09-16', 'trying')$$,
  'and cannot empty one');

-- the anti-smuggling half of require_platform_root: a real root's id supplied
-- by somebody else is still refused, because the argument must equal the
-- session's own actor
select t.denied(
  $$select * from echo.platform_demo_orgs('01000000-0000-4000-8000-000000000001')$$,
  'and cannot borrow the root''s id while acting as themselves');

-- ── the audit ─────────────────────────────────────────────────────────────
reset role;
select t.ok(
  exists (select 1 from echo.platform_audit a, demo_ref r
           where a.target_org_id = r.id and a.action = 'demo_org_created'),
  'creating a demo organisation is audited under its own action');
select t.ok(
  exists (select 1 from echo.platform_audit a, demo_ref r
           where a.target_org_id = r.id and a.action = 'demo_org_reseeded'),
  'and so is clearing it for a new date');
select t.ok(
  not exists (select 1 from echo.platform_audit a, demo_ref r
               where a.target_org_id = r.id
                 and a.reason ~ '[A-Za-z0-9@#_-]{20,}'),
  'and no audit line carries anything that could be a password');
