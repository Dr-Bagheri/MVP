-- Echo — 0015: the two moments before an identity exists.
--
-- Invariant 2 says no database access without a user identity. Registration
-- and API-key resolution are the only two operations that legitimately happen
-- BEFORE there is one, so they are the only two SECURITY DEFINER doors in the
-- product — each with a fixed shape, no free-form input, and a single caller
-- (echo_app). Everything else goes through the wall.

-- ---------------------------------------------------------------------------
-- Registration (M15).
--
-- A person may register themselves — password or Google — and lands in
-- `pending`. This function CANNOT produce an active user: acceptance is a
-- separate, admin-only UPDATE that the trigger in 0011 stamps. That is the
-- whole point of routing signup through here rather than through a policy.
--
-- Two shapes, matching M2 (an individual is an org-of-one, not a special case):
--   join an existing org → pending member
--   no org named         → a new org, and the registrant is its pending admin
-- ---------------------------------------------------------------------------

create function echo.register_account(
  p_user_id      uuid,
  p_email        citext,
  p_display_name text default '',
  p_org_name     text default null,
  p_join_org     uuid default null
) returns echo.app_user
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_org  uuid;
  v_role echo.member_role;
  v_row  echo.app_user;
begin
  if p_user_id is null or p_email is null then
    raise exception 'registration requires an auth user id and an email'
      using errcode = 'null_value_not_allowed';
  end if;

  if p_join_org is not null then
    perform 1 from echo.org o where o.id = p_join_org and o.status = 'active';
    if not found then
      raise exception 'no such organization' using errcode = 'foreign_key_violation';
    end if;
    v_org  := p_join_org;
    v_role := 'member';
  else
    insert into echo.org (name)
    values (coalesce(nullif(btrim(p_org_name), ''), nullif(btrim(p_display_name), ''), p_email::text))
    returning id into v_org;
    v_role := 'admin';
  end if;

  insert into echo.app_user (id, org_id, email, display_name, role, status)
  values (p_user_id, v_org, p_email, coalesce(btrim(p_display_name), ''), v_role, 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function echo.register_account(uuid, citext, text, text, uuid) from public;
grant execute on function echo.register_account(uuid, citext, text, text, uuid) to echo_app;

comment on function echo.register_account(uuid, citext, text, text, uuid) is
  'The only way an app_user row is created without an existing identity. Always produces status=pending (M15).';

-- ---------------------------------------------------------------------------
-- API-key resolution (M17).
--
-- Turns a bearer token into the member it acts as, so the gateway request can
-- proceed as that person and meet the same wall as a browser request. Returns
-- nothing for a revoked or expired key, or for a key whose member is no
-- longer active — a disabled employee's integration stops working the moment
-- they are disabled, without anyone remembering to rotate the key.
--
-- Takes the sha256 of the token, never the token: core/ hashes before it
-- calls, so the secret never reaches the database or its logs (invariant 7).
-- ---------------------------------------------------------------------------

create function echo.resolve_api_key(p_token_sha256 text)
  returns table (key_id uuid, org_id uuid, actor_id uuid)
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
    returning k.id as id, k.org_id as org_id, k.actor_id as actor_id
  )
  select t.id, t.org_id, t.actor_id from touched t;
$$;

revoke all on function echo.resolve_api_key(text) from public;
grant execute on function echo.resolve_api_key(text) to echo_app;

-- ---------------------------------------------------------------------------
-- Vendor acceptance (M15 amendment, steward ruling).
--
-- Two kinds of pending account, two different acceptors:
--   joining an EXISTING org → that org's admin accepts, through the product,
--                             as an ordinary UPDATE under RLS.
--   a NEW org (the org-of-one founder included) → nobody in that org can
--                             accept them, because they are the only member.
--                             We accept, because acceptance is the commercial
--                             gate and there is no trial.
--
-- So this is an operator path, not a product path. It runs as echo_vendor,
-- which holds no table privileges whatsoever — only EXECUTE on these two
-- functions. core/ is echo_app and is not a member of echo_vendor, so no
-- request, however wrong, can reach it. For v1 this is a documented psql
-- procedure (db/README.md); an internal surface can come later.
-- ---------------------------------------------------------------------------

create function echo.vendor_pending_orgs()
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
    and u.role = 'admin'
    -- Only a brand-new org: if it has other members, its own admin accepts.
    and (select count(*) from echo.app_user m where m.org_id = o.id) = 1
  order by u.created_at;
$$;

create function echo.vendor_accept_org(p_org uuid) returns echo.app_user
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_row echo.app_user;
  v_members integer;
begin
  select count(*) into v_members from echo.app_user u where u.org_id = p_org;
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
     and u.role = 'admin'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no pending founding admin in org %', p_org
      using errcode = 'no_data_found';
  end if;

  -- accepted_by stays NULL: that, with accepted_at set, is the record that
  -- the vendor accepted this account rather than an org admin.
  return v_row;
end;
$$;

revoke all on function echo.vendor_pending_orgs()    from public;
revoke all on function echo.vendor_accept_org(uuid)  from public;
grant execute on function echo.vendor_pending_orgs()   to echo_vendor;
grant execute on function echo.vendor_accept_org(uuid) to echo_vendor;

comment on function echo.vendor_accept_org(uuid) is
  'Operator path (M15 amendment): the vendor accepts a brand-new org. Not reachable from core/ — echo_app has no EXECUTE.';

-- ---------------------------------------------------------------------------
-- The one system skill v1 ships with (M4: agents are configuration).
-- Editable through the product without a deploy; core/ owns refining the
-- wording, this migration only guarantees the row exists.
-- ---------------------------------------------------------------------------

insert into echo.skill (level, slug, name, description, prompt, tools)
values (
  'system',
  'summarizer',
  'خلاصه‌ساز',
  'Writes the summary produced automatically when processing finishes.',
  'شما خلاصه‌ساز گفتگوهای کاری هستید. قبل از نوشتن، با ابزارهای جست‌وجو '
  || 'تماس‌های پیشین با همان افراد یا همان موضوع را بررسی کنید و در صورت وجود، '
  || 'به آن‌ها ارجاع دهید. سپس بر پایهٔ متن پیاده‌شده، خلاصه‌ای دقیق و بدون '
  || 'حدس بنویسید. خروجی همیشه فارسی است. آنچه در متن نیامده را ننویسید.',
  '["search_transcripts", "read_window", "get_call", "list_related_calls"]'::jsonb
);
