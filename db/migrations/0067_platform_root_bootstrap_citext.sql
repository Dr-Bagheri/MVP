-- NeurAI Platform — 0067: platform-root bootstrap can resolve citext.
--
-- 0066 defined echo.bootstrap_platform_root with `set search_path = ''` while
-- its body declares `v_email citext` and compares it with `<>`. Under an empty
-- search_path neither the citext type nor its comparison operators are
-- reachable (citext lives in `public`), so the bootstrap raised
--   type "citext" does not exist
-- the moment it was compiled — exactly the 0045 lesson (qualify extension types
-- used under an empty search_path) recurring, latent because the bootstrap was
-- never exercised at runtime.
--
-- The narrowest correct fix is to give THIS one definer function
-- `search_path = public`: citext and its operators resolve, every echo.*
-- reference in the body is already schema-qualified (so no application object
-- is exposed through the wider path), and the behaviour is otherwise identical
-- to 0066. The other 0066 functions keep `search_path = ''` — they reference
-- only qualified echo.* objects and need no change.

create or replace function echo.bootstrap_platform_root(
  p_actor uuid,
  p_expected_email citext
) returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_email citext;
  v_status echo.user_status;
begin
  if p_actor is null or p_actor is distinct from echo.actor_id() then
    raise exception 'bootstrap actor does not match session'
      using errcode = 'insufficient_privilege';
  end if;

  select u.email, u.status into v_email, v_status
    from echo.app_user u
   where u.id = p_actor;
  if p_expected_email is null or not found or v_status <> 'active' or v_email <> p_expected_email then
    raise exception 'bootstrap account is not permitted'
      using errcode = 'insufficient_privilege';
  end if;

  -- The configured account is allowed to learn only that its own bootstrap
  -- was already consumed. Other users never reach this branch.
  if exists (select 1 from echo.platform_operator) then
    return false;
  end if;

  insert into echo.platform_operator (user_id, role, granted_by)
  values (p_actor, 'platform_root', null);
  perform echo.record_platform_audit(
    p_actor, 'root_bootstrapped', p_actor, null, 'initial platform root bootstrap'
  );
  return true;
end;
$$;

-- create-or-replace preserves privileges; re-asserted here so the grant is
-- self-evident in this migration rather than only implied by 0066.
revoke all on function echo.bootstrap_platform_root(uuid, citext) from public;
grant execute on function echo.bootstrap_platform_root(uuid, citext) to echo_app;
