-- Test helpers. Test-only: `t` is dropped by reset and never ships.
--
-- Three shapes of assertion, because the wall denies in three different ways:
--   t.ok(cond, label)          — a plain claim about what is visible
--   t.denied(stmt, label)      — the statement must raise (grants, triggers)
--   t.writes_nothing(stmt, l)  — the statement must touch zero rows, or raise
--                                (RLS does not raise; it filters silently,
--                                 and a silent filter is still a denial)

create schema if not exists t;
-- Every role in the suite calls these, including the ones we are proving are
-- powerless. USAGE on a schema is not granted by default.
grant usage on schema t to public;

create or replace function t.ok(cond boolean, label text) returns void
  language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'ok  %', label;
end;
$$;

create or replace function t.denied(stmt text, label text) returns void
  language plpgsql as $$
declare
  raised boolean := false;
  why    text;
begin
  begin
    execute stmt;
  exception when others then
    raised := true;
    why := sqlerrm;
  end;
  if not raised then
    raise exception 'FAIL: % — the statement was allowed and must not be', label;
  end if;
  raise notice 'ok  % [%]', label, why;
end;
$$;

create or replace function t.writes_nothing(stmt text, label text) returns void
  language plpgsql as $$
declare
  n       bigint := 0;
  blocked boolean := false;
  why     text := 'filtered to zero rows';
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    if n = 0 then blocked := true; end if;
  exception when others then
    blocked := true;
    why := sqlerrm;
  end;
  if not blocked then
    raise exception 'FAIL: % — % row(s) were written', label, n;
  end if;
  raise notice 'ok  % [%]', label, why;
end;
$$;

-- Becoming a caller is done inline in each test file, never through a helper:
--
--   reset role;
--   set local role echo_app;
--   select set_config('echo.actor_id', '<uuid>', true);
--
-- Two reasons. It is exactly what core/'s connection factory does (a database
-- role plus SET LOCAL identity), so a reader can check the tests against the
-- real thing; and hiding a SET ROLE inside a function invites questions about
-- when it reverts that the tests should not have to answer.
