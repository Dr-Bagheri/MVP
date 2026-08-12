/**
 * The model catalogue and the member's own choice (M5).
 *
 * M5's rule is that the product imposes no default model: each user picks
 * from a live catalogue, an admin may curate an allow-list, and nothing here
 * invents a fallback. `preferred_model` NULL is a real state meaning "has not
 * chosen", not a hole to be filled.
 *
 * ── SPEC's tool-capability filter ──────────────────────────────────────────
 *
 * SPEC §"The assistant": *"models that cannot call tools are not selectable"*.
 * `builtinModels()` does not carry that fact, so this shipped briefly with
 * the filter unapplied and `tool_capability_filtered: false` on the wire —
 * an honest gap, chosen over a name-matching heuristic that would have looked
 * like enforcement while being a guess.
 *
 * It IS enforced now, from OpenRouter's `supported_parameters` (see
 * model-capability.ts). The flag stayed and changed meaning: it now reports
 * whether THIS response was filtered, because the capability catalogue is
 * someone else's service and can be unreachable.
 *
 * Also enforced: the org's admin-curated allow-list.
 */
import { catalogue } from "../agent/pi.ts";
import { NotFoundError, ValidationError } from "./errors.ts";
import { toolCapability, type CapabilityMap } from "./model-capability.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export interface ModelChoice {
  id: string;
  name: string;
  /** Whether the provider requires a reasoning level (pi sends none by default). */
  reasoning: boolean;
  /** True for the caller's current `preferred_model`. */
  selected: boolean;
  /**
   * Confirmed to accept `tools` (OpenRouter `supported_parameters`). Only
   * present when the capability catalogue was readable — absent means "we did
   * not check", never "no".
   */
  tools?: boolean;
}

export interface ModelCatalogue {
  models: ModelChoice[];
  /** NULL = the user has not chosen. M5: no default is imposed. */
  preferred_model: string | null;
  /** True when an admin has curated the list, so the UI can say so. */
  curated: boolean;
  /**
   * TRUE when models that cannot call tools were removed (SPEC), FALSE when
   * the capability catalogue could not be read and nothing was filtered.
   *
   * False does NOT mean "no filter exists" — it means this response was not
   * filtered, so a consumer must not tell the user the list is tool-safe.
   */
  tool_capability_filtered: boolean;
  /**
   * Present and true when the filter used a PREVIOUS successful lookup
   * because the current one failed. The list is still filtered on real data,
   * just not today's — worth labelling rather than hiding, since a model
   * added in the last hour would be missing from it.
   */
  tool_capability_stale?: boolean;
}

/**
 * `capability` is injectable so a unit test never reaches the network. It
 * defaults to the real lookup, which means the DEFAULT is the production
 * path — a test that forgets to inject gets a real fetch and a slow, flaky
 * failure, rather than a silent stub that always says "capable".
 */
export interface ModelsOptions {
  capability?: (() => Promise<CapabilityMap>) | undefined;
}

export function createModelsRepo(db: Db, options: ModelsOptions = {}) {
  const capabilityOf = options.capability ?? toolCapability;
  return {
    async list(identity: Identity): Promise<ModelCatalogue> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ allowed_models: string[] | null; preferred_model: string | null }>(
          `select o.allowed_models, u.preferred_model
             from echo.app_user u
             join echo.org o on o.id = u.org_id
            where u.id = $1
            limit 1`,
          [identity.userId],
        ),
      );
      // Only an ACTIVE member reaches here (requireActive), and an active
      // member can read their own org — so no row means something is wrong
      // rather than "not curated".
      const row = rows[0];
      if (!row) throw new NotFoundError("member not found");

      const allowed = row.allowed_models ?? [];
      const curated = allowed.length > 0;
      const all = catalogue();
      // Empty allow-list = admin has not curated = the shipped catalogue
      // (db/0002's comment). NOT "nothing is allowed" — that reading would
      // leave every new org unable to pick a model at all.
      const permitted = curated ? all.filter((m) => allowed.includes(m.id)) : all;

      // SPEC: models that cannot call tools are not selectable. Enforced from
      // OpenRouter's real metadata, and only when that metadata was readable
      // — see model-capability.ts for why an outage does not empty the list.
      const capability = await capabilityOf();
      const models = (capability.known
        ? permitted.filter((m) => capability.toolCapable.has(m.id))
        : permitted
      ).map((m) => ({
        ...m,
        selected: m.id === row.preferred_model,
        ...(capability.known ? { tools: capability.toolCapable.has(m.id) } : {}),
      }));

      return {
        models,
        preferred_model: row.preferred_model,
        curated,
        tool_capability_filtered: capability.known,
        ...(capability.stale === true ? { tool_capability_stale: true } : {}),
      };
    },

    /**
     * The member's own choice. Not an admin action — M5 puts the pick with
     * the person, and db/0013's `app_user_write` already lets someone update
     * their own row, so RLS is the wall here as everywhere else.
     */
    async choose(identity: Identity, modelId: string | null): Promise<{ preferred_model: string | null }> {
      if (modelId !== null) {
        if (typeof modelId !== "string" || modelId.trim() === "") {
          throw new ValidationError("model must be a non-empty string or null");
        }
        // Checked against the CATALOGUE, not free text: a typo'd id would
        // otherwise be stored happily and fail at generation time, far from
        // the mistake.
        if (!catalogue().some((m) => m.id === modelId)) {
          throw new ValidationError(`unknown model: ${modelId}`);
        }
        // Fail closed on a KNOWN-incapable model (steward ruling): choosing
        // one would produce an assistant whose every tool call fails, which
        // reads as a broken product rather than a bad pick. When capability
        // could not be checked, nothing is refused — refusing on an outage
        // would block a legitimate choice for someone else's downtime.
        const capability = await capabilityOf();
        if (capability.known && !capability.toolCapable.has(modelId)) {
          throw new ValidationError(`model cannot call tools: ${modelId}`);
        }
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ preferred_model: string | null }>(
          `update echo.app_user set preferred_model = $2 where id = $1
           returning preferred_model`,
          [identity.userId, modelId],
        ),
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("member not found");
      return { preferred_model: row.preferred_model };
    },
  };
}

export type ModelsRepo = ReturnType<typeof createModelsRepo>;
