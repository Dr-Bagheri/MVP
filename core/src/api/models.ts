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

/**
 * Suggested models, best first. Everything else follows in catalogue order.
 *
 * The steward asked me to "order by the existing suggestion ranking, never
 * alphabetically". **There was no existing ranking** — `builtinModels()`
 * gives id, name and reasoning, and the api had been serving them in
 * catalogue order, which is alphabetical, which is why the first thing every
 * new user saw was `ai21/jamba-large-1.7` from a provider that has been
 * RETIRED. A live loop run died on it.
 *
 * So this list is new, and it is a judgement rather than a measurement: these
 * are the models this product actually runs on and that have been observed
 * answering with tools. Saying that plainly matters — a ranking presented as
 * derived when it is curated is the same lie as a filter presented as
 * enforcement when it is a guess.
 *
 * The real fix is liveness, and the steward has named the seam: our own
 * `agent_run` error classes per model are a reputation source, so a later
 * pass can demote recently-hard-failing models. Until then this is
 * presentation only, and it does not pretend otherwise — nothing is removed,
 * only ordered.
 */
export const SUGGESTED_MODELS: readonly string[] = [
  // The user's chosen lineup (2026-08-16 directive): these five ARE the
  // org's allow-list on the live deployment; the ranking matches it so the
  // picker leads with what the org actually runs.
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5.2",
  "google/gemini-3.1-flash-lite",
  "deepseek/deepseek-v3.2",
  "meta-llama/llama-4-scout",
];

/**
 * Providers this product does not offer (M5, user directive: no Claude).
 *
 * ── How this came to be missing, because that is the useful part ────────────
 *
 * The rule was decided and recorded, and it existed in NO CODE. The live
 * catalogue served **28 `anthropic/*` models**, and my own curated ranking
 * named two of them at positions 2 and 5 — so the product was offering, and
 * recommending, models the user had explicitly excluded. I wrote that ranking
 * hours after the directive was set and never checked it against the rule.
 *
 * It is not in SPEC.md either. A rule that lives only in a decision log is a
 * rule the code has never been asked about, and this is what that looks like
 * from the inside: everyone believed the filter existed because the filter
 * was described. That belief survived a live catalogue read, a live model
 * pick and an end-to-end run.
 *
 * So it is enforced here, in both directions — a barred model is not listed
 * AND cannot be chosen — and `test/models-members.test.ts` asserts the
 * absence directly, in the negative-space idiom Backend 3 used to forbid a
 * call-level timing column: the assertion is that nothing matching this ever
 * appears, so a future catalogue addition cannot reintroduce one quietly.
 */
export const EXCLUDED_PROVIDERS: readonly string[] = ["anthropic/"];

const isExcluded = (id: string): boolean =>
  EXCLUDED_PROVIDERS.some((prefix) => id.startsWith(prefix));

/** Suggested first (in the order above), then everything else unchanged. */
function bySuggestion<T extends { id: string }>(models: T[]): T[] {
  const rank = (id: string): number => {
    const at = SUGGESTED_MODELS.indexOf(id);
    return at === -1 ? SUGGESTED_MODELS.length : at;
  };
  // A STABLE sort: models outside the suggested list keep catalogue order
  // relative to each other rather than being shuffled by an arbitrary tie
  // break. Array.prototype.sort is stable in every runtime we target.
  return [...models].sort((a, b) => rank(a.id) - rank(b.id));
}

export function createModelsRepo(db: Db, options: ModelsOptions = {}) {
  const capabilityOf = options.capability ?? toolCapability;
  return {
    /**
     * The choose-by-name wall, for the ASK wire (found 2026-08-18): the ask
     * route took `body.model` as free text, so a barred or invented model was
     * selectable by anyone who typed its id — the exact hole the no-Claude
     * finding closed on `preferred`, reopened one route over. Catalogue and
     * exclusion only, deliberately no capability probe: this runs on every
     * ask, and refusing a legitimate model during a capability-check outage
     * would take conversations down for someone else's downtime.
     */
    assertAskable(modelId: string): void {
      if (!catalogue().some((m) => m.id === modelId)) {
        throw new ValidationError(`unknown model: ${modelId}`);
      }
      if (isExcluded(modelId)) {
        throw new ValidationError(`model is not available on this product: ${modelId}`);
      }
    },
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
      // M5's provider exclusion applies FIRST and unconditionally: an admin's
      // allow-list cannot re-admit a barred provider, and neither can the
      // capability filter passing it through. A rule that any later filter
      // could undo is not a rule.
      const offered = all.filter((m) => !isExcluded(m.id));
      const permitted = curated ? offered.filter((m) => allowed.includes(m.id)) : offered;

      // SPEC: models that cannot call tools are not selectable. Enforced from
      // OpenRouter's real metadata, and only when that metadata was readable
      // — see model-capability.ts for why an outage does not empty the list.
      const capability = await capabilityOf();
      const models = bySuggestion(capability.known
        ? permitted.filter((m) => capability.toolCapable.has(m.id))
        : permitted,
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
     * The CURATION view (Part 3): the whole offered catalogue with a flag
     * per model, for the admin allow-list screen. Distinct from `list()` on
     * purpose — the picker serves what a member may USE (allow-list applied),
     * the curation serves what an admin may PERMIT (allow-list rendered, not
     * applied). The M5 provider exclusion still applies FIRST: a barred
     * provider is not offered even as a checkbox, because a rule any later
     * filter can undo is not a rule.
     *
     * Tool capability is a MARKER here, never a filter: an admin allowing a
     * tool-incapable model should see why members won't be offered it,
     * rather than watching a checked box produce nothing.
     */
    async curation(identity: Identity): Promise<{
      models: { id: string; name: string; allowed: boolean; suggested: boolean; tools?: boolean }[];
      curated: boolean;
    }> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ allowed_models: string[] | null }>(
          `select o.allowed_models
             from echo.app_user u join echo.org o on o.id = u.org_id
            where u.id = $1 limit 1`,
          [identity.userId],
        ),
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("member not found");
      const allowed = row.allowed_models ?? [];
      const curated = allowed.length > 0;
      const offered = catalogue().filter((m) => !isExcluded(m.id));
      const capability = await capabilityOf();
      return {
        models: bySuggestion(offered).map((m) => ({
          id: m.id,
          name: m.name,
          allowed: !curated || allowed.includes(m.id),
          suggested: SUGGESTED_MODELS.includes(m.id),
          ...(capability.known ? { tools: capability.toolCapable.has(m.id) } : {}),
        })),
        curated,
      };
    },

    /**
     * The caller's saved model, or null.
     *
     * Exists because `preferred_model` was WRITTEN and read by nothing: a
     * person could choose a model, see it saved, and have every conversation
     * ignore it, because the assistant used only the request body. Stored and
     * unqueried is unverified — the same shape as `request` being
     * double-encoded because no query ever asked it anything.
     */
    async preferred(identity: Identity): Promise<string | null> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ preferred_model: string | null }>(
          `select preferred_model from echo.app_user where id = $1 limit 1`,
          [identity.userId],
        ),
      );
      return rows[0]?.preferred_model ?? null;
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
        // Both directions, or the filter is decorative: a barred model that
        // is merely hidden can still be chosen by anyone who names it, and
        // `preferred_model` is read by the assistant on every turn.
        if (isExcluded(modelId)) {
          throw new ValidationError(`model is not available on this product: ${modelId}`);
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
