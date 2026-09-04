-- db/0186 — a project is an admin's to give, and an order can repeat.
--
-- THE WHOLE MATRIX (rule 7's corollary: "the ordinary path is the product").
-- 0181 let any active member create a project; 0186 narrows that, and a
-- narrowing is the change most likely to be asserted only on the side that
-- refuses. So both sides are here for each of the three writes, and so is the
-- half that must NOT have moved — reading.
--
--   alice  owner,  org A   (actor_is_admin() is true for owner AND admin)
--   dave   admin,  org A
--   bob    member, org A, ACTIVE — the ordinary member the wall is about
--   erin   owner,  org B   — a different organisation's most privileged
--                            person, who must be refused for a reason that
--                            has nothing to do with roles; her refusal is
--                            what proves the org wall did not quietly become
--                            the only wall
--
-- BOB IS 02 AND HE IS ACTIVE, which is the load-bearing half of this
-- fixture. The first version of this file used 04 — who is DAN, and dan is
-- PENDING. Every "a member cannot" line would have passed, and every one of
-- them would have been measuring `actor_is_active()` instead of
-- `actor_is_admin()`: a green file asserting nothing about the rule it was
-- written for. It was caught only because the RENAME assertion looks at the
-- record afterwards, and a pending user cannot read the record either.
-- Rule 9, in the file, on the day: a fixture derived from what the author
-- believed the roster to be.

reset role;

insert into echo.project (id, org_id, name, created_by)
values ('a6000000-0000-4000-8000-000000000f01'::uuid,
        '0a000000-0000-4000-8000-00000000000a',
        'بازطراحی', '01000000-0000-4000-8000-000000000001');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0186 tests run under a non-bypass product role');

-- ─── A MEMBER MAY NOT MAKE ONE ──────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, ACTIVE member
select t.denied(
  $$insert into echo.project (org_id, name, created_by)
    values (echo.actor_org_id(), 'پروژهٔ باب', echo.actor_id())$$,
  '0186: a member cannot create a project');

/*
 * AN UPDATE IS NOT REFUSED, IT MATCHES NOTHING — and the difference is why
 * this is not a `t.denied`. A policy's USING clause FILTERS the rows an
 * UPDATE can see; bob's filter excludes every project, so his statement is a
 * legal update of zero rows and raises nothing at all. Writing it as a denial
 * cost one red and is worth the paragraph: an `insert` violating WITH CHECK
 * throws, an `update` walled by USING quietly does nothing, and a test that
 * demands the wrong one reports a working wall as broken.
 *
 * So the assertion is on the RECORD: the name did not move.
 */
update echo.project set name = 'نام تازه'
 where id = 'a6000000-0000-4000-8000-000000000f01'::uuid;
select t.ok(
  (select count(*) from echo.project
    where id = 'a6000000-0000-4000-8000-000000000f01'::uuid and name = 'بازطراحی') = 1,
  '0186: a member''s rename touches nothing — the project keeps its name');

select t.denied(
  $$insert into echo.project_member (project_id, user_id, org_id, added_by)
    values ('a6000000-0000-4000-8000-000000000f01'::uuid, echo.actor_id(),
            echo.actor_org_id(), echo.actor_id())$$,
  '0186: a member cannot put themselves — or anybody — on a project');

-- ─── AND STILL SEES EVERY PROJECT ───────────────────────────────────────
/* the half a narrowing usually takes with it by accident. The wall is about
   who may HAND OUT work, never about who may know what the team is doing
   (0181's ruling, unchanged) — and a member who cannot see the project they
   were added to would be the feature failing at its own purpose. */
select t.ok(
  exists (select 1 from echo.project where id = 'a6000000-0000-4000-8000-000000000f01'::uuid),
  '0186: a member still reads every project in their org');

-- ─── THE ORDINARY PATH: an admin does all three ─────────────────────────
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true); -- dave, admin
insert into echo.project (id, org_id, name, created_by)
values ('a6000000-0000-4000-8000-000000000f02'::uuid,
        echo.actor_org_id(), 'پروژهٔ دیوید', echo.actor_id());
select t.ok(
  exists (select 1 from echo.project where id = 'a6000000-0000-4000-8000-000000000f02'::uuid),
  '0186: an admin creates a project');

update echo.project set name = 'پروژهٔ دیوید ۲'
 where id = 'a6000000-0000-4000-8000-000000000f02'::uuid;
select t.ok(
  (select name from echo.project where id = 'a6000000-0000-4000-8000-000000000f02'::uuid)
    = 'پروژهٔ دیوید ۲',
  '0186: an admin renames a project');

insert into echo.project_member (project_id, user_id, org_id, added_by)
values ('a6000000-0000-4000-8000-000000000f02'::uuid,
        '02000000-0000-4000-8000-000000000002', echo.actor_org_id(), echo.actor_id());
select t.ok(
  exists (select 1 from echo.project_member
           where project_id = 'a6000000-0000-4000-8000-000000000f02'::uuid
             and user_id = '02000000-0000-4000-8000-000000000002'),
  '0186: an admin puts a colleague on a project');

-- ─── ANOTHER ORG'S ADMIN IS STILL A STRANGER ────────────────────────────
/* the control that keeps the three refusals above meaningful: they must fail
   for the ROLE, and this one must fail for the ORG. A wall that had collapsed
   into "admins may do anything" would pass every line before this one. */
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true); -- erin, org B admin
select t.ok(
  not exists (select 1 from echo.project where id = 'a6000000-0000-4000-8000-000000000f01'::uuid),
  '0186: another org''s admin cannot even see the project');
update echo.project set name = 'taken'
 where id = 'a6000000-0000-4000-8000-000000000f01'::uuid;

/* READ AT OWNER ALTITUDE, and this is the counting corollary rather than
   tidiness: erin cannot see this project AT ALL, so asking her whether it
   still has its name returns zero either way — "I cannot see it" and "it was
   renamed" are the same answer from where she stands. The question is about
   the ROW, so it is asked from above the wall. (Bob's rename above is read as
   bob on purpose: he CAN see every project, so his own view is the honest
   place to check that nothing moved.) */
reset role;
select t.ok(
  (select count(*) from echo.project
    where id = 'a6000000-0000-4000-8000-000000000f01'::uuid and name = 'بازطراحی') = 1,
  '0186: another org''s owner renames nothing either');
set local role echo_app;

-- ─── THE SCHEDULE ───────────────────────────────────────────────────────
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob, ACTIVE member, a member

/* NOT admin-walled, and that is deliberate (0186's header): a repeating
   reminder on your own card is an ordinary thing to want, and the admin wall
   belongs on the surface for handing work to somebody else. */
insert into echo.task_recurrence (id, org_id, gap_days, created_by)
values ('a6000000-0000-4000-8000-000000000e01'::uuid,
        echo.actor_org_id(), 7, echo.actor_id());
select t.ok(
  exists (select 1 from echo.task_recurrence where id = 'a6000000-0000-4000-8000-000000000e01'::uuid),
  '0186: a member may schedule their own repeating task');

select t.denied(
  $$insert into echo.task_recurrence (org_id, gap_days, created_by)
    values (echo.actor_org_id(), 400, echo.actor_id())$$,
  '0186: a gap of 400 days is refused by the constraint');

select t.denied(
  $$insert into echo.task_recurrence (org_id, gap_days, created_by)
    values (echo.actor_org_id(), -1, echo.actor_id())$$,
  '0186: a negative gap is refused — a renewal cannot fall due before the completion');

/* the author cannot be somebody else: the same shape every other created_by
   in this schema carries, asserted here because a schedule is a thing one
   person imposed on another person's card */
select t.denied(
  $$insert into echo.task_recurrence (org_id, gap_days, created_by)
    values (echo.actor_org_id(), 1, '01000000-0000-4000-8000-000000000001')$$,
  '0186: a schedule cannot be written under somebody else''s name');

-- ─── NOBODY DELETES A TASK'S HISTORY BY STOPPING ITS SCHEDULE ───────────
reset role;
insert into echo.task_column (id, org_id, name, tone, position, created_by)
values ('a6000000-0000-4000-8000-000000000c01'::uuid,
        '0a000000-0000-4000-8000-00000000000a', 'بک‌لاگ', 'grey', 1,
        '01000000-0000-4000-8000-000000000001');
insert into echo.task (id, org_id, column_id, title, recurrence_id, created_by)
values ('a6000000-0000-4000-8000-000000000d01',
        '0a000000-0000-4000-8000-00000000000a',
        'a6000000-0000-4000-8000-000000000c01',
        'نظافت هفتگی',
        'a6000000-0000-4000-8000-000000000e01',
        '02000000-0000-4000-8000-000000000002');

delete from echo.task_recurrence where id = 'a6000000-0000-4000-8000-000000000e01'::uuid;
/*
 * THE STATEMENT THAT FOUND 0188. A composite FK's `on delete set null` nulls
 * EVERY column in the key — `org_id` included, which is NOT NULL — so this
 * delete did not null a pointer, it RAISED, and «توقف تکرار» would have been
 * a 500 for every task that had ever been scheduled. Both halves are asserted
 * because the fix has to null exactly one of them.
 */
select t.ok(
  exists (select 1 from echo.task where id = 'a6000000-0000-4000-8000-000000000d01'::uuid)
  and (select org_id from echo.task where id = 'a6000000-0000-4000-8000-000000000d01'::uuid)
      = '0a000000-0000-4000-8000-00000000000a'::uuid
  and (select recurrence_id from echo.task where id = 'a6000000-0000-4000-8000-000000000d01'::uuid) is null,
  '0186: stopping a schedule nulls the LINK, keeps the org, and keeps the work already done');

-- ─── the agent speaks about schedules and never writes one ──────────────
select t.ok(
  not has_table_privilege('echo_agent', 'echo.task_recurrence', 'insert')
  and not has_table_privilege('echo_agent', 'echo.task_recurrence', 'update')
  and not has_table_privilege('echo_agent', 'echo.task_recurrence', 'delete')
  and has_table_privilege('echo_agent', 'echo.task_recurrence', 'select'),
  '0186: the agent reads a schedule and can never write one');

-- ─── and the history learned the word without losing the others ─────────
select t.ok(
  (select count(*) from unnest(array[
     'created', 'done', 'undone', 'moved', 'renamed', 'priority',
     'due_set', 'due_cleared', 'assigned', 'unassigned',
     'label_added', 'label_removed', 'archived', 'restored', 'renewed']) as k
    where pg_get_constraintdef(
      (select oid from pg_constraint where conname = 'task_event_kind_check')) like '%' || k || '%') = 15,
  '0186: the event vocabulary carries all fifteen kinds');
