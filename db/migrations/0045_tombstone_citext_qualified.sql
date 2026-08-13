-- Echo — 0045: qualify the citext cast inside tombstone_user.
--
-- Every function in this schema pins `set search_path = ''`, which is what
-- stops a caller from shadowing a table or an operator out from under a
-- SECURITY DEFINER body. The cost is that unqualified names inside the body
-- must resolve without a search path, and `citext` lives in public.
--
-- Why this passed creation and failed at runtime: a plpgsql body is not
-- resolved when the function is defined, only when it executes. Type names in
-- the SIGNATURE are resolved at creation time — when search_path is normal —
-- which is why every other citext reference in this schema has always worked
-- and why this one looked identical to them.
--
-- The wider rule, since the next definer function will have the same shape:
-- inside `search_path = ''`, qualify everything that is not built in —
-- extension types included, not just tables.

create or replace function echo.tombstone_user(p_user uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_actor uuid := echo.actor_id();
  v_row   echo.app_user;
  v_call  uuid;
begin
  if not echo.actor_is_owner() then
    raise exception 'only the owner may delete a person'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
  from echo.app_user u
  where u.id = p_user and u.org_id = echo.actor_org_id();

  if not found then
    raise exception 'no such person in this organization'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.id = v_actor then
    raise exception 'the owner cannot delete themselves; transfer ownership first'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.role = 'owner' then
    raise exception 'the owner is not deletable while they own the organization'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.tombstoned_at is not null then
    return false;
  end if;

  for v_call in
    select c.id from echo.call c
    where c.owner_id = p_user and c.deleted_at is null
  loop
    perform echo.soft_delete_call(v_call);
  end loop;

  update echo.app_user u
     set display_name    = '',
         display_name_en = null,
         avatar_url      = null,
         preferred_model = null,
         email           = ('deleted-' || u.id::text || '@tombstone.invalid')::public.citext,
         status          = 'disabled',
         tombstoned_at   = now(),
         tombstoned_by   = v_actor
         -- username stays: the handle is reserved, never freed (0044).
   where u.id = p_user;

  return true;
end;
$$;
