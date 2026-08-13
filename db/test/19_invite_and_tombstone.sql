-- The two doors into an org, and the one way out of it (M24).

reset role;
set local role echo_app;

-- ===========================================================================
-- Invitations
-- ===========================================================================
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);  -- dave, admin

insert into echo.invitation (id, org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
values ('71000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
        'newbie@example.com', 'member', '06000000-0000-4000-8000-000000000006',
        'sha-invite-live', 'inv_live', now() + interval '7 days');
select t.ok((select count(*) from echo.invitation) = 1,
  'an admin invites a member');

-- Only the owner may invite into the admin tier — the same rule as promotion
-- (D22), for the same reason: an admin who could invite a peer would create
-- someone they then cannot manage.
select t.denied(
  $$insert into echo.invitation (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
    values ('0a000000-0000-4000-8000-00000000000a','wants-admin@example.com','admin',
            '06000000-0000-4000-8000-000000000006','sha-x','inv_x', now() + interval '7 days')$$,
  'but cannot invite an admin');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);  -- alice, owner
insert into echo.invitation (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
values ('0a000000-0000-4000-8000-00000000000a', 'new-admin@example.com', 'admin',
        '01000000-0000-4000-8000-000000000001', 'sha-invite-admin', 'inv_adm',
        now() + interval '7 days');
select t.ok((select count(*) from echo.invitation where role = 'admin') = 1,
  'the owner can');

select t.denied(
  $$insert into echo.invitation (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
    values ('0a000000-0000-4000-8000-00000000000a','heir@example.com','owner',
            '01000000-0000-4000-8000-000000000001','sha-o','inv_o', now() + interval '7 days')$$,
  'and nobody invites an owner — ownership transfers by an explicit act, not by a link');

select t.denied(
  $$insert into echo.invitation (org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
    values ('0a000000-0000-4000-8000-00000000000a','newbie@example.com','member',
            '01000000-0000-4000-8000-000000000001','sha-dup','inv_dup', now() + interval '7 days')$$,
  'one live invitation per address — re-inviting must replace, not duplicate');

select t.denied(
  $$update echo.invitation set role = 'admin'
     where id = '71000000-0000-4000-8000-000000000001'$$,
  'an invitation''s terms cannot change after it is issued');

-- A member sees none of this.
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.ok((select count(*) from echo.invitation) = 0,
  'invitations are an admin surface');

-- --- redemption: the invitation IS the acceptance -------------------------
reset role;
insert into auth.users (id, email) values
  ('72000000-0000-4000-8000-000000000002', 'newbie@example.com');
set local role echo_app;

select t.denied(
  $$select echo.redeem_invitation('sha-invite-live',
      '72000000-0000-4000-8000-000000000002','someone-else@example.com')$$,
  'a forwarded link is refused — the address must match the invitation');

select t.ok(
  (select status from echo.redeem_invitation('sha-invite-live',
     '72000000-0000-4000-8000-000000000002', 'newbie@example.com')) = 'active',
  'the invited person arrives ACTIVE — someone vouched for them by name, so a second gate decides nothing');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select accepted_by from echo.app_user where id = '72000000-0000-4000-8000-000000000002')
    = '06000000-0000-4000-8000-000000000006',
  'and the acceptance names the person who invited them');
select t.ok(
  (select redeemed_by from echo.invitation where id = '71000000-0000-4000-8000-000000000001')
    = '72000000-0000-4000-8000-000000000002',
  'the invitation records who used it');

select t.denied(
  $$select echo.redeem_invitation('sha-invite-live',
      '72000000-0000-4000-8000-000000000002','newbie@example.com')$$,
  'and cannot be used twice');
select t.denied(
  $$select echo.redeem_invitation('sha-nonexistent',
      '72000000-0000-4000-8000-000000000002','newbie@example.com')$$,
  'an unknown token is refused identically — the endpoint is not a probe for valid ones');

-- ===========================================================================
-- Tombstone
-- ===========================================================================
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
select t.denied(
  $$select echo.tombstone_user('03000000-0000-4000-8000-000000000003')$$,
  'an admin cannot true-delete a person — that is an org-level irreversible (M23)');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.denied(
  $$select echo.tombstone_user('01000000-0000-4000-8000-000000000001')$$,
  'the owner cannot delete themselves; transfer ownership first');

-- Give carol a handle first: the fixture's people have none (the 0039 backfill
-- only touched rows that existed when it ran), and "the handle survives"
-- asserted against a NULL would pass without testing anything.
reset role;
update echo.app_user set username = 'carol'
 where id = '03000000-0000-4000-8000-000000000003';
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

-- carol owns c3 and has edited a transcript line, so her row is referenced.
select t.ok(echo.tombstone_user('03000000-0000-4000-8000-000000000003'),
  'the owner true-deletes a member');

select t.ok(
  (select display_name = '' and display_name_en is null and avatar_url is null
      and status = 'disabled' and tombstoned_by = '01000000-0000-4000-8000-000000000001'
     from echo.app_user where id = '03000000-0000-4000-8000-000000000003'),
  'the person is emptied out and marked');
select t.ok(
  (select email::text like 'deleted-%@tombstone.invalid'
     from echo.app_user where id = '03000000-0000-4000-8000-000000000003'),
  'their address is replaced rather than cleared — it is NOT NULL and unique');

-- The ratified ruling, asserted.
select t.ok(
  (select username from echo.app_user
    where id = '03000000-0000-4000-8000-000000000003') = 'carol',
  'the handle is RESERVED, not freed — a reference to @carol must not later resolve to someone else');

reset role;
insert into auth.users (id, email) values ('73000000-0000-4000-8000-000000000003', 'newcomer@example.com');
select t.denied(
  $$insert into echo.app_user (id, org_id, email, role, status, accepted_at, username)
    values ('73000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-00000000000a',
            'newcomer@example.com','member','active', now(), 'carol')$$,
  'so a newcomer cannot wear a departed colleague''s handle');

-- The audit still resolves: the row is gone as a person, present as a referent.
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select count(*) from echo.app_user where id = '03000000-0000-4000-8000-000000000003') = 1,
  'the row survives, so everything pointing at it still resolves');
select t.ok(
  (select count(*) from echo.call
    where owner_id = '03000000-0000-4000-8000-000000000003'
      and deleted_at is not null
      and deleted_by = '01000000-0000-4000-8000-000000000001') = 1,
  'their calls are soft-deleted, attributed to whoever deleted them — the purge window applies as normal');

select t.ok(not echo.tombstone_user('03000000-0000-4000-8000-000000000003'),
  'deleting them again is false, not an error');

reset role;
