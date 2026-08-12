-- What each person may CHANGE — the rules RLS cannot express, enforced by
-- the triggers in 0011.

-- --- an admin may delete anything, and rewrite nothing ---------------------
reset role;
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.denied(
  $$update echo.call set title = 'دستکاری‌شده'
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'an admin cannot retitle a call they do not own');
select t.denied(
  $$update echo.call set scope = 'org'
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'an admin cannot publish someone else''s private call to the org');

update echo.call set deleted_at = now()
 where id = 'c1000000-0000-4000-8000-000000000001';
select t.ok(
  (select deleted_by from echo.call where id = 'c1000000-0000-4000-8000-000000000001')
    = '01000000-0000-4000-8000-000000000001',
  'an admin may delete a member''s private recording (M11), and the record says who did');
select t.ok(
  (select purge_after > now() + interval '29 days'
     from echo.call where id = 'c1000000-0000-4000-8000-000000000001'),
  'deletion opens a 30-day purge window, stamped by the database not the caller');

-- --- the owner may edit their own ------------------------------------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

update echo.call set title = 'مذاکره قرارداد — نسخه ۲'
 where id = 'c2000000-0000-4000-8000-000000000002';
select t.ok(
  (select title from echo.call where id = 'c2000000-0000-4000-8000-000000000002')
    = 'مذاکره قرارداد — نسخه ۲',
  'the owner may retitle their own call');

select t.denied(
  $$update echo.call set owner_id = '03000000-0000-4000-8000-000000000003'
     where id = 'c2000000-0000-4000-8000-000000000002'$$,
  'a call cannot be handed to someone else, by anyone');

-- --- a member cannot reach another member's call at all --------------------
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.writes_nothing(
  $$update echo.call set title = 'x' where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'a member cannot edit a call they cannot even see');

-- --- nobody promotes themselves (M15) --------------------------------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.denied(
  $$update echo.app_user set role = 'admin'
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'a member cannot make themselves an admin');
select t.denied(
  $$update echo.app_user set status = 'active'
     where id = '04000000-0000-4000-8000-000000000004'$$,
  'a member cannot accept a pending colleague');

update echo.app_user set display_name = 'باب ب.'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select display_name from echo.app_user where id = '02000000-0000-4000-8000-000000000002')
    = 'باب ب.',
  'a member may still edit their own profile');

-- --- acceptance is an admin decision about someone else --------------------
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

update echo.app_user set status = 'active'
 where id = '04000000-0000-4000-8000-000000000004';
select t.ok(
  (select accepted_by = '01000000-0000-4000-8000-000000000001' and accepted_at is not null
     from echo.app_user where id = '04000000-0000-4000-8000-000000000004'),
  'accepting a pending user records who accepted them and when (M15)');

select t.denied(
  $$update echo.app_user set role = 'member'
     where id = '01000000-0000-4000-8000-000000000001'$$,
  'an admin may not change their own role or status');

-- --- versions survive; the record is not editable --------------------------
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

select t.denied(
  $$update echo.summary set body = 'بازنویسی'
     where id = 'b2000000-0000-4000-8000-000000000002'$$,
  'a summary version is written once and never edited (invariant 4)');

insert into echo.summary (call_id, org_id, body, model, created_by)
values ('c2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000a',
        'خلاصه نسخه دو', 'test/model', '02000000-0000-4000-8000-000000000002');
select t.ok(
  (select version from echo.summary
    where call_id = 'c2000000-0000-4000-8000-000000000002' order by version desc limit 1) = 2,
  'replacing a summary adds version 2; the database numbers it');
select t.ok(
  (select count(*) from echo.summary where call_id = 'c2000000-0000-4000-8000-000000000002') = 2,
  'and version 1 is still there');
select t.ok(
  (select body from echo.call_current_summary
    where call_id = 'c2000000-0000-4000-8000-000000000002') = 'خلاصه نسخه دو',
  'the pointer moved to the newest version');
select t.ok(
  (select s.body from echo.call c join echo.summary s on s.id = c.current_summary_id
    where c.id = 'c2000000-0000-4000-8000-000000000002') = 'خلاصه نسخه دو',
  'and the pointer column on the call agrees with the view');
select t.denied(
  $$update echo.call set current_summary_id = 'b2000000-0000-4000-8000-000000000002'
     where id = 'c4000000-0000-4000-8000-000000000004'$$,
  'the pointer cannot be aimed by hand at another call''s summary');

-- --- a corrected line keeps its identity and its place ---------------------
select t.denied(
  $$update echo.transcript_segment set start_ms = 999
     where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'a correction cannot move a line on the timeline');
select t.denied(
  $$update echo.transcript_segment set seq = 7
     where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'a correction cannot renumber a line');

update echo.transcript_segment set text = 'سلام، قیمت کتاب پنج میلیون تومان است'
 where id = 'a1000000-0000-4000-8000-000000000001';
select t.ok(
  (select edited_at is not null and edited_by = '02000000-0000-4000-8000-000000000002'
     from echo.transcript_segment where id = 'a1000000-0000-4000-8000-000000000001'),
  'a corrected line is marked as edited, by whoever actually edited it');

-- --- an agent run is advanced, never rewritten (invariant 5) ---------------
select t.denied(
  $$update echo.agent_run set model = 'something/else'
     where id = '11000000-0000-4000-8000-000000000001'$$,
  'a finished run''s model cannot be rewritten');
select t.denied(
  $$update echo.agent_run set request = '{"tampered":true}'
     where id = '11000000-0000-4000-8000-000000000001'$$,
  'nor what was sent to the model');

reset role;
