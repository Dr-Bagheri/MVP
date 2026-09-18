-- db/0231 — the alarms: one table for what a person typed, one for what they
-- have seen, and nothing at all for the two kinds the server works out.
--
-- THE WHOLE MATRIX. What this holds in place is the set of facts that a
-- plausible implementation gets silently wrong:
--
--   · an alarm is OWN-ONLY in every direction — an admin reading a
--     colleague's alarms would be reading their diary
--   · the AGENT holds nothing: agents set alarms through the person's own
--     browser, and a server-side grant would be a different feature
--   · an acknowledgement cannot be edited or removed by the product —
--     "un-seeing" is not an act this platform has
--   · an alarm cannot be written for somebody else, or into another org
--   · the purge takes both tables (a purge that raises does not run)
--
--   alice  01…  owner,  org A      dan  04…  PENDING, org A
--   bob    02…  member, org A      erin 05…  org B
--   org A  0a…a   org B  0b…b

reset role;
select t.ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'echo' and c.relname in ('reminder', 'reminder_ack')) = 2,
  '0231: echo.reminder and echo.reminder_ack exist');

select t.ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'echo' and c.relname in ('reminder', 'reminder_ack')
      and c.relrowsecurity and c.relforcerowsecurity) = 2,
  '0231: both alarm tables have RLS enabled AND forced');

-- THE AGENT HOLDS NOTHING. Asserted at the GRANT, which is where it is true:
-- a policy can be widened by a later migration without anybody noticing, and
-- a missing grant refuses before a policy is ever consulted.
select t.ok(
  not has_table_privilege('echo_agent', 'echo.reminder', 'select, insert, update, delete')
  and not has_table_privilege('echo_agent', 'echo.reminder_ack', 'select, insert, update, delete'),
  '0231: echo_agent holds no privilege on either alarm table');

-- and nobody may un-see one
select t.ok(
  not has_table_privilege('echo_app', 'echo.reminder_ack', 'update')
  and not has_table_privilege('echo_app', 'echo.reminder_ack', 'delete'),
  '0231: an acknowledgement cannot be edited or removed by the product');

set local role echo_app;
select t.ok(
  not (select rolbypassrls from pg_roles where rolname = current_user),
  '0231 tests run under a non-bypass product role');

-- ─── AN ORDINARY MEMBER SETS THEIR OWN ALARM ──────────────────────────────
-- The ordinary path is the product: this is the one a person actually walks,
-- and asserting only the refusals would leave it unproven (rule 7's
-- authorization-matrix corollary).
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true); -- bob

insert into echo.reminder (id, org_id, user_id, at, label, created_by)
values ('a1000000-0000-4000-8000-000000000a01'::uuid, echo.actor_org_id(),
        echo.actor_id(), now() + interval '1 hour', 'دیتاست صوتی', echo.actor_id());

select t.ok(
  (select count(*) from echo.reminder where id = 'a1000000-0000-4000-8000-000000000a01') = 1,
  '0231: a member sets an alarm for themselves');

-- and reads it back
select t.ok(
  (select label from echo.reminder where id = 'a1000000-0000-4000-8000-000000000a01') = 'دیتاست صوتی',
  '0231: and reads their own alarm back, Persian intact');

-- dismissing is an UPDATE of their own row
update echo.reminder set dismissed_at = now()
 where id = 'a1000000-0000-4000-8000-000000000a01';
select t.ok(
  (select dismissed_at is not null from echo.reminder
    where id = 'a1000000-0000-4000-8000-000000000a01'),
  '0231: a person dismisses their own alarm');

-- ─── AN ALARM IS NOT WRITABLE FOR SOMEBODY ELSE ───────────────────────────
-- The insert policy names both `user_id` and `created_by`, so this is refused
-- by the WITH CHECK rather than by a caller remembering to fill them in.
select t.denied($$
  insert into echo.reminder (org_id, user_id, at, label, created_by)
  values (echo.actor_org_id(), '01000000-0000-4000-8000-000000000001',
          now(), 'wake alice', echo.actor_id())
$$, '0231: a member cannot set an alarm for a colleague');

-- nor into another organisation
select t.denied($$
  insert into echo.reminder (org_id, user_id, at, label, created_by)
  values ('0b000000-0000-4000-8000-00000000000b', echo.actor_id(),
          now(), 'cross-org', echo.actor_id())
$$, '0231: a member cannot set an alarm in another organisation');

-- ─── A COLLEAGUE'S ALARMS ARE NOT READABLE, ADMIN INCLUDED ────────────────
-- Read at ALICE, who is the org's OWNER: if rank bought a look at this table
-- anywhere, it would be here.
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true); -- alice, owner
select t.ok(
  (select count(*) from echo.reminder
    where user_id = '02000000-0000-4000-8000-000000000002') = 0,
  '0231: the org OWNER cannot read a member''s alarms');

-- and cannot dismiss one either: an UPDATE walled by a policy is not refused,
-- it matches zero rows, so the assertion is on the RECORD (0186's note)
update echo.reminder set dismissed_at = null
 where id = 'a1000000-0000-4000-8000-000000000a01';
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok(
  (select dismissed_at is not null from echo.reminder
    where id = 'a1000000-0000-4000-8000-000000000a01'),
  '0231: the owner''s attempt to un-dismiss a member''s alarm changed nothing');

-- ─── THE ACKNOWLEDGEMENT OF A COMPUTED ALARM ─────────────────────────────
insert into echo.reminder_ack (org_id, user_id, key)
values (echo.actor_org_id(), echo.actor_id(),
        'task:11111111-1111-4111-8111-111111111111:2026-09-19T10:00:00.000Z');
select t.ok(
  (select count(*) from echo.reminder_ack where user_id = echo.actor_id()) = 1,
  '0231: a person acknowledges a computed alarm');

-- THE KEY CARRIES THE INSTANT, so moving a deadline alarms again rather than
-- inheriting the acknowledgement of a deadline that no longer exists. Proven
-- by inserting the SAME task at a NEW instant and watching it be a new row —
-- a key built from the id alone would be refused by the primary key here.
insert into echo.reminder_ack (org_id, user_id, key)
values (echo.actor_org_id(), echo.actor_id(),
        'task:11111111-1111-4111-8111-111111111111:2026-09-20T10:00:00.000Z');
select t.ok(
  (select count(*) from echo.reminder_ack where user_id = echo.actor_id()) = 2,
  '0231: the same task at a NEW deadline is a new key, so it alarms again');

-- a second ack of the SAME key is the primary key's job, not a duplicate row
select t.raises($$
  insert into echo.reminder_ack (org_id, user_id, key)
  values (echo.actor_org_id(), echo.actor_id(),
          'task:11111111-1111-4111-8111-111111111111:2026-09-19T10:00:00.000Z')
$$, '23505', '0231: acknowledging the same alarm twice is refused by the key');

-- and a colleague's acknowledgements are invisible, exactly as their alarms are
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select count(*) from echo.reminder_ack
    where user_id = '02000000-0000-4000-8000-000000000002') = 0,
  '0231: the owner cannot read a member''s acknowledgements');

-- ─── A PENDING MEMBER WRITES NOTHING ──────────────────────────────────────
-- Dan is pending: `actor_org_id()` finds no active membership for him, so the
-- WITH CHECK cannot be satisfied. The alarm surface is not a way in.
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true); -- dan
select t.denied($$
  insert into echo.reminder (org_id, user_id, at, label, created_by)
  values ('0a000000-0000-4000-8000-00000000000a', echo.actor_id(),
          now(), 'pending', echo.actor_id())
$$, '0231: a PENDING member cannot set an alarm');

reset role;
