-- Echo — 0040: an append-only record of membership status changes (M24).
--
-- The stat tiles show counts from status and TRENDS from this. The reason it
-- is a table and not a computed guess is stated in the directive and worth
-- keeping: deltas must never be faked. A tile that says "+3 this week" when
-- nobody recorded when those three changed is a number the product invented
-- about itself.
--
-- Written by the app_user guard, not by the api. A history the application
-- writes is a history the application can forget to write — and the one time
-- it forgets is the change someone later asks about.

create table echo.user_status_history (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references echo.org(id),
  app_user_id uuid not null references echo.app_user(id),

  old_status  echo.user_status not null,
  new_status  echo.user_status not null,

  -- NULL means the vendor did it (D13's operator path), exactly as
  -- app_user.accepted_by uses NULL for the same actor.
  changed_by  uuid references echo.app_user(id),
  changed_at  timestamptz not null default now(),

  constraint user_status_history_same_org
    foreign key (app_user_id, org_id) references echo.app_user (id, org_id),
  constraint user_status_history_actually_changed
    check (old_status <> new_status)
);

create index user_status_history_org_time_idx
  on echo.user_status_history (org_id, changed_at desc);
create index user_status_history_user_idx
  on echo.user_status_history (app_user_id, changed_at desc);

alter table echo.user_status_history enable row level security;
alter table echo.user_status_history force  row level security;

-- Admin surface: this is management data, and a member's own status changes
-- tell them nothing they did not live through.
create policy user_status_history_read on echo.user_status_history for select to echo_app
  using (org_id = echo.actor_org_id() and echo.actor_is_admin());

-- No insert policy for anyone. The trigger writes it, as the owner, so there
-- is no application path that can produce a line — or omit one.
grant select on echo.user_status_history to echo_app;

create trigger user_status_history_immutable
  before update on echo.user_status_history
  for each row execute function echo.tg_reject_update();

comment on table echo.user_status_history is
  'Append-only status transitions (M24). Written by the app_user guard so a trend can never be fabricated or forgotten.';

-- ---------------------------------------------------------------------------
-- The guard gains one statement, after its authorization checks — so only
-- changes that were actually permitted are recorded, and a refused attempt
-- leaves no trace suggesting it happened.
--
-- SECURITY DEFINER so the write does not depend on the caller holding an
-- INSERT grant that nobody has.
-- ---------------------------------------------------------------------------

create function echo.record_status_change(
  p_user uuid, p_org uuid, p_old echo.user_status, p_new echo.user_status, p_by uuid
) returns void
  language sql
  security definer
  set search_path = ''
as $$
  insert into echo.user_status_history (app_user_id, org_id, old_status, new_status, changed_by)
  values (p_user, p_org, p_old, p_new, p_by);
$$;

revoke all on function echo.record_status_change(uuid, uuid, echo.user_status, echo.user_status, uuid) from public;

create or replace function echo.tg_app_user_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  actor uuid := echo.actor_id();
  from_app boolean := current_user::text in ('echo_app', 'echo_agent');
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id then
    raise exception 'a user cannot change identity or org'
      using errcode = 'check_violation';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email is owned by the auth provider, not by this table'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role is distinct from old.role or new.status is distinct from old.status then
    if from_app then
      if actor = old.id then
        raise exception 'nobody changes their own role or status'
          using errcode = 'insufficient_privilege';
      end if;

      if new.role = 'owner' then
        raise exception 'ownership is transferred by an explicit action, not by a role change'
          using errcode = 'insufficient_privilege';
      end if;
      if old.role = 'owner' then
        raise exception 'the owner''s own role and status are not changed by anyone'
          using errcode = 'insufficient_privilege';
      end if;

      if (echo.role_is_admin(old.role) or echo.role_is_admin(new.role))
         and not echo.actor_is_owner() then
        raise exception 'only the owner may change an admin, or make one'
          using errcode = 'insufficient_privilege';
      end if;

      if not echo.actor_is_admin() then
        raise exception 'only an admin may change a role or a membership status'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    if old.status = 'pending' and new.status = 'active' then
      new.accepted_at := now();
      new.accepted_by := case when from_app then actor else null end;
    end if;

    -- Recorded last: only permitted changes reach this line.
    if new.status is distinct from old.status then
      perform echo.record_status_change(
        old.id, old.org_id, old.status, new.status,
        case when from_app then actor else null end
      );
    end if;
  end if;

  return new;
end;
$$;
