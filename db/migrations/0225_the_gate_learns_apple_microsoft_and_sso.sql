-- db/0225 — the gate learns Apple, Microsoft and SSO (2026-09-16).
--
-- User directive: the sign-in page "shows you options that you can connect
-- with these 4 or email" — Google, Apple, Microsoft, SSO — beside the email
-- code. db/0078 made each external method a SETTING an admin can switch off;
-- this widens the closed set the switch knows, so the three new doors are
-- governed the way Google is rather than hard-wired open.
--
-- OFF ON ARRIVAL, deliberately. A method is drawn on the gate whether it is
-- on or off (the directive is about what the page offers), and a press on an
-- off one answers with the platform's own sentence — «this way in is not
-- switched on yet» — never with a provider's raw error page. Switching one
-- on is the operator's act, taken AFTER the provider is configured in the
-- Supabase project (docs/ONBOARDING.md §7); a switch that can be flipped
-- before the provider exists would turn the honest sentence into a 400 from
-- GoTrue. `github` keeps its row and its state: its route still resolves for
-- whoever holds a bookmark, it is simply no longer drawn.
--
-- The CHECK below names the same names as core's SIGNIN_METHODS; core/test
-- reads this migration and asserts the equality (the 0203 device), so the
-- two lists cannot drift quietly — only go red.

do $$
declare
  v_name text;
begin
  -- 0078 wrote the check inline, unnamed; find it by what it is rather than
  -- by a name somebody guessed (a guessed name that misses drops nothing and
  -- the ADD below then fails on the OLD check with a confusing sentence)
  select c.conname into v_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'echo' and t.relname = 'signin_method' and c.contype = 'c';
  if v_name is null then
    raise exception '0225 FAILED: no check constraint on echo.signin_method to widen';
  end if;
  execute format('alter table echo.signin_method drop constraint %I', v_name);
end;
$$;

alter table echo.signin_method
  add constraint signin_method_provider_check
  check (provider in ('google', 'github', 'apple', 'azure', 'sso'));

insert into echo.signin_method (provider, enabled)
values ('apple', false), ('azure', false), ('sso', false)
on conflict (provider) do nothing;

comment on table echo.signin_method is
  'db/0078: which external sign-in methods are offered; a setting, not a '
  'capability of the provider. Widened by 0225 to apple, azure (Microsoft) '
  'and sso — off until the operator has configured the provider in the '
  'Supabase project and flipped the switch. The CHECK names the same names '
  'as core''s SIGNIN_METHODS (asserted by core/test).';

-- ─── self-checks ──────────────────────────────────────────────────────────
do $$
declare
  v_failed text;
begin
  -- (1) every method the gate draws has a row, and the new three are OFF
  if (select count(*) from echo.signin_method
       where provider in ('google', 'github', 'apple', 'azure', 'sso')) <> 5 then
    raise exception '0225 FAILED: a sign-in method has no row';
  end if;
  if exists (select 1 from echo.signin_method
              where provider in ('apple', 'azure', 'sso') and enabled) then
    raise exception '0225 FAILED: a new method arrived switched ON';
  end if;

  -- (2) the set is still closed — the discriminating half: without it (1)
  --     passes against a table that lost its check entirely
  begin
    insert into echo.signin_method (provider, enabled) values ('facebook', false);
    v_failed := 'a method outside the closed set was accepted';
  exception when check_violation then
    v_failed := null;
  end;
  if v_failed is not null then raise exception '0225 FAILED: %', v_failed; end if;

  raise notice '0225 self-checks passed';
end;
$$;
