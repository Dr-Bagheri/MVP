-- 0173 — the door counts people too
--
-- 0172 taught `vendor_pending_orgs` that a fresh registration is one PERSON
-- rather than one row, and stopped there. `vendor_accept_org` carries the same
-- count, one function over, in the same file, written the same day — so the
-- vendor could SEE an organisation waiting and could not ACCEPT it:
--
--   org … has 3 members; only a brand-new org is accepted by the vendor
--
-- Fixing one instance is not fixing its siblings. This repo has a name for it
-- and has now paid for it again inside a single migration pair — the second
-- one caught only because the db suite walks the whole acceptance path rather
-- than asserting that the list is non-empty and stopping there.
--
-- The rule both functions mean is the same sentence, and it is now written the
-- same way in both: *the founder is the only person here*. Agent seats are
-- provisioned by the platform at org creation (0171); they are members, they
-- are counted as members everywhere a member count is about the organisation,
-- and they are not people for the purpose of "has anybody joined yet".

begin;

create or replace function echo.vendor_accept_org(p_org uuid) returns echo.app_user
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_row echo.app_user;
  v_members integer;
begin
  -- 0173: HUMANS, matching vendor_pending_orgs. Counting rows made every
  -- organisation look occupied from the moment it was created.
  select count(*) into v_members
    from echo.app_user u where u.org_id = p_org and u.kind = 'human';
  if v_members <> 1 then
    raise exception
      'org % has % members; only a brand-new org is accepted by the vendor — an existing org''s admin accepts its own joiners',
      p_org, v_members
      using errcode = 'insufficient_privilege';
  end if;

  update echo.app_user u
     set status = 'active'
   where u.org_id = p_org
     and u.status = 'pending'
     and u.role = 'owner'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no pending founding owner in org %', p_org
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$fn$;

-- ── self-checks ────────────────────────────────────────────────────────────
do $chk$
declare v_def text; v_missing text;
begin
  -- BOTH halves of the acceptance path, together. Checking only the one this
  -- migration touched is the exact mistake that made this migration necessary.
  for v_def, v_missing in
    select p.proname, pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo'
       and p.proname in ('vendor_pending_orgs', 'vendor_accept_org')
  loop
    if position('kind = ''human''' in v_missing) = 0 then
      raise exception 'CHECK FAILED: %() still counts seats as people', v_def;
    end if;
  end loop;

  -- and there are two of them to have checked — a loop over an empty set
  -- passes perfectly
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo'
         and p.proname in ('vendor_pending_orgs', 'vendor_accept_org')) <> 2 then
    raise exception 'CHECK FAILED: the acceptance path is not two functions';
  end if;

  -- neither became PUBLIC's on the way through
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'echo' and p.prosecdef
       and has_function_privilege('public', p.oid, 'EXECUTE')
  ) then
    raise exception 'CHECK FAILED: a security-definer door in echo is PUBLIC''s to call';
  end if;
end $chk$;

commit;
