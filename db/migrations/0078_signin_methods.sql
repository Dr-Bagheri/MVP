-- Echo — 0078: external sign-in methods become a SETTING (user directive,
-- 2026-08-22: "make the google and github login optional for admin and
-- owner rule, add a turn off on toggle for it too").
--
-- The catalogue is fixed (google, github — the two the deployment's auth
-- provider has configured); what an admin controls is whether each is
-- OFFERED. The sign-in page is pre-identity, so the read must work without
-- an actor: the read policy is unconditional for echo_app (the fact "which
-- buttons exist" guards nothing), while the WRITE is a definer door behind
-- actor_is_admin() — the wall is in SQL, as always.
--
-- Platform-scoped, not org-scoped: there is ONE sign-in page for the
-- deployment. On today's single-org platform that means the org's
-- admin/owner as the user ruled; if multi-org tenancy ever shares one
-- deployment, this table is the seam where per-deployment authority gets
-- revisited — recorded here so the future session doesn't discover it as
-- cross-tenant interference.

create table echo.signin_method (
  provider   text primary key check (provider in ('google', 'github')),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references echo.app_user(id) on delete set null
);

comment on table echo.signin_method is
  'Which external sign-in methods the sign-in page offers (0078). Fixed catalogue; enabled is the setting. Write via echo.set_signin_method only.';

insert into echo.signin_method (provider) values ('google'), ('github');

alter table echo.signin_method enable row level security;

-- Pre-identity read: the sign-in page asks before anyone exists. The row
-- carries no content and no identity — an unconditional read gives away
-- exactly what the sign-in page shows every visitor anyway.
create policy signin_method_read on echo.signin_method
  for select to echo_app using (true);

grant select on echo.signin_method to echo_app;
-- no insert/update/delete grants: the catalogue is fixed and the one
-- mutation goes through the door below.

create function echo.set_signin_method(p_provider text, p_enabled boolean)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not echo.actor_is_admin() then
    raise exception 'only an admin may change sign-in methods'
      using errcode = 'insufficient_privilege';
  end if;
  update echo.signin_method
     set enabled = p_enabled,
         updated_at = now(),
         updated_by = echo.actor_id()
   where provider = p_provider;
  if not found then
    raise exception 'unknown sign-in method: %', p_provider
      using errcode = 'check_violation';
  end if;
  return p_enabled;
end;
$$;

revoke all on function echo.set_signin_method(text, boolean) from public;
-- echo_app only: the assistant does not flip how people enter the platform.
grant execute on function echo.set_signin_method(text, boolean) to echo_app;

comment on function echo.set_signin_method(text, boolean) is
  'The one write path for sign-in method toggles: admin-and-above, stamped. The agent role has no execute — deliberately.';
