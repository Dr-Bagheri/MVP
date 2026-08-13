-- Handles, Latin names, and the status history the trend tiles read.

reset role;
set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);

-- --- the handle is the org's, not the world's -----------------------------
-- Global uniqueness would make "that handle is taken" an existence oracle over
-- every other customer's org. Two people in different orgs may share one.
reset role;
update echo.app_user set username = 'sara'
 where id = '02000000-0000-4000-8000-000000000002';
update echo.app_user set username = 'sara'
 where id = '05000000-0000-4000-8000-000000000005';
select t.ok(
  (select count(*) from echo.app_user where username = 'sara') = 2,
  'the same handle exists in two orgs — uniqueness is per org, so no cross-tenant oracle');

select t.denied(
  $$update echo.app_user set username = 'sara'
     where id = '03000000-0000-4000-8000-000000000003'$$,
  'but not twice inside one org');

-- --- format is enforced, not merely encouraged ----------------------------
select t.denied(
  $$update echo.app_user set username = 'Sara'
     where id = '03000000-0000-4000-8000-000000000003'$$,
  'no uppercase — a handle has one spelling');
select t.denied(
  $$update echo.app_user set username = 'سارا'
     where id = '03000000-0000-4000-8000-000000000003'$$,
  'and no Persian: an @mention inside a bidirectional line has no unambiguous end');
select t.denied(
  $$update echo.app_user set username = '9lives'
     where id = '03000000-0000-4000-8000-000000000003'$$,
  'nor a leading digit');
select t.denied(
  $$update echo.app_user set username = 'ab'
     where id = '03000000-0000-4000-8000-000000000003'$$,
  'nor two characters');

-- --- a handle is chosen, not required at birth -----------------------------
-- The fixture is inserted AFTER the migrations, so its people have none — the
-- same state as anyone register_account creates. That is deliberate: forcing a
-- handle at insert time would mean inventing one for someone who has not
-- picked it. (0039's backfill covers rows that existed when it ran; the suite
-- cannot observe those, so it is verified against the real data instead of
-- asserted here, where it would only ever be vacuously true.)
select t.ok(
  (select count(*) from echo.app_user where username is null) > 0,
  'a newly created person has no handle until one is chosen — NULL is a legitimate state');
select t.ok(
  (select coalesce(bool_and(username ~ '^[a-z][a-z0-9_]{2,31}$'), true)
     from echo.app_user where username is not null),
  'and every handle that does exist satisfies the rule');

-- --- the Latin name falls back rather than blanking ------------------------
select t.denied(
  $$update echo.app_user set display_name_en = '   '
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'a blank Latin name is refused — otherwise it renders empty instead of falling back to the Persian one');

update echo.app_user set display_name_en = 'Bob'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select display_name_en from echo.app_user where id = '02000000-0000-4000-8000-000000000002')
    = 'Bob'
  and (select display_name from echo.app_user where id = '02000000-0000-4000-8000-000000000002')
    = 'باب',
  'and the Persian name is untouched by setting the Latin one');

-- --- calendar and timezone: 'auto' is a value, not an absence -------------
select t.ok(
  (select calendar = 'auto' and timezone = 'auto' from echo.app_user
    where id = '02000000-0000-4000-8000-000000000002'),
  'a new person follows the active language, and says so with a value rather than a NULL');

set local role echo_app;
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
update echo.app_user set calendar = 'jalali', timezone = 'Asia/Tehran'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select calendar = 'jalali' and timezone = 'Asia/Tehran' from echo.app_user
    where id = '02000000-0000-4000-8000-000000000002'),
  'and may choose both for themselves');

select t.denied(
  $$update echo.app_user set calendar = 'hijri'
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'an unknown calendar is refused — that vocabulary is closed');
select t.denied(
  $$update echo.app_user set timezone = ''
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'and an empty timezone is refused: it would be a third spelling of "not chosen"');
select t.denied(
  $$update echo.app_user set timezone = 'https://example.com/tz'
     where id = '02000000-0000-4000-8000-000000000002'$$,
  'as is anything not shaped like a zone name');

-- Shape, not membership. The database does not format dates, so it is not the
-- authority on which zones exist — asserting otherwise would let it reject a
-- zone the UI can use.
update echo.app_user set timezone = 'Pacific/Kiritimati'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok(
  (select timezone from echo.app_user where id = '02000000-0000-4000-8000-000000000002')
    = 'Pacific/Kiritimati',
  'a real but obscure zone is accepted — validity belongs to whoever formats the date');

-- ===========================================================================
-- Status history: written by the database, not by the caller.
-- ===========================================================================
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);

select t.ok((select count(*) from echo.user_status_history) = 0,
  'no history before anything has changed');

update echo.app_user set status = 'active'
 where id = '04000000-0000-4000-8000-000000000004';
select t.ok(
  (select old_status = 'pending' and new_status = 'active'
      and changed_by = '01000000-0000-4000-8000-000000000001'
     from echo.user_status_history
    where app_user_id = '04000000-0000-4000-8000-000000000004'),
  'accepting a member records the transition and who made it');

-- A refused change must leave nothing behind: a history that logs attempts
-- would answer "what happened to this account" with things that did not.
select set_config('echo.actor_id', '02000000-0000-4000-8000-000000000002', true);
select t.writes_nothing(
  $$update echo.app_user set status = 'disabled'
     where id = '03000000-0000-4000-8000-000000000003'$$,
  'a member cannot disable a colleague');
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);
select t.ok((select count(*) from echo.user_status_history) = 1,
  'and the refusal left no line — only permitted changes are recorded');

-- A role change is not a status change.
update echo.app_user set role = 'admin'
 where id = '02000000-0000-4000-8000-000000000002';
select t.ok((select count(*) from echo.user_status_history) = 1,
  'promoting someone writes no status line — the two are different events');

-- --- nobody can write or rewrite it ----------------------------------------
select t.denied(
  $$insert into echo.user_status_history (app_user_id, org_id, old_status, new_status)
    values ('02000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-00000000000a',
            'active','disabled')$$,
  'the api cannot write a line itself — no insert grant, so a trend cannot be authored');
select t.denied(
  $$update echo.user_status_history set new_status = 'active' where id = 1$$,
  'nor revise one');

-- The helper the trigger uses is granted to echo_app — it has to be, since the
-- guard runs as the caller — so it refuses any call that is not inside a
-- trigger. Otherwise the grant needed to record history honestly would be the
-- grant needed to invent it.
select t.denied(
  $$select echo.record_status_change(
      '02000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-00000000000a',
      'active','disabled','01000000-0000-4000-8000-000000000001')$$,
  'and cannot reach the recorder directly — it answers only from inside a trigger');

-- --- and it is admin-only --------------------------------------------------
-- carol, not bob: bob was promoted to admin a few lines up, and asserting
-- "a member sees nothing" about someone this file just made an admin would
-- pass or fail for the wrong reason.
select set_config('echo.actor_id', '03000000-0000-4000-8000-000000000003', true);
select t.ok((select count(*) from echo.user_status_history) = 0,
  'a member sees no membership history');

select set_config('echo.actor_id', '05000000-0000-4000-8000-000000000005', true);
select t.ok((select count(*) from echo.user_status_history) = 0,
  'and another org sees none of it');

reset role;
