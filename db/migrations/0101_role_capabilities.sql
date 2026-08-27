-- 0101 — MEMBER PRIVILEGES: per-role capability switches, in the wall.
--
-- User directive, 2026-08-26: "a new section, member privileges, that has
-- members and admin sections, with give them more or less access to each
-- part of the platform — this is security, so take your time."
--
-- ============================ WHAT THIS IS =============================
-- A capability here can only ever NARROW what a role may do. It cannot
-- widen anything, and the distinction is the whole design:
--
--   RLS decides what rows exist for a caller. This table decides whether
--   the product offers an ACTION the database would already have allowed.
--
-- So "members may delete their own records" is a real switch — the
-- database permits it today (0032's soft_delete_call door), and turning it
-- off makes the api refuse first. But "members may read everyone's
-- records" is NOT expressible here and never will be: that is RLS's answer,
-- and a switch that appeared to grant it would be a lie the moment somebody
-- flipped it and the database refused anyway. Only narrowings live in the
-- vocabulary, and each one names a route that enforces it.
--
-- ========================== THE ESCALATION RULE ========================
-- D27: any transition that removes the actor's power to reverse it needs
-- its exit built with its entrance. Three consequences, all enforced HERE
-- rather than by the api that calls it:
--
--   1. an ADMIN may restrict MEMBERS. An admin may not restrict admins —
--      otherwise two admins could lock each other, and this screen, away.
--   2. an OWNER may restrict ADMINS. The owner is the exit.
--   3. NOBODY may restrict the owner. There is no row for it: the check
--      constraint refuses the role outright, so the last door out of any
--      configuration is unrepresentable as closed.
--
-- The ability to OPEN this surface is not itself a capability, deliberately.
-- If it were, an admin could remove admins' access to the screen that undoes
-- it, and only a hand-written UPDATE would recover the org.
--
-- ============================ THE DEFAULT ==============================
-- An ABSENT row means allowed. A fresh org has no rows and everybody can do
-- everything their role and RLS already permit — the product behaves exactly
-- as it did before this table existed. A restriction is a written decision,
-- never an omission, and `allowed = true` rows are kept rather than deleted
-- so that turning something back on is visible in the audit trail.

begin;

create table echo.role_capability (
  org_id     uuid not null references echo.org(id),
  -- 'member' or 'admin' only; the owner is the exit and is unrestrictable
  role       echo.member_role not null,
  -- the closed vocabulary lives in core (vocabulary.ts) and is mirrored by
  -- a length check here, not by an enum: adding a capability must not need
  -- a migration, and a typo'd name simply matches no enforcement point and
  -- restricts nothing. Bounded so the column cannot become a text dump.
  capability text not null check (char_length(capability) between 3 and 60),
  allowed    boolean not null,
  updated_by uuid not null references echo.app_user(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, role, capability),
  constraint role_capability_never_owner check (role <> 'owner')
);

comment on table echo.role_capability is
  'per-org, per-role capability switches. Absent = allowed. Narrows what the api offers; never widens what RLS permits. The owner role is unrepresentable here by constraint.';

alter table echo.role_capability enable row level security;
alter table echo.role_capability force row level security;

-- READ: any active member of the org. A person is entitled to know what
-- they may do — hiding the rules from the people they bind is how a
-- refusal becomes a bug report.
create policy role_capability_read on echo.role_capability
  for select to echo_app, echo_agent
  using (org_id = echo.actor_org_id() and echo.actor_is_active());

-- WRITE: the hierarchy above, as one predicate in both directions.
-- `with check` guards the row being written; `using` guards the row being
-- replaced, so an admin cannot delete an admin-row either.
create policy role_capability_write on echo.role_capability
  for all to echo_app
  using (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (echo.actor_is_owner() or (echo.actor_is_admin() and role = 'member'))
  )
  with check (
    org_id = echo.actor_org_id()
    and echo.actor_is_active()
    and (echo.actor_is_owner() or (echo.actor_is_admin() and role = 'member'))
  );

grant select, insert, update, delete on echo.role_capability to echo_app;
grant select on echo.role_capability to echo_agent;

commit;
