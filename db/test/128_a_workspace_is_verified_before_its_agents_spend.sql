-- db/0224 — a workspace is verified before its agents spend (M54).
--
-- The migration's self-checks ran once, on the day it was applied, and could
-- not walk the console door at all (its audit value was born in the same
-- transaction). This file is the standing version, and it walks the whole
-- matrix both ways:
--   · a workspace founded through the gate is UNVERIFIED; a birth anywhere
--     else is verified from its first second;
--   · the wall: an unverified organisation's agent cannot open a run — at the
--     AGENT role, where the runtime writes — and the same insert succeeds the
--     moment the workspace is verified (the control, without which the wall
--     is satisfied by a trigger that refuses everyone);
--   · the platform root verifies through the door, twice is a no-op, the list
--     door carries the fact, the act is audited, and the root can take it
--     back (D27: the exit is built with the entrance);
--   · a member is not a root, and the agent role cannot reach the door.
--
-- No temp tables (a role switch cannot read one made under another role);
-- the founded org's id travels in a session setting, the 50/80 device.

reset role;
insert into auth.users (id, email) values
  ('19200000-0000-4000-8000-000000000128', 'solo-128@example.com');
-- the fixture marks nothing; say so rather than assume it
select t.ok(
  not exists (select 1 from echo.org where accepts_signups),
  '128: the fixture marks no intake org — the probe runs in B2C mode');

-- ── the gate founds an UNVERIFIED workspace ──────────────────────────────
set local role echo_app;
select set_config('t.org_128',
  (echo.register_account('19200000-0000-4000-8000-000000000128'::uuid,
                         'solo-128@example.com'::citext, 'Solo 128')).org_id::text,
  true);

reset role;
select t.ok(
  (select verified_at from echo.org where id = current_setting('t.org_128')::uuid) is null,
  '128: a workspace founded through the gate is born unverified');

-- and a birth anywhere else is verified by default — the discriminating half
insert into echo.org (name) values ('128 console-born');
select t.ok(
  (select verified_at is not null from echo.org where name = '128 console-born'),
  '128: an organisation made outside the gate is verified from its first second');

-- ── the wall, at the agent's altitude ────────────────────────────────────
-- (the runtime opens every run on echo_agent — run-store.ts's AGENT_ROLE)
set local role echo_agent;
select set_config('echo.actor_id', '19200000-0000-4000-8000-000000000128', true);
select t.raises(
  $q$insert into echo.agent_run (org_id, actor_id, kind, model)
     values (current_setting('t.org_128')::uuid,
             '19200000-0000-4000-8000-000000000128', 'assistant', 'probe/128')$q$,
  '42501',
  '128: an unverified workspace cannot open an agent run — the wall');

-- ── the platform root verifies, through the door ─────────────────────────
reset role;
insert into echo.platform_operator (user_id)
values ('01000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.ok(
  echo.platform_set_org_verified('01000000-0000-4000-8000-000000000001',
                                 current_setting('t.org_128')::uuid, true, 'a real person — looked'),
  '128: the root verifies the workspace, and the door says it changed');
select t.ok(
  not echo.platform_set_org_verified('01000000-0000-4000-8000-000000000001',
                                     current_setting('t.org_128')::uuid, true, 'a real person — looked'),
  '128: verifying twice changes nothing (a no-op is not a change)');
select t.ok(
  exists (select 1 from echo.platform_list_orgs() o
           where o.id = current_setting('t.org_128')::uuid and o.verified_at is not null),
  '128: the list door carries the fact the console renders');

-- ── the control: the same insert opens a run now ─────────────────────────
set local role echo_agent;
select set_config('echo.actor_id', '19200000-0000-4000-8000-000000000128', true);
insert into echo.agent_run (org_id, actor_id, kind, model)
values (current_setting('t.org_128')::uuid,
        '19200000-0000-4000-8000-000000000128', 'assistant', 'probe/128');
select t.ok(
  exists (select 1 from echo.agent_run
           where org_id = current_setting('t.org_128')::uuid and model = 'probe/128'),
  '128: a verified workspace opens a run — the control that makes the wall a wall');

-- ── the exit is built with the entrance (D27) ────────────────────────────
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  echo.platform_set_org_verified('01000000-0000-4000-8000-000000000001',
                                 current_setting('t.org_128')::uuid, false, 'taken back for the probe'),
  '128: the root can take a verification back');
set local role echo_agent;
select set_config('echo.actor_id', '19200000-0000-4000-8000-000000000128', true);
select t.raises(
  $q$insert into echo.agent_run (org_id, actor_id, kind, model)
     values (current_setting('t.org_128')::uuid,
             '19200000-0000-4000-8000-000000000128', 'assistant', 'probe/128-again')$q$,
  '42501',
  '128: taken back, the wall stands again');

-- ── who may not ──────────────────────────────────────────────────────────
-- the founder is an OWNER of their own workspace and still not a platform
-- root: the door refuses them by name
set local role echo_app;
select set_config('echo.actor_id', '19200000-0000-4000-8000-000000000128', true);
select t.raises(
  $q$select echo.platform_set_org_verified('19200000-0000-4000-8000-000000000128',
                                          current_setting('t.org_128')::uuid, true, 'verifying myself')$q$,
  '42501',
  '128: an owner cannot verify their own workspace — platform-root authority required');

reset role;
select t.ok(
  not has_function_privilege('echo_agent', 'echo.platform_set_org_verified(uuid, uuid, boolean, text)', 'execute'),
  '128: the agent role cannot reach the verification door');
select t.ok(
  not has_function_privilege('public', 'echo.tg_agent_run_needs_verified_org()', 'execute'),
  '128: the wall''s trigger function is not PUBLIC''s to execute');

-- ── the act is on the record ─────────────────────────────────────────────
select t.ok(
  (select count(*) from echo.platform_audit
     where action = 'org_verification_set'
       and target_org_id = current_setting('t.org_128')::uuid
       and actor_id = '01000000-0000-4000-8000-000000000001') = 2,
  '128: verifying and taking it back are two audit lines under the root''s name — the no-op wrote none');
