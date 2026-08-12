-- Echo — 0022: gateway keys do not get the assistant by default.
--
-- M17 as amended: a gateway key borrows a member's authority (D6), and that
-- member can talk to the assistant — so a leaked key was, until now, unbounded
-- model spend. The ruling is scope, not throttle: assistant access is per-key,
-- admin-granted, and off unless someone turned it on.
--
-- Default false rather than nullable-unknown, because "we never decided" and
-- "no" must behave identically here. A three-state flag would eventually be
-- read as "not configured, so allow".

alter table echo.api_key
  add column allow_assistant boolean not null default false;

comment on column echo.api_key.allow_assistant is
  'Per-key opt-in for the assistant endpoint (M17 amendment). Admin-granted, default off: a leaked key must not be able to spend on models.';

-- ---------------------------------------------------------------------------
-- The flag has to travel with the resolution, not be looked up afterwards.
--
-- At gateway auth time there is no identity yet — that is the entire point of
-- resolve_api_key. So core/ cannot SELECT from echo.api_key to read this
-- column: the api_key policies require an active admin, and the caller at that
-- moment is nobody at all. Returning it here is what makes the feature
-- enforceable rather than merely recorded.
--
-- Return type changes, so this is a drop-and-create rather than a replace.
-- ---------------------------------------------------------------------------

drop function echo.resolve_api_key(text);

create function echo.resolve_api_key(p_token_sha256 text)
  returns table (key_id uuid, org_id uuid, actor_id uuid, allow_assistant boolean)
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  with touched as (
    update echo.api_key k
       set last_used_at = now()
     where k.token_sha256 = p_token_sha256
       and k.revoked_at is null
       and (k.expires_at is null or k.expires_at > now())
       and exists (
         select 1
         from echo.app_user u
         join echo.org o on o.id = u.org_id
         where u.id = k.actor_id
           and u.status = 'active'
           and o.status = 'active'
       )
    returning k.id as id, k.org_id as org_id, k.actor_id as actor_id,
              k.allow_assistant as allow_assistant
  )
  select t.id, t.org_id, t.actor_id, t.allow_assistant from touched t;
$$;

revoke all on function echo.resolve_api_key(text) from public;
grant execute on function echo.resolve_api_key(text) to echo_app;

comment on function echo.resolve_api_key(text) is
  'Turns a token hash into the member a gateway request acts as, plus whether that key may reach the assistant. The only pre-identity read of echo.api_key.';
