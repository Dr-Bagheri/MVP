-- 0179 — a finished account leaves the roster
--
-- User report, 2026-09-04: "I can't delete the disabled users from the
-- platform root — do it for me and make it possible in future." Two rows,
-- «حساب حذف‌شده», sitting in the console's user list with no name and a
-- `@tombstone.invalid` address.
--
-- ── WHY THE ROW CANNOT GO, AND THAT IS NOT A BUG ──────────────────────────
--
-- Measured before writing any of this. Sixteen rows across four tables still
-- point at those two ids, and one of the foreign keys is `platform_audit
-- .target_user_id ON DELETE RESTRICT` — put there deliberately, so that an
-- operator cannot delete the record of what an operator did. Deleting the
-- account would take its audit trail's subject with it, which is the one
-- outcome the RESTRICT exists to prevent. `user_status_history` and a
-- redeemed `invitation` hold the rest.
--
-- `platform_purge_user` already says the same thing in its own comment — "the
-- row stays, the person leaves". These two rows ARE the finished state: the
-- purge ran, the calls went, the name and address were erased. There is
-- nothing left to delete.
--
-- ── SO WHAT WAS ACTUALLY WRONG ────────────────────────────────────────────
--
-- The console kept showing them. A tombstone has no name, no address and no
-- way to sign in — it is not an account, it is a receipt — and it sat in the
-- roster of accounts forever, one row per person the platform has ever
-- finished with. The list was the defect, not the row.
--
-- This door now reports `tombstoned_at`, so the api can tell a finished
-- account from a live one. The roster shows accounts; the trash view shows
-- what is on its way out AND what is already gone.
--
-- ── WHY DROP AND CREATE ───────────────────────────────────────────────────
--
-- A definer's `RETURNS TABLE` is a CONTRACT: `create or replace` refuses to
-- change it, and widening the inner SELECT without widening the signature is
-- a 42703 that only a platform root can reach — which is how 0152 shipped a
-- 500 nothing could test. The drop takes the grant with it, so the grant is
-- re-issued below, and the self-check asserts both.

begin;

drop function if exists echo.platform_list_users();

create function echo.platform_list_users()
  returns table (
    id uuid, org_id uuid, org_name text, email text,
    display_name text, display_name_en text, username text, locale text,
    role text, status text, created_at timestamptz, last_seen_at timestamptz,
    deleted_at timestamptz, purge_after timestamptz, is_platform_root boolean,
    -- NEW: when this account was erased. Null for every account that still is
    -- one, which is what makes it a filter rather than a decoration.
    tombstoned_at timestamptz
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform echo.require_platform_root(echo.actor_id());
  return query
    select u.id, u.org_id, o.name::text as org_name, u.email::text,
           u.display_name::text, u.display_name_en::text, u.username::text,
           u.locale::text, u.role::text, u.status::text,
           u.created_at, u.last_seen_at, u.deleted_at, u.purge_after,
           exists (select 1 from echo.platform_operator p where p.user_id = u.id)
             as is_platform_root,
           u.tombstoned_at
      from echo.app_user u
      join echo.org o on o.id = u.org_id;
end;
$$;

revoke all on function echo.platform_list_users() from public;
grant execute on function echo.platform_list_users() to echo_app;

comment on function echo.platform_list_users() is
  'Console-only sight (0091): the whole platform''s user metadata, behind require_platform_root. Exists BECAUSE the 0066 policies are gone — product surfaces must never widen for a root. Carries tombstoned_at since 0179, so a finished account can leave the roster.';

-- ── self-checks ───────────────────────────────────────────────────────────
do $chk$
declare
  v_cols text;
  v_ok   boolean;
begin
  -- the column is actually in the signature, not merely in the body
  select pg_get_function_result(p.oid) into v_cols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'echo' and p.proname = 'platform_list_users';
  if v_cols is null or position('tombstoned_at' in v_cols) = 0 then
    raise exception 'CHECK FAILED: the door does not return tombstoned_at — a widened body behind an old signature is a 42703 only a root can reach';
  end if;

  -- the drop took the grant; without this the console loses its sight and the
  -- failure shows up as an empty platform screen rather than as a migration
  select has_function_privilege('echo_app', 'echo.platform_list_users()', 'execute')
    into v_ok;
  if not v_ok then
    raise exception 'CHECK FAILED: echo_app can no longer execute the console door';
  end if;

  -- and there is exactly ONE of it: `create or replace` on a changed
  -- signature installs a second overload beside the real one rather than
  -- refusing, which is 0132's finding and the reason this drops first
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'echo' and p.proname = 'platform_list_users') <> 1 then
    raise exception 'CHECK FAILED: platform_list_users has more than one overload';
  end if;
end $chk$;

commit;
