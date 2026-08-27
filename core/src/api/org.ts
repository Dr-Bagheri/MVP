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
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import { type Db, type SqlTx } from "../db/identity.ts";
import { hasOrgGlossary, hasOrgProfile } from "../db/capabilities.ts";
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
  /** 0088 STT glossary. ABSENT until the migration runs on the deployment. */
  glossary?: string[];
  /**
   * db/0102 — the organisation's public face. ABSENT as a group until the
   * migration runs; null within the group means "not published", which is
   * a real answer and not an empty string. The check constraints refuse a
   * blank, so the two states cannot both exist for one field.
   */
  public_email?: string | null;
  description?: string | null;
  website_url?: string | null;
  location?: string | null;
  logo_url?: string | null;
  social_links?: string[];
}

const ORG_COLUMNS = `id, name, status, locale, allowed_models, created_at`;

const toOrg = (row: Record<string, unknown>): OrgRecord => ({
  id: row.id as string,
  name: String(row.name),
  status: String(row.status),
  locale: String(row.locale),
  allowed_models: (row.allowed_models as string[] | null) ?? [],
  created_at: iso(row.created_at),
  // absent stays absent on an un-migrated deployment
  ...(row.glossary !== undefined ? { glossary: (row.glossary as string[] | null) ?? [] } : {}),
  ...(row.logo_url !== undefined
    ? {
        public_email: (row.public_email as string | null) ?? null,
        description: (row.description as string | null) ?? null,
        website_url: (row.website_url as string | null) ?? null,
        location: (row.location as string | null) ?? null,
        logo_url: (row.logo_url as string | null) ?? null,
        social_links: (row.social_links as string[] | null) ?? [],
      }
    : {}),
});

/** db/0102's columns, named once so the read and the write cannot drift */
const PROFILE_COLUMNS = ", public_email, description, website_url, location, logo_url, social_links";

const MAX_NAME = 120;

export function createOrgRepo(db: Db) {
  return {
    /** The caller's own org. Any active member — the shell shows its name. */
    async get(identity: Identity): Promise<OrgRecord> {
      const withGlossary = await hasOrgGlossary(db);
      const withProfile = await hasOrgProfile(db);
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${ORG_COLUMNS}${withGlossary ? ", glossary" : ""}${
            withProfile ? PROFILE_COLUMNS : ""} from echo.org where id = $1`,
          [identity.orgId],
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
      patch: {
        name?: string | undefined;
        locale?: string | undefined;
        allowedModels?: string[] | undefined;
        /** 0088: the STT recognition glossary — whole-set replacement. */
        glossary?: string[] | undefined;
        /* db/0102 — the public face. null CLEARS, absent leaves alone. */
        publicEmail?: string | null | undefined;
        description?: string | null | undefined;
        websiteUrl?: string | null | undefined;
        location?: string | null | undefined;
        logoUrl?: string | null | undefined;
        socialLinks?: string[] | undefined;
      },
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
      let glossary: string[] | null = null;
      if (patch.glossary !== undefined) {
        if (!(await hasOrgGlossary(db))) throw new ConflictError("not_migrated");
        if (!Array.isArray(patch.glossary) || patch.glossary.some((t) => typeof t !== "string")) {
          throw new ValidationError("glossary must be an array of strings");
        }
        // the api re-speaks the 0088 trigger's sentence; the trigger is the wall
        glossary = [...new Set(patch.glossary.map((t) => t.trim()).filter((t) => t !== ""))];
        if (glossary.length > 200) {
          throw new ValidationError("at most 200 glossary terms",
            { code: "too_many_terms", params: { max: 200 } });
        }
        if (glossary.some((t) => t.length > 60)) {
          throw new ValidationError("each glossary term is at most 60 characters",
            { code: "term_too_long", params: { max: 60 } });
        }
      }
      /*
       * db/0102's public face. Each field is SUPPLIED-FLAG, not coalesce:
       * `null` clears — "we publish no email" is an answer — and absent
       * leaves alone. Coalesce here would make clearing impossible, which
       * is the save-button-does-nothing trap for exactly one interaction.
       */
      const withProfile = await hasOrgProfile(db);
      const PROFILE_FIELDS = [
        ["public_email", patch.publicEmail],
        ["description", patch.description],
        ["website_url", patch.websiteUrl],
        ["location", patch.location],
        ["logo_url", patch.logoUrl],
      ] as const;
      const profileSupplied = PROFILE_FIELDS.filter(([, v]) => v !== undefined);
      const withSocials = patch.socialLinks !== undefined;
      if ((profileSupplied.length > 0 || withSocials) && !withProfile) {
        throw new ConflictError("not_migrated");
      }
      if (name === undefined && patch.locale === undefined
        && patch.allowedModels === undefined && patch.glossary === undefined
        && profileSupplied.length === 0 && !withSocials) {
        throw new ValidationError("nothing to update");
      }

      const withGlossary = patch.glossary !== undefined;
      const rows = await db.withIdentity(identity, async (tx: SqlTx) => {
        /* columns and values built TOGETHER — the placeholder-drift guard */
        const params: unknown[] = [
          identity.orgId, name ?? null, patch.locale ?? null, patch.allowedModels ?? null,
        ];
        const sets = [
          "name           = coalesce($2::text, name)",
          "locale         = coalesce($3::text, locale)",
          "allowed_models = coalesce($4::text[], allowed_models)",
        ];
        if (withGlossary) {
          params.push(glossary);
          sets.push(`glossary = $${params.length}::text[]`);
        }
        for (const [column, value] of profileSupplied) {
          // a blank string IS a clear: the column's check refuses blanks, so
          // one spelling of "not published" reaches the database
          const trimmed = typeof value === "string" ? value.trim() : null;
          params.push(trimmed === "" ? null : trimmed);
          sets.push(`${column} = $${params.length}::text`);
        }
        if (withSocials) {
          const links = (patch.socialLinks ?? [])
            .map((l: string) => l.trim()).filter((l: string) => l !== "").slice(0, 6);
          params.push(links);
          sets.push(`social_links = $${params.length}::text[]`);
        }
        const updated = await tx.unsafe<Record<string, unknown>>(
          `update echo.org set ${sets.join(", ")}
            where id = $1
            returning ${ORG_COLUMNS}${withGlossary ? ", glossary" : ""}${
              withProfile ? PROFILE_COLUMNS : ""}`,
          params,
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
              glossary: patch.glossary,
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
