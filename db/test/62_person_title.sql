-- 0062: the title vocabulary is a CONSTRAINT, not a convention.

reset role;
set local role echo_app;
select set_config('echo.actor_id', '01000000-0000-4000-8000-000000000001', true);  -- alice, owner

insert into echo.person (id, org_id, display_name, title, created_by)
values ('75000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
        'مدیر آزمایشی', 'ceo', '01000000-0000-4000-8000-000000000001');
select t.ok(
  (select title from echo.person where id = '75000000-0000-4000-8000-000000000001') = 'ceo',
  'a known title code is accepted');

select t.denied(
  $$insert into echo.person (org_id, display_name, title, created_by)
    values ('0a000000-0000-4000-8000-00000000000a', 'کسی', 'grand-vizier',
            '01000000-0000-4000-8000-000000000001')$$,
  'an invented title is refused by the CONSTRAINT — the list lives in one place');

update echo.person set title = '' where id = '75000000-0000-4000-8000-000000000001';
select t.ok(
  (select title from echo.person where id = '75000000-0000-4000-8000-000000000001') = '',
  'empty = "not chosen" is a real, storable state');
