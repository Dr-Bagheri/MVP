-- 0152 — the console's door learns the signup flag
--
-- A LIVE 500, found by the user on their own platform console: every figure
-- read zero and the page said «داده‌های کنترل پلتفرم بارگیری نشدند».
-- `/v1/platform/organizations` was answering 500 with SQLSTATE 42703,
-- undefined_column.
--
-- The cause is mine and it is worth writing down, because it is a shape this
-- repo has a rule about. 0149 added `echo.org.accepts_signups`, and the
-- console's org list was widened to select it — with ONE blind replace across
-- both branches of that query. The second branch reads `echo.org` directly
-- and was fine. The FIRST reads `echo.platform_list_orgs()`, a definer door
-- whose RETURNS TABLE is a fixed contract, and a column the function does not
-- return does not exist to a caller selecting from it.
--
-- Rule 13½, one layer in: the function is the PRODUCER of that shape, and a
-- consumer cannot widen it by asking for more. Nothing caught it because the
-- door is only taken by a platform root, and no test signs in as one.
--
-- What this does: teach the door the column. The alternative — read the flag
-- only on the direct branch — would leave the console showing an arrivals
-- toggle whose state depended on which code path served the page, which is a
-- worse bug wearing a smaller diff.

-- DROP first: `create or replace` cannot change a function's RETURNS TABLE,
-- and Postgres says so plainly. Dropping is safe here because the function is
-- read-only and root-walled — nothing holds a reference to it across the
-- transaction, and the grant is restored below in the same one.
drop function if exists echo.platform_list_orgs();

create function echo.platform_list_orgs()
returns table (
  id              uuid,
  name            text,
  status          text,
  locale          text,
  accepts_signups boolean,
  created_at      timestamptz,
  deleted_at      timestamptz,
  purge_after     timestamptz,
  member_count    bigint
)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform echo.require_platform_root(echo.actor_id());
  return query
    select o.id, o.name::text, o.status::text, o.locale::text,
           o.accepts_signups,
           o.created_at, o.deleted_at, o.purge_after,
           count(u.id) as member_count
      from echo.org o
      left join echo.app_user u on u.org_id = o.id
     group by o.id;
end;
$$;

-- the grant went with the DROP, so it is restored explicitly rather than
-- assumed — a door nobody may open is the same outage in a different colour
revoke all on function echo.platform_list_orgs() from public;
grant execute on function echo.platform_list_orgs() to echo_app;

comment on function echo.platform_list_orgs() is
  'The console''s cross-org sight (0091), widened in 0152 to carry '
  'accepts_signups. Its RETURNS TABLE is a CONTRACT: a caller cannot select a '
  'column this does not return, and the 42703 that says so reaches the screen '
  'as "could not load" — which is why the columns live here and not in the '
  'query that reads it.';

-- ─── self-checks ──────────────────────────────────────────────────────────
do $$
declare
  v_cols text;
begin
  -- (1) the door returns the column the console selects. Read from the
  --     CATALOGUE rather than by calling the function: calling it requires a
  --     platform root, and a check that can only run as one is a check that
  --     never runs.
  select string_agg(p.proargnames[i], ',' order by i) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
         generate_subscripts(p.proargnames, 1) i
   where n.nspname = 'echo' and p.proname = 'platform_list_orgs';
  if v_cols is null or position('accepts_signups' in v_cols) = 0 then
    raise exception '0152 FAILED: the door does not return accepts_signups (returns: %)', v_cols;
  end if;

  -- (2) it is still root-walled. Widening a definer function is exactly when
  --     its guard gets lost, and a cross-org read with no wall is the worst
  --     possible way to fix a 500.
  if position('require_platform_root' in
      (select pg_get_functiondef(p.oid) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'echo' and p.proname = 'platform_list_orgs')) = 0 then
    raise exception '0152 FAILED: the door lost its platform-root guard';
  end if;

  -- (3) the APP role can still open it — the drop above took the grant with
  --     it, and a door the product cannot open is the same outage repainted
  if not has_function_privilege('echo_app', 'echo.platform_list_orgs()', 'execute') then
    raise exception '0152 FAILED: the app role lost execute on the console door';
  end if;

  -- (4) and the agent still cannot open it
  if has_function_privilege('echo_agent', 'echo.platform_list_orgs()', 'execute') then
    raise exception '0152 FAILED: the agent role may list every organization';
  end if;
end $$;
