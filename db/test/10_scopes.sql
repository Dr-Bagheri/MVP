-- Who can see what. SPEC's two roles and two scopes, as executable claims.

-- --- bob: a member, sees his own and what his org shares ------------------
reset role;
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.ok((select count(*) from echo.call) = 2,
  'bob sees exactly his private call and his org-scoped call');
select t.ok(not exists (select 1 from echo.call where id = 'c3000000-0000-4000-8000-000000000003'),
  'bob cannot see carol''s private call');
select t.ok(not exists (select 1 from echo.call where deleted_at is not null),
  'a soft-deleted call is gone for its own owner');
select t.ok((select count(*) from echo.transcript_segment) = 3,
  'bob reads the transcripts of the calls he can open, and no others');

-- --- carol: the same rules, from the other side ---------------------------
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);

select t.ok((select count(*) from echo.call) = 2,
  'carol sees her own private call and the org-scoped one');
select t.ok(exists (select 1 from echo.call where id = 'c2000000-0000-4000-8000-000000000002'),
  'org scope means every member of the org, not just the owner');
select t.ok((select count(*) from echo.transcript_segment
             where call_id = 'c1000000-0000-4000-8000-000000000001') = 0,
  'carol cannot reach a private call''s transcript through the child table');

-- --- alice: an admin reads everything in her org, including deleted -------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.ok((select count(*) from echo.call) = 5,
  'the admin reads every call in her org');
select t.ok((select count(*) from echo.call where deleted_at is not null) = 2,
  'soft-deleted calls stay visible to the admin for the purge window (M11)');

-- --- erin: another org entirely -------------------------------------------
select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);

select t.ok((select count(*) from echo.call
             where org_id = '0a000000-0000-4000-8000-00000000000a') = 0,
  'an admin of another org sees none of org A''s calls');
select t.ok((select count(*) from echo.call) = 1,
  'erin sees only her own org');
select t.ok((select count(*) from echo.transcript_segment) = 0,
  'and none of org A''s transcripts');
select t.ok((select count(*) from echo.app_user) = 1,
  'the member directory does not cross org boundaries');

-- --- dan: registered, not yet accepted (M15) ------------------------------
select set_config('echo.actor_id', '04000000-0000-4000-8000-000000000004', true);

select t.ok((select count(*) from echo.call) = 0,
  'a pending user sees no calls');
select t.ok((select count(*) from echo.transcript_segment) = 0,
  'a pending user sees no transcripts');
select t.ok((select count(*) from echo.person) = 0,
  'a pending user does not get the org speaker directory');
select t.ok((select count(*) from echo.app_user) = 1,
  'a pending user can read exactly one row — their own, so the UI can say "awaiting approval"');

-- --- no identity at all ---------------------------------------------------
select set_config('echo.actor_id', '', true);

select t.ok((select count(*) from echo.call) = 0,
  'no identity, no rows (invariant 2)');
select t.ok((select count(*) from echo.app_user) = 0,
  'not even the member list');
select t.ok((select count(*) from echo.org) = 0,
  'not even the org');

-- --- the derived view inherits the wall -----------------------------------
-- A view runs as its owner unless it says otherwise; this proves 0008's
-- security_invoker is actually in force.
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok((select count(*) from echo.call_current_summary) = 1,
  'carol sees only the org-scoped call''s summary through the view');

select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok((select count(*) from echo.call_current_summary) = 2,
  'the admin sees the deleted call''s summary too — the view did not become a bypass');

reset role;
