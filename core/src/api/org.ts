/**
 * The organization itself (M25, Settings · CONFIGURATION · General).
 *
 * Thin on purpose, like every other repo here: `org_read` already restricts
 * the row to `id = actor_org_id()` and `org_admin_update` already requires an
 * admin, so this file does not re-check either. What it owns is shape,
 * validation, and which columns are settable.
 *
 * ── Why `status` is NOT settable ────────────────────────────────────────────
 *
 * Suspension is what the PLATFORM does to an org, not what an org does to
 * itself. An admin who set their own org suspended would lock out every
 * member including themselves, and — because `resolveIdentity` reads
 * org_status — would then be unable to reach the very endpoint that could
 * undo it. A self-service button whose only outcome is an unrecoverable state
 * is not a feature.
 *
 * ── This used to be the ONLY thing stopping it ──────────────────────────────
 *
 * When this was written, `echo_app` held the UPDATE grant on `status` and
 * `org_admin_update` would have allowed it: the decision lived in this
 * handler and nowhere else, so any future PATCH, bulk-settings endpoint or
 * admin tool would have inherited the trap without inheriting the reasoning.
 *
 * db/0052 moved it into the schema. Application roles can no longer write
 * `echo.org.status` at all — verified live, `42501`: *"an organization's
 * status is set by the vendor, not from the application"* — and
 * `echo.vendor_set_org_status()` is the vendor-only door, deliberately built
 * to go BOTH ways, because an operation that could only suspend would
 * recreate the one-way street it exists to remove.
 *
 * So the refusal below is now belt-and-braces rather than the only strap. It
 * stays because a handler that never offers the field is better than one that
 * offers it and gets a 500 from the wall, and the test asserting `status = `
 * never appears in the UPDATE stays for the same reason.
 *
 * B3 minted D27 from this pattern's second instance (M11's soft delete was
 * the first): **any state transition that removes the actor's power to make
 * the reverse transition needs its exit built at the same time as its
 * entrance.**
 */
import { changedFields, record } from "./admin-actions.ts";
import { NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import { type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface OrgRecord {
  id: string;
  name: string;
  /** `echo.org_status`. Read-only here — see the header. */
  status: string;
  locale: string;
  /**
   * Org-level model curation. Empty array = no curation, which means "every
   * model the platform offers", NOT "no models" — the distinction is load
   * bearing and `models.ts` owns it. Published so an admin screen can show
   * the current list without inferring it from what `/v1/models` returns.
   */
  allowed_models: string[];
  created_at: string;
}

const ORG_COLUMNS = `id, name, status, locale, allowed_models, created_at`;

const toOrg = (row: Record<string, unknown>): OrgRecord => ({
  id: row.id as string,
  name: String(row.name),
  status: String(row.status),
  locale: String(row.locale),
  allowed_models: (row.allowed_models as string[] | null) ?? [],
  created_at: iso(row.created_at),
});

const MAX_NAME = 120;

export function createOrgRepo(db: Db) {
  return {
    /** The caller's own org. Any active member — the shell shows its name. */
    async get(identity: Identity): Promise<OrgRecord> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${ORG_COLUMNS} from echo.org where id = $1`, [identity.orgId],
        ),
      );
      const row = rows[0];
      // Not reachable through normal use — an identity carries an org id read
      // from the same database a moment earlier. It IS reachable if the org
      // was deleted mid-session, and a 404 says that truthfully where a crash
      // would blame us.
      if (!row) throw new NotFoundError("organization not found");
      return toOrg(row);
    },

    /**
     * Rename / re-locale / re-curate. Admin-gated at the route, enforced by
     * `org_admin_update` in the wall.
     */
    async update(
      identity: Identity,
      patch: { name?: string | undefined; locale?: string | undefined; allowedModels?: string[] | undefined },
    ): Promise<OrgRecord> {
      const name = patch.name?.trim();
      if (patch.name !== undefined) {
        if (!name) throw new ValidationError("name cannot be empty");
        if (name.length > MAX_NAME) throw new ValidationError(`name must be ${MAX_NAME} characters or fewer`);
      }
      if (patch.locale !== undefined && !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(patch.locale)) {
        // A BCP-47-ish shape rather than a closed set: the product is fa/en
        // today, and hard-coding those two here would make adding a third a
        // code change in a file that has no opinion about languages.
        throw new ValidationError("locale must look like 'fa' or 'en-GB'");
      }
      if (patch.allowedModels !== undefined) {
        if (!Array.isArray(patch.allowedModels)
            || patch.allowedModels.some((m) => typeof m !== "string" || !m.trim())) {
          throw new ValidationError("allowed_models must be an array of model ids");
        }
      }
      if (name === undefined && patch.locale === undefined && patch.allowedModels === undefined) {
        throw new ValidationError("nothing to update");
      }

      const rows = await db.withIdentity(identity, async (tx: SqlTx) => {
        const updated = await tx.unsafe<Record<string, unknown>>(
          `update echo.org
              set name           = coalesce($2::text, name),
                  locale         = coalesce($3::text, locale),
                  allowed_models = coalesce($4::text[], allowed_models)
            where id = $1
            returning ${ORG_COLUMNS}`,
          [identity.orgId, name ?? null, patch.locale ?? null, patch.allowedModels ?? null],
        );
        /**
         * Audited in the SAME transaction, and only after the update actually
         * affected a row — a zero-row change must not leave a log entry
         * claiming it happened. Field NAMES only: an audit reader learns the
         * org was renamed, never what to.
         */
        if (updated[0]) {
          await record(tx, identity, {
            action: "org_updated",
            targetType: "org",
            targetId: identity.orgId,
            detail: changedFields({
              name, locale: patch.locale, allowed_models: patch.allowedModels,
            }),
          });
        }
        return updated;
      });
      const row = rows[0];
      // Zero rows here is the policy refusing, not a missing org — same 404
      // posture as everywhere else rather than a 403 that would confirm the
      // row exists to someone who may not touch it.
      if (!row) throw new NotFoundError("organization not found");
      return toOrg(row);
    },
  };
}

export type OrgRepo = ReturnType<typeof createOrgRepo>;
