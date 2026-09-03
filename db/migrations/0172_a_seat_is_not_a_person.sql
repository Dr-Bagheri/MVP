-- 0172 — a seat is not a person
--
-- 0171 gave the agents `app_user` rows, and three things that count members
-- started counting them. Two of the three were caught by the db suite within a
-- minute of the migration landing; the third is the one that matters, and it
-- would have been silent.
--
-- ── THE ONE THAT MATTERED ──────────────────────────────────────────────────
--
-- `echo.vendor_pending_orgs()` finds a fresh registration by asking whether an
-- organisation has exactly ONE member. That was a true reading of "nobody has
-- joined yet" for as long as every member was a person. With two seats
-- provisioned at org creation the count is three, no org ever matches, and the
-- VENDOR CONSOLE STOPS SHOWING PENDING SIGN-UPS — nobody can be approved onto
-- the platform, and the screen looks calm rather than broken.
--
-- The rule it meant was never "one row". It was "the founder is the only
-- person here", and `kind` is what finally makes that expressible. This is the
-- count trap in its most expensive form: a fact about the fixture wearing the
-- costume of a fact about the wall, load-bearing, in the one path that
-- onboards customers.
--
-- ── THE DEFINER HOLE ───────────────────────────────────────────────────────
--
-- `tg_org_provision_agents` is SECURITY DEFINER and a trigger function, and a
-- trigger function is created with EXECUTE granted to PUBLIC like any other.
-- 30_agent_wall.sql refuses that absolutely, with no allow-list — "an
-- allow-list of harmless entries is where the next one would hide" — and it
-- was right to: a definer that inserts admin members is not a thing any role
-- should be able to call directly.
--
-- The two other triggers 0171 added are NOT definer and needed nothing; this
-- one has to be, because inserting a member is policy-gated and org creation
-- has no admin awake.
--
-- ── AND ONE THAT IS NOT A BUG ──────────────────────────────────────────────
--
-- `echo.member_stats` counts the agents, and stays that way. They ARE members
-- of the organisation now — the roster lists them, the owner may change their
-- role — so a tile that excluded them would disagree with the table beneath
-- it, which is the two-spellings problem wearing a number. The PLATFORM
-- console's totals are the opposite case and are fixed below: that number
-- answers "how many people are on this platform", and provisioned seats would
-- inflate it by two per organisation forever.

begin;

-- ── 1. the definer trigger is nobody's to call ─────────────────────────────
revoke all on function echo.tg_org_provision_agents() from public;

-- ── 2. a fresh registration is one PERSON, not one row ─────────────────────
create or replace function echo.vendor_pending_orgs()
  returns table (org_id uuid, org_name text, founder uuid, founder_email citext,
                 registered_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select o.id, o.name, u.id, u.email, u.created_at
  from echo.org o
  join echo.app_user u on u.org_id = o.id
  where u.status = 'pending'
    and u.role = 'owner'
    -- 0172: HUMANS. Agent seats are provisioned at org creation, so counting
    -- rows made every organisation look occupied and this list came back empty.
    and (select count(*) from echo.app_user m
          where m.org_id = o.id and m.kind = 'human') = 1
  order by u.created_at;
$$;

-- ── 3. the platform console counts people ──────────────────────────────────
-- REGENERATED from the live body, never retyped. The first draft of this
-- section hand-wrote a `platform_overview()` — a function that does not exist.
-- The real one is `platform_overview_counts()`: plpgsql, with a
-- `require_platform_root` guard and a different column list. `create or
-- replace` would have installed the invention BESIDE the real one rather than
-- refusing — 0132's finding exactly — and the console would have gone on
-- calling the unpatched original while this migration reported success.
do $rewrite$
declare v_def text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_overview_counts';

  if position('kind = ''human''' in v_def) > 0 then
    raise notice '0172: platform_overview_counts already counts people only';
    return;
  end if;

  -- the four USER counts, and only those: the org and root counts are
  -- untouched, and each pattern is anchored on echo.app_user so nothing that
  -- merely mentions a status can be caught by accident
  v_def := replace(v_def,
    '(select count(*) from echo.app_user)',
    '(select count(*) from echo.app_user where kind = ''human'')');
  v_def := replace(v_def,
    '(select count(*) from echo.app_user u where u.status = ''active'')',
    '(select count(*) from echo.app_user u where u.status = ''active'' and u.kind = ''human'')');
  v_def := replace(v_def,
    '(select count(*) from echo.app_user u where u.status = ''pending'')',
    '(select count(*) from echo.app_user u where u.status = ''pending'' and u.kind = ''human'')');
  v_def := replace(v_def,
    '(select count(*) from echo.app_user u where u.status = ''disabled'')',
    '(select count(*) from echo.app_user u where u.status = ''disabled'' and u.kind = ''human'')');

  -- four rewrites, or the body is not the one this migration was written
  -- against and guessing further would be worse than stopping
  v_hits := (length(v_def) - length(replace(v_def, 'kind = ''human''', '')))
            / length('kind = ''human''');
  if v_hits <> 4 then
    raise exception '0172: expected 4 user counts to rewrite, found % — the body is not what this migration expects', v_hits;
  end if;
  execute v_def;
end $rewrite$;

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare v_public boolean; v_def text;
begin
  -- the definer hole is shut, and the wall's own rule is re-asserted here so
  -- this migration cannot be the one that reopens it
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.prosecdef
       and has_function_privilege('public', p.oid, 'EXECUTE')
  ) then
    raise exception 'CHECK FAILED: a security-definer door in echo is PUBLIC''s to call';
  end if;

  -- both rewritten functions count humans
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'vendor_pending_orgs';
  if v_def !~ 'kind = ''human''' then
    raise exception 'CHECK FAILED: vendor_pending_orgs still counts every row';
  end if;

  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_overview_counts';
  if position('kind = ''human''' in v_def) = 0 then
    raise exception 'CHECK FAILED: platform_overview_counts still counts seats as people';
  end if;
  -- and its root guard survived the rewrite: a regenerated body that lost it
  -- would be a console anyone could read
  if position('require_platform_root' in v_def) = 0 then
    raise exception 'CHECK FAILED: the platform overview lost its root guard';
  end if;

  -- exactly one of each, not a second overload beside the real one (0132)
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo'
         and p.proname in ('vendor_pending_orgs', 'platform_overview_counts')) <> 2 then
    raise exception 'CHECK FAILED: an overload was installed beside one of these';
  end if;
end $chk$;

commit;
