/**
 * NeurAI Platform control plane (M32).
 *
 * This repository is deliberately small and deliberately does NOT offer a
 * generic cross-organisation database handle. A platform root can see only
 * the metadata fields selected here, and the database grants/RLS policies
 * enforce the same limit beneath this module. Customer content is not a
 * missing UI tab; it is absent from this API and remains denied by RLS.
 */
import type { Identity } from "../agent/types.ts";
import { NotFoundError, ValidationError } from "./errors.ts";
import { MEMBER_ROLES, type MemberRole, type UserStatus } from "./vocabulary.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import { hasConsoleSightDoors } from "../db/capabilities.ts";

export interface PlatformOverview {
  /** The signed-in root only; lets the console avoid offering self-removal. */
  current_user_id: string;
  organizations: { total: number; active: number; suspended: number };
  users: { total: number; active: number; pending: number; disabled: number };
  platform_roots: number;
}

export interface PlatformOrganization {
  id: string;
  name: string;
  status: OrgStatus;
  locale: string;
  /** Receives bare registrations (0149). At most one org platform-wide. */
  accepts_signups: boolean;
  created_at: string;
  member_count: number;
  /** Soft-delete bookkeeping (0068). Null unless the org is in the purge window. */
  deleted_at: string | null;
  purge_after: string | null;
}

export interface PlatformUser {
  id: string;
  org_id: string;
  org_name: string;
  email: string;
  display_name: string;
  display_name_en: string | null;
  username: string | null;
  locale: string;
  role: string;
  status: UserStatus;
  created_at: string;
  last_seen_at: string | null;
  is_platform_root: boolean;
  deleted_at: string | null;
  purge_after: string | null;
  /**
   * When this account was ERASED — not deleted, finished.
   *
   * A tombstone has no name, no address and no way to sign in; it is a
   * receipt, not an account, and the row survives because `platform_audit
   * .target_user_id` is ON DELETE RESTRICT and the audit's subject may not be
   * removed by the operator it records. Null for every account that still is
   * one, which is what makes it a filter rather than a decoration.
   */
  tombstoned_at: string | null;
}

export interface PlatformAuditEntry {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  target_user_id: string | null;
  target_org_id: string | null;
  reason: string;
  created_at: string;
}

export interface PlatformPage<T> {
  items: T[];
  next_offset: number | null;
}

interface CountRow {
  organization_total: string | number;
  organization_active: string | number;
  organization_suspended: string | number;
  user_total: string | number;
  user_active: string | number;
  user_pending: string | number;
  user_disabled: string | number;
  platform_roots: string | number;
}

interface OrganizationRow {
  id: string;
  name: string;
  status: OrgStatus;
  locale: string;
  accepts_signups: boolean;
  created_at: Date | string;
  member_count: string | number;
  deleted_at: Date | string | null;
  purge_after: Date | string | null;
}

interface UserRow {
  id: string;
  org_id: string;
  org_name: string;
  email: string;
  display_name: string;
  display_name_en: string | null;
  username: string | null;
  locale: string;
  role: string;
  status: UserStatus;
  created_at: Date | string;
  last_seen_at: Date | string | null;
  is_platform_root: boolean;
  deleted_at: Date | string | null;
  purge_after: Date | string | null;
  tombstoned_at: Date | string | null;
}

interface AuditRow {
  id: string | number;
  actor_id: string;
  actor_email: string;
  action: string;
  target_user_id: string | null;
  target_org_id: string | null;
  reason: string;
  created_at: Date | string;
}

const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 120;
type OrgStatus = "active" | "suspended";

function number(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function pageOptions(
  input: { offset?: number | undefined; limit?: number | undefined } = {},
): { offset: number; limit: number } {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 50;
  if (!Number.isInteger(offset) || offset < 0) throw new ValidationError("offset must be a non-negative integer");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ValidationError(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return { offset, limit };
}

function searchTerm(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length > MAX_SEARCH_LENGTH) {
    throw new ValidationError(`search must be at most ${MAX_SEARCH_LENGTH} characters`);
  }
  return trimmed || null;
}

function reason(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    throw new ValidationError("reason must be 3 to 500 characters");
  }
  return trimmed;
}

function uuid(value: string, label: string): string {
  try {
    return assertUuid(value, label);
  } catch {
    throw new ValidationError(`${label} must be a UUID`);
  }
}

function page<T>(rows: T[], offset: number, limit: number): PlatformPage<T> {
  const more = rows.length > limit;
  return { items: rows.slice(0, limit), next_offset: more ? offset + limit : null };
}

/** A named, fresh database decision; never derived from a JWT claim. */
export async function isPlatformRoot(db: Db, identity: Identity): Promise<boolean> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ is_platform_root: boolean }>("select echo.actor_is_platform_root() as is_platform_root"),
  );
  return rows[0]?.is_platform_root === true;
}

export function createPlatformRepo(db: Db) {
  return {
    isRoot(identity: Identity): Promise<boolean> {
      return isPlatformRoot(db, identity);
    },

    async bootstrap(identity: Identity, expectedEmail: string): Promise<boolean> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ created: boolean }>(
          "select echo.bootstrap_platform_root($1, $2::citext) as created",
          [identity.userId, expectedEmail],
        ),
      );
      return rows[0]?.created === true;
    },

    async overview(identity: Identity): Promise<PlatformOverview> {
      // 0091: counts run at platform altitude only through the door — a
      // count below the wall is an inventory true only for the counter
      const viaDoor = await hasConsoleSightDoors(db);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<CountRow>(viaDoor ? `
        select * from echo.platform_overview_counts()
      ` : `
        select
          (select count(*) from echo.org) as organization_total,
          (select count(*) from echo.org where status = 'active') as organization_active,
          (select count(*) from echo.org where status = 'suspended') as organization_suspended,
          (select count(*) from echo.app_user) as user_total,
          (select count(*) from echo.app_user where status = 'active') as user_active,
          (select count(*) from echo.app_user where status = 'pending') as user_pending,
          (select count(*) from echo.app_user where status = 'disabled') as user_disabled,
          (select count(*) from echo.platform_operator) as platform_roots
      `));
      const row = rows[0];
      if (!row) throw new NotFoundError();
      return {
        current_user_id: identity.userId,
        organizations: {
          total: number(row.organization_total),
          active: number(row.organization_active),
          suspended: number(row.organization_suspended),
        },
        users: {
          total: number(row.user_total),
          active: number(row.user_active),
          pending: number(row.user_pending),
          disabled: number(row.user_disabled),
        },
        platform_roots: number(row.platform_roots),
      };
    },

    async organizations(
      identity: Identity,
      input: {
        search?: string | undefined;
        offset?: number | undefined;
        limit?: number | undefined;
        deleted?: boolean | undefined;
      } = {},
    ): Promise<PlatformPage<PlatformOrganization>> {
      const { offset, limit } = pageOptions(input);
      const search = searchTerm(input.search);
      // A boolean, never user text — safe to branch the SQL fragment on.
      const deletedClause = input.deleted ? "o.deleted_at is not null" : "o.deleted_at is null";
      /*
       * 0091: sight through the CONSOLE DOOR (definer function), because the
       * 0066 product-table policies are dropped — they made every org screen
       * platform-wide for a root. The pre-0091 branch keeps the old direct
       * read working until the migration lands; it still serves then because
       * the old policies still exist exactly as long as the door doesn't.
       */
      const viaDoor = await hasConsoleSightDoors(db);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<OrganizationRow>(viaDoor ? `
        select o.id, o.name, o.status, o.locale, o.accepts_signups, o.created_at, o.deleted_at, o.purge_after,
               o.member_count
          from echo.platform_list_orgs() o
         where ${deletedClause}
           and ($1::text is null or o.name ilike ('%' || $1 || '%'))
         order by o.created_at desc, o.id desc
         offset $2 limit $3
      ` : `
        select o.id, o.name, o.status, o.locale, o.accepts_signups, o.created_at, o.deleted_at, o.purge_after,
               count(u.id) as member_count
          from echo.org o
          left join echo.app_user u on u.org_id = o.id
         where ${deletedClause}
           and ($1::text is null or o.name ilike ('%' || $1 || '%'))
         group by o.id
         order by o.created_at desc, o.id desc
         offset $2 limit $3
      `, [search, offset, limit + 1]));
      return page(rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        locale: row.locale,
        accepts_signups: row.accepts_signups === true,
        created_at: iso(row.created_at),
        member_count: number(row.member_count),
        deleted_at: row.deleted_at ? iso(row.deleted_at) : null,
        purge_after: row.purge_after ? iso(row.purge_after) : null,
      })), offset, limit);
    },

    async users(
      identity: Identity,
      input: {
        search?: string | undefined;
        offset?: number | undefined;
        limit?: number | undefined;
        deleted?: boolean | undefined;
      } = {},
    ): Promise<PlatformPage<PlatformUser>> {
      const { offset, limit } = pageOptions(input);
      const search = searchTerm(input.search);
      /*
       * THE ROSTER SHOWS ACCOUNTS (user report, 2026-09-04: "I can't delete
       * the disabled users from the platform root").
       *
       * Two finished tombstones sat in the console's user list, and there was
       * nothing to press: `platform_purge_user` had already run on them — its
       * own comment says "the row stays, the person leaves" — so the delete
       * they were looking for HAD happened and left a receipt behind.
       *
       * The list was the defect. A tombstone leaves the roster and joins the
       * trash, which is where an operator looks for what is on its way out or
       * already gone; the roster of accounts stops carrying one row per person
       * the platform has ever finished with.
       *
       * Both halves in ONE expression rather than two flags: "not here" and
       * "there" must be the same predicate, or a row lands in both lists or in
       * neither, and neither of those is discoverable from one screen.
       */
      const deletedClause = input.deleted
        ? "(u.deleted_at is not null or u.tombstoned_at is not null)"
        : "(u.deleted_at is null and u.tombstoned_at is null)";
      // 0091: through the console door once it exists (see organizations())
      const viaDoor = await hasConsoleSightDoors(db);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<UserRow>(viaDoor ? `
        select u.id, u.org_id, u.org_name, u.email,
               u.display_name, u.display_name_en, u.username, u.locale,
               u.role, u.status,
               u.created_at, u.last_seen_at, u.deleted_at, u.purge_after,
               u.is_platform_root, u.tombstoned_at
          from echo.platform_list_users() u
         where ${deletedClause}
           and ($1::text is null
                or u.email ilike ('%' || $1 || '%')
                or u.display_name ilike ('%' || $1 || '%')
                or coalesce(u.username, '') ilike ('%' || $1 || '%')
                or u.org_name ilike ('%' || $1 || '%'))
         order by u.created_at desc, u.id desc
         offset $2 limit $3
      ` : `
        select u.id, u.org_id, o.name as org_name, u.email::text as email,
               u.display_name, u.display_name_en, u.username, u.locale,
               u.role::text as role, u.status,
               u.created_at, u.last_seen_at, u.deleted_at, u.purge_after,
               exists (select 1 from echo.platform_operator p where p.user_id = u.id)
                 as is_platform_root,
               u.tombstoned_at
          from echo.app_user u
          join echo.org o on o.id = u.org_id
         where ${deletedClause}
           and ($1::text is null
                or u.email::text ilike ('%' || $1 || '%')
                or u.display_name ilike ('%' || $1 || '%')
                or coalesce(u.username, '') ilike ('%' || $1 || '%')
                or o.name ilike ('%' || $1 || '%'))
         order by u.created_at desc, u.id desc
         offset $2 limit $3
      `, [search, offset, limit + 1]));
      return page(rows.map((row) => ({
        id: row.id,
        org_id: row.org_id,
        org_name: row.org_name,
        email: row.email,
        display_name: row.display_name,
        display_name_en: row.display_name_en,
        username: row.username,
        locale: row.locale,
        role: row.role,
        status: row.status,
        created_at: iso(row.created_at),
        last_seen_at: row.last_seen_at === null ? null : iso(row.last_seen_at),
        is_platform_root: row.is_platform_root === true,
        deleted_at: row.deleted_at ? iso(row.deleted_at) : null,
        purge_after: row.purge_after ? iso(row.purge_after) : null,
        tombstoned_at: row.tombstoned_at ? iso(row.tombstoned_at) : null,
      })), offset, limit);
    },

    async audit(
      identity: Identity,
      input: { offset?: number | undefined; limit?: number | undefined } = {},
    ): Promise<PlatformPage<PlatformAuditEntry>> {
      const { offset, limit } = pageOptions(input);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<AuditRow>(`
        select a.id, a.actor_id, actor.email::text as actor_email, a.action::text as action,
               a.target_user_id, a.target_org_id, a.reason, a.created_at
          from echo.platform_audit a
          join echo.app_user actor on actor.id = a.actor_id
         order by a.created_at desc, a.id desc
         offset $1 limit $2
      `, [offset, limit + 1]));
      return page(rows.map((row) => ({
        id: String(row.id),
        actor_id: row.actor_id,
        actor_email: row.actor_email,
        action: row.action,
        target_user_id: row.target_user_id,
        target_org_id: row.target_org_id,
        reason: row.reason,
        created_at: iso(row.created_at),
      })), offset, limit);
    },

    async setOrganizationStatus(
      identity: Identity, orgId: string, status: OrgStatus, actionReason: string,
    ): Promise<boolean> {
      const org = uuid(orgId, "organization id");
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_set_org_status($1, $2, $3::echo.org_status, $4) as changed",
        [identity.userId, org, status, validReason],
      ));
      return rows[0]?.changed === true;
    },

    /**
     * Mark the ONE organization that receives bare registrations (0149).
     *
     * The database enforces "at most one" with a partial unique index and
     * clears the previous holder inside the same statement, so this repo
     * carries no rule of its own — a second copy of "only one" is how the
     * two spellings come to disagree.
     */
    async setOrganizationSignups(
      identity: Identity, orgId: string, on: boolean, actionReason: string,
    ): Promise<void> {
      const org = uuid(orgId, "organization id");
      const validReason = reason(actionReason);
      await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe(
        "select echo.platform_set_org_signups($1, $2, $3::boolean, $4)",
        [identity.userId, org, on, validReason],
      ));
    },

    async setUserStatus(
      identity: Identity, userId: string, status: UserStatus, actionReason: string,
    ): Promise<boolean> {
      const target = uuid(userId, "user id");
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_set_user_status($1, $2, $3::echo.user_status, $4) as changed",
        [identity.userId, target, status, validReason],
      ));
      return rows[0]?.changed === true;
    },

    async grantRoot(identity: Identity, userId: string, actionReason: string): Promise<boolean> {
      const target = uuid(userId, "user id");
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_grant_root($1, $2, $3) as changed",
        [identity.userId, target, validReason],
      ));
      return rows[0]?.changed === true;
    },

    async revokeRoot(identity: Identity, userId: string, actionReason: string): Promise<boolean> {
      const target = uuid(userId, "user id");
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_revoke_root($1, $2, $3) as changed",
        [identity.userId, target, validReason],
      ));
      return rows[0]?.changed === true;
    },

    // ── edit + soft-delete/restore (0068/0069) ────────────────────────────
    // Every one is a named definer function; this layer validates shape and
    // forwards. citext (email) is not editable here by design.

    async updateOrganization(
      identity: Identity, orgId: string, name: string, locale: string, actionReason: string,
    ): Promise<boolean> {
      const org = uuid(orgId, "organization id");
      if (typeof name !== "string" || name.trim() === "") {
        throw new ValidationError("organization name is required");
      }
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_update_org($1, $2, $3, $4, $5) as changed",
        [identity.userId, org, name.trim(), typeof locale === "string" ? locale.trim() : "", validReason],
      ));
      return rows[0]?.changed === true;
    },

    async updateUser(
      identity: Identity,
      userId: string,
      fields: {
        display_name?: string | undefined;
        display_name_en?: string | null | undefined;
        username?: string | null | undefined;
        locale?: string | undefined;
        role?: string | undefined;
      },
      actionReason: string,
    ): Promise<boolean> {
      const target = uuid(userId, "user id");
      const validReason = reason(actionReason);
      let role: MemberRole | null = null;
      if (fields.role !== undefined) {
        if (!(MEMBER_ROLES as readonly string[]).includes(fields.role)) {
          throw new ValidationError(`role must be one of: ${MEMBER_ROLES.join(", ")}`);
        }
        role = fields.role as MemberRole;
      }
      const text = (v: string | null | undefined): string | null =>
        v === undefined || v === null ? null : v;
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_update_user($1, $2, $3, $4, $5, $6, $7::echo.member_role, $8) as changed",
        [
          identity.userId, target,
          text(fields.display_name), text(fields.display_name_en),
          text(fields.username), text(fields.locale), role, validReason,
        ],
      ));
      return rows[0]?.changed === true;
    },

    /**
     * PLACE a pending arrival: choose their organisation and role, and
     * activate them, as ONE act (0156).
     *
     * Deliberately not two calls. Two would make a state that is reachable
     * and wrong — a member sitting ACTIVE in the organisation they invented
     * for themselves at sign-up, because the second call failed or the
     * operator's tab closed between them. The whole point of the pending
     * state is that nobody is inside an organisation until somebody decides
     * which one, and one statement cannot half-decide.
     *
     * The door refuses any status but `pending`, so this cannot become a
     * transfer: an active member's calls, tasks and history hang off their
     * org and none of it travels.
     */
    async placeUser(
      identity: Identity,
      userId: string,
      orgId: string,
      roleName: string,
      actionReason: string,
    ): Promise<boolean> {
      const target = uuid(userId, "user id");
      const org = uuid(orgId, "organization id");
      const validReason = reason(actionReason);
      if (!(MEMBER_ROLES as readonly string[]).includes(roleName)) {
        throw new ValidationError(`role must be one of: ${MEMBER_ROLES.join(", ")}`);
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ placed: boolean }>(
        "select echo.platform_assign_user_org($1, $2, $3, $4::echo.member_role, $5) as placed",
        [identity.userId, target, org, roleName, validReason],
      ));
      return rows[0]?.placed === true;
    },

    async softDeleteOrganization(identity: Identity, orgId: string, actionReason: string): Promise<boolean> {
      const org = uuid(orgId, "organization id");
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_soft_delete_org($1, $2, $3) as changed",
        [identity.userId, org, validReason],
      ));
      return rows[0]?.changed === true;
    },

    async restoreOrganization(identity: Identity, orgId: string, actionReason: string): Promise<boolean> {
      const org = uuid(orgId, "organization id");
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_restore_org($1, $2, $3) as changed",
        [identity.userId, org, validReason],
      ));
      return rows[0]?.changed === true;
    },

    async softDeleteUser(identity: Identity, userId: string, actionReason: string): Promise<boolean> {
      const target = uuid(userId, "user id");
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_soft_delete_user($1, $2, $3) as changed",
        [identity.userId, target, validReason],
      ));
      return rows[0]?.changed === true;
    },

    async restoreUser(identity: Identity, userId: string, actionReason: string): Promise<boolean> {
      const target = uuid(userId, "user id");
      const validReason = reason(actionReason);
      const rows = await db.withIdentity(identity, (tx: SqlTx) => tx.unsafe<{ changed: boolean }>(
        "select echo.platform_restore_user($1, $2, $3) as changed",
        [identity.userId, target, validReason],
      ));
      return rows[0]?.changed === true;
    },
  };
}

export type PlatformRepo = ReturnType<typeof createPlatformRepo>;
