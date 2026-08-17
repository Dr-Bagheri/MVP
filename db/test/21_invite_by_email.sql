-- 0060: the by-email door — an invitation redeems on the VERIFIED address
-- alone at first sign-in (the platform emails the link; no token is shown).
--
-- The matrix walked in full (rule 7's authorization corollary): the invited
-- address redeems; the uninvited address gets NULL (absence is a value —
-- every signup asks this first, and "no invitation" routes to org-choice);
-- revoked and expired invitations get NULL identically; the newest of two
-- live invitations wins.

reset role;
set local role echo_app;

-- an admin issues the invitation the door will consume
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);  -- dave, admin
insert into echo.invitation (id, org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
values ('73000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
        'emailed@example.com', 'member', '06000000-0000-4000-8000-000000000006',
        'sha-by-email-live', 'inv_em1', now() + interval '7 days');

-- the auth identity that will arrive by the emailed link
reset role;
insert into auth.users (id, email) values
  ('74000000-0000-4000-8000-000000000001', 'emailed@example.com'),
  ('74000000-0000-4000-8000-000000000002', 'stranger@example.com');
set local role echo_app;

-- an address nobody invited: NULL, not an error — the normal signup answer
select t.ok(
  (select echo.redeem_invitation_for_email(
     '74000000-0000-4000-8000-000000000002', 'stranger@example.com')) is null,
  'an uninvited address gets NULL — absence is the normal answer, not a fault');

-- the invited address arrives ACTIVE with the granted role — AND a name
-- (0064: the first live arrival was a nameless row, because the door
-- hardcoded '')
select t.ok(
  (select (echo.redeem_invitation_for_email(
     '74000000-0000-4000-8000-000000000001', 'emailed@example.com', 'کاربر دعوتی')).status) = 'active',
  'the emailed invitation redeems on the verified address alone — active on arrival');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok(
  (select display_name from echo.app_user
    where id = '74000000-0000-4000-8000-000000000001') = 'کاربر دعوتی',
  'and the arrival carries the display name the door was handed (0064)');
select set_config('echo.actor_id', '', true);

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);  -- alice, owner
select t.ok(
  (select role from echo.app_user where id = '74000000-0000-4000-8000-000000000001') = 'member',
  'with exactly the role the invitation granted');
select t.ok(
  (select redeemed_by from echo.invitation where id = '73000000-0000-4000-8000-000000000001')
    = '74000000-0000-4000-8000-000000000001',
  'and the invitation is stamped redeemed by the arriver');

-- a REVOKED invitation is not a door (same answer as none at all)
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
insert into echo.invitation (id, org_id, email, role, invited_by, token_sha256, token_prefix, expires_at, revoked_at, revoked_by)
values ('73000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
        'revoked@example.com', 'member', '06000000-0000-4000-8000-000000000006',
        'sha-by-email-revoked', 'inv_em2', now() + interval '7 days',
        now(), '06000000-0000-4000-8000-000000000006');
reset role;
insert into auth.users (id, email) values
  ('74000000-0000-4000-8000-000000000003', 'revoked@example.com');
set local role echo_app;
select t.ok(
  (select echo.redeem_invitation_for_email(
     '74000000-0000-4000-8000-000000000003', 'revoked@example.com')) is null,
  'a revoked invitation answers exactly like no invitation');

-- an EXPIRED invitation is not a door either
select set_config('echo.actor_id', '06000000-0000-4000-8000-000000000006', true);
insert into echo.invitation (id, org_id, email, role, invited_by, token_sha256, token_prefix, expires_at)
values ('73000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-00000000000a',
        'late@example.com', 'member', '06000000-0000-4000-8000-000000000006',
        'sha-by-email-expired', 'inv_em3', now() - interval '1 hour');
reset role;
insert into auth.users (id, email) values
  ('74000000-0000-4000-8000-000000000004', 'late@example.com');
set local role echo_app;
select t.ok(
  (select echo.redeem_invitation_for_email(
     '74000000-0000-4000-8000-000000000004', 'late@example.com')) is null,
  'an expired invitation answers exactly like no invitation');
