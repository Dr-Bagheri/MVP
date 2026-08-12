-- Echo — 0002: tenancy.
--
-- M2: orgs are first-class; an individual customer is an org-of-one, not a
-- special case. Every product row from here on carries org_id, and RLS walls
-- orgs from each other.

create table echo.org (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  status      echo.org_status not null default 'active',
  -- Admin-curated model allow-list (M5). Empty array = admin has not curated,
  -- core/ falls back to the shipped catalogue.
  allowed_models text[] not null default '{}',
  locale      text not null default 'fa',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger org_set_updated_at
  before update on echo.org
  for each row execute function echo.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- app_user — the product's view of a person. Authentication itself belongs to
-- Supabase Auth (auth.users); this row is the org membership, role and status.
-- The id IS auth.users.id, so there is exactly one identity per person.
--
-- M15: a person may register themselves (password or Google OAuth) but lands
-- in `pending` and can see nothing until an admin accepts them. That gate is
-- enforced here by RLS (0012), not by the UI.
-- ---------------------------------------------------------------------------

create table echo.app_user (
  id            uuid primary key,
  org_id        uuid not null references echo.org(id),
  email         citext not null,
  display_name  text not null default '',
  avatar_url    text,
  locale        text not null default 'fa',
  role          echo.member_role not null default 'member',
  status        echo.user_status not null default 'pending',
  -- Per-user model choice (M5). NULL = user has not chosen; no default model
  -- is imposed, core/ shows the curated suggestion instead.
  preferred_model text,
  accepted_at   timestamptz,
  accepted_by   uuid references echo.app_user(id),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The target of every composite foreign key below: a child row cannot point
  -- at a user in another org, structurally.
  constraint app_user_id_org_key unique (id, org_id),
  -- An accepted user has an acceptance record; a pending one does not.
  constraint app_user_accepted_consistent
    check ((status = 'pending') = (accepted_at is null))
);

create unique index app_user_email_key on echo.app_user (email);
create index app_user_org_idx         on echo.app_user (org_id);
create index app_user_org_pending_idx on echo.app_user (org_id) where status = 'pending';

create trigger app_user_set_updated_at
  before update on echo.app_user
  for each row execute function echo.tg_set_updated_at();

comment on column echo.app_user.id is
  'Same value as auth.users.id — one identity per person, no shadow accounts.';
comment on column echo.app_user.status is
  'pending until an admin accepts (M15). RLS denies everything to a non-active user.';

-- Bind to Supabase Auth when it is present. Plain Postgres (the SQL test
-- harness, a bare on-prem bootstrap) runs the same migration without it; the
-- harness installs an auth.users shim so the constraint is exercised there too.
do $$
begin
  if to_regclass('auth.users') is not null then
    alter table echo.app_user
      add constraint app_user_auth_fk
      foreign key (id) references auth.users(id) on delete restrict;
  end if;
end;
$$;
