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
 * ── THE MODELS THIS PRODUCT OFFERS ─────────────────────────────────────────
 *
 * User directive, 2026-09-18: "for model but the three best models available
 * and remove others". So this is an ALLOW-LIST rather than a ranking:
 * everything the catalogue holds and this list does not name is refused at
 * every door a model id can come through, exactly as a barred provider is.
 *
 * It replaces two lists that were ordering-only — a five-model lineup and a
 * twenty-four-model shelf — with ONE, because the moment two lists describe
 * the same set they start disagreeing about it. The order here is the
 * picker's order.
 *
 * WHAT WAS MEASURED, live on OpenRouter on the day it was set, price per
 * million in/out and the context window, all three tool-capable:
 *
 *   deepseek/deepseek-v4-flash-0731   0.06 / 0.12    1.31M
 *   z-ai/glm-5.2                      0.55 / 1.74    1.05M
 *   google/gemini-3.6-flash           0.75 / 3.75    1.05M
 *
 * A recorded observation with its conditions attached, not a number left to
 * rot: the BUNDLED catalogue's prices are a snapshot and are already wrong
 * elsewhere (`openai/gpt-5.6-terra` reads 1/6 in the bundle and bills 2/12
 * live), which is why these were read from the provider rather than from the
 * file this module already imports.
 *
 * WHY THESE THREE — a judgement on top of that measurement, said plainly
 * because a curated pick presented as derived is the same lie as a filter
 * presented as enforcement: one cheap rung the product can afford to run
 * unattended on every mail poll, one agentic rung at the top of OpenRouter's
 * tool-calling list for long-horizon work, and one proprietary flagship, so
 * that an org is not betting its whole assistant on a single vendor's
 * weights. `z-ai/glm-5.3` is live and is NOT here for a structural reason
 * rather than a preference — it is absent from the bundled catalogue, and
 * `assertAskable` and `list()` both read that catalogue, so an id it does
 * not carry cannot be offered however good it is.
 *
 * THE DATED ID IS DELIBERATE. `deepseek/deepseek-v4-flash` (the plain alias)
 * and `-0731` (the GA cut) are the same weights and 2.2x apart in tokens per
 * second, because OpenRouter's default route optimises for PRICE and the
 * alias's cheapest server is its slowest: 27 tok/s on the alias against 58
 * on the dated id, measured from the box on the same prompt. A model id is
 * not a performance decision and a routing alias is.
 */
export const OFFERED_MODELS: readonly string[] = [
  // the cheap rung: what an unattended run costs is what it is allowed to
  // cost, and this is a fortieth of the preview id it replaced as default
  "deepseek/deepseek-v4-flash-0731",
  // the agentic rung: the one to reach for when a workflow chains many steps
  "z-ai/glm-5.2",
  // the flagship, and the only proprietary one: the rung that answers "is it
  // the model or is it us" when a run goes wrong
  "google/gemini-3.6-flash",
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
export const EXCLUDED_PROVIDERS: readonly string[] = ["anthropic"];

/**
 * ── The second time this rule failed, and why the first fix could not hold ──
 *
 * The filter above was written as `id.startsWith("anthropic/")`, and on
 * 2026-08-27 the production picker was serving **`~anthropic/claude-opus-latest`**:
 * the catalogue spells some entries with a leading `~`, so the rule was
 * defeated by one character and the model appeared in the list a person
 * chooses from. Every fixture in the covering test was written as
 * `anthropic/…` — the same belief as the code, so the suite could not
 * express the failure (rule 9: a test cannot fail when its input comes from
 * the same place as the bug).
 *
 * The rule the user set is about a MODEL FAMILY, not about a routing prefix,
 * so it is enforced as one now: the vendor segment is compared after the
 * catalogue's punctuation is stripped, and any id naming `claude` is barred
 * whoever routes it. A model reselling Claude under another vendor is still
 * Claude.
 */
export const isExcluded = (id: string): boolean => {
  const normalized = id.toLowerCase().replace(/^[^a-z0-9]+/, "");
  const vendor = normalized.split("/")[0] ?? "";
  return EXCLUDED_PROVIDERS.includes(vendor) || normalized.includes("claude");
};

/**
 * ── THE SECOND HALF OF THE SAME QUESTION ───────────────────────────────────
 *
 * `isExcluded` says which model FAMILY this product refuses whoever routes
 * it. This says which ids it offers at all.
 *
 * They are deliberately kept apart although the offer list subsumes the
 * exclusion today, and the honest version of why is worth writing down
 * rather than overclaiming: with no Anthropic id in `OFFERED_MODELS`,
 * deleting `EXCLUDED_PROVIDERS` would change no BEHAVIOUR at all. What
 * keeps the rule real is that it stays a predicate with assertions of its
 * own — `model-wall.test.ts` asks it directly with the id production served,
 * and `model-ranking.test.ts` asks it of every id on the offer list — so the
 * day that list widens, the family rule is a thing that already exists and
 * already decides, rather than a paragraph somebody has to remember. The
 * first three failures of this rule all began with it being described
 * somewhere and asked nowhere.
 *
 * EXACT match, on purpose. An allow-list that normalises is an allow-list a
 * near-miss spelling gets through, and the catalogue's own `~vendor/model`
 * routing alias is exactly such a near miss.
 */
const isOffered = (id: string): boolean => OFFERED_MODELS.includes(id);

/**
 * THE ONE QUESTION EVERY GATE ASKS: will this product serve this id?
 *
 * One predicate rather than two checks at each door, because the failure
 * this file records five times over is a SECOND copy of a rule that forgets
 * half of it. Exclusion runs first, so a widened offer list can never
 * re-admit a barred family.
 *
 * WHERE it is asked decides what a refusal looks like, and that distinction
 * is the one every door here turns on: a model somebody TYPED is refused by
 * name (`assertAskable`, `choose`), and a model nobody typed — a stored
 * preference, a skill's pin, an env fallback — is simply not a rung, so the
 * ladder walks past it rather than ending a run the person never configured.
 */
const isServable = (id: string): boolean => !isExcluded(id) && isOffered(id);

/**
 * THE ORG'S CURATION, AFTER THE PRODUCT'S OWN RULES — and an allow-list that
 * survives none of them is NOT A CURATION.
 *
 * Measured on production before the 2026-09-18 narrowing shipped, at owner
 * altitude: three organisations allowed exactly `google/gemini-2.5-flash`
 * (the demo seed's own default, written by the seeder rather than chosen by
 * anybody), the server sets no `WORKER_SUMMARY_MODEL`, and three members
 * still store that id as their preference. Read the allow-list literally and
 * every one of those orgs loses every rung of M5's ladder at once: no
 * preference, no permitted model, no env fallback, so every agent answers
 * "no model selected" for the whole organisation, with no symptom anybody
 * could act on except the silence.
 *
 * So the empty intersection is treated as the ladder already treats a stored
 * preference the product will not serve: the rung is missing, take the next
 * one. It is the same sentence, one level up — a list naming only models we
 * refuse is a dangling pointer, not an instruction — and it is applied in
 * ALL THREE readers, because a picker and an admin screen disagreeing about
 * whether an org is curated is how a control comes to mean two things.
 *
 * WHAT IT COSTS, stated rather than discovered: an admin who deliberately
 * allowed one model, and only that model, gets the whole offer list back on
 * the day it stops being offered — including models they may have left out
 * on price. That is the cheaper side of the trade against an organisation
 * whose assistant silently stops answering, and it is visible on their own
 * screen the moment they look, where a stranded org looks like nothing at
 * all.
 */
function inForce(allowed: string[]): string[] {
  return allowed.filter((id) => isServable(id));
}

/**
 * ── WHAT IS NOT A MODEL ────────────────────────────────────────────────────
 *
 * The catalogue's 335 entries are not 335 models. Some are ROUTING PLANS
 * (`:batch`, `:free`), some are MOVING ALIASES (`~openai/gpt-latest`,
 * `openai/gpt-chat-latest`), some are META-ROUTERS that pick a model for you
 * (`openrouter/auto`, `openrouter/fusion`, and a bare `auto` with no vendor
 * at all), and one is a tool-schema variant (`-customtools`).
 *
 * This is the `:online` lesson generalised. That suffix was "a transport
 * feature wearing an identity's clothes" and it killed every ask for four
 * seconds a request until someone read the id closely. The same clothes are
 * all over the catalogue, and the admin picker was offering them as choices:
 * an org could allow `openai/gpt-5.2:batch` and get a model that answers on
 * a different latency contract entirely.
 *
 * A moving alias is excluded for a different reason than the rest: it
 * RESOLVES ELSEWHERE AND SILENTLY. An org that allowed `~openai/gpt-latest`
 * has allowed whatever OpenAI ships next, which is not a decision an admin
 * can be said to have made.
 */
const NOT_A_MODEL: readonly RegExp[] = [
  /:[a-z]+$/, // a routing plan (:batch, :free, :online)
  /^~/, // the catalogue's own alias spelling
  /^openrouter\//, // meta-routers: they pick a model, they are not one
  /-latest$/, // resolves to whatever ships next
  /-customtools$/, // a tool-schema variant of a model already listed
];

export const isNotAModel = (id: string): boolean =>
  !id.includes("/") || NOT_A_MODEL.some((pattern) => pattern.test(id));

/**
 * A SNAPSHOT TAIL: a date, not an identity. `-2024-11-20`, `-08-2024`,
 * `-0905`, `-2507`, `-20260420`. Every one of these names *when* a model was
 * cut, and the catalogue carries the plain id beside it for all but a few.
 */
const SNAPSHOT = /-(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|\d{2}-\d{2}|\d{8}|\d{6}|\d{4})$/;

/**
 * ── LATEST OF EACH MODEL ──────────────────────
 *
 * "Latest of each model, not biggest" — and the "not biggest" half is the
 * load-bearing one. `openai/gpt-5.4-pro` is 30/180 per million; an admin who
 * picks the newest FLAGSHIP for an assistant that runs on every mail poll has
 * repriced the org by thirty times without being shown a number. So this
 * ranks by recency within a family and says nothing about size.
 *
 * A FAMILY is the id with its version numbers blanked: `openai/gpt-5.6-luna`
 * and `openai/gpt-5.4-luna` are one family, `-luna` and `-terra` are two.
 * Within a family the highest version wins, and the plain id beats a dated
 * snapshot of itself.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is decide that a family is obsolete.
 * `o4-mini` and `llama-3.3-70b` survive as the latest of theirs even though
 * OpenAI and Meta have both moved on, because the only rule that would cut
 * them ("the vendor has a newer generation") also cuts `qwen3-coder-next`,
 * which is current and distinct. Listing a superseded family is a small
 * cost now that every row states its price and context window — an admin can
 * see 16k and $0.50 and draw the obvious conclusion. Guessing wrong about
 * which families are dead is the larger cost, and it is the failure this
 * file already records twice.
 *
 * Version comparison is DECIMAL, not semver: `grok-4.5` beats `grok-4.20`.
 * Segment-wise integer comparison ranks 4.20 above 4.5 and would have hidden
 * xAI's current model behind an April-20 joke release. These are marketing
 * version numbers and they are read the way they are printed.
 */
function versionOf(id: string): number[] {
  let stem = id;
  const snapshots: number[] = [];
  // strip qualifier tails until nothing more comes off — `-preview` and a
  // date can both be present (`gemini-2.5-pro-preview-05-06`)
  for (;;) {
    const before = stem;
    stem = stem.replace(/-preview$/, "");
    const dated = stem.match(SNAPSHOT);
    if (dated) {
      snapshots.push(Number(dated[1]!.replace(/-/g, "")));
      stem = stem.slice(0, dated.index);
    }
    if (stem === before) break;
  }
  return [
    ...(stem.match(/\d+(?:\.\d+)*/g) ?? []).map(Number),
    // a PLAIN id outranks a dated cut of itself: `openai/gpt-4o` over
    // `openai/gpt-4o-2024-11-20`. The plain id is the vendor's own pointer at
    // the family and the one a person recognises.
    snapshots.length === 0 ? 1 : 0,
    ...snapshots,
    // and a shipped id outranks a preview of the same version
    id.endsWith("-preview") ? 0 : 1,
  ];
}

/** The family key: the id with every version number blanked out. */
function familyOf(id: string): string {
  let stem = id;
  for (;;) {
    const before = stem;
    stem = stem.replace(/-preview$/, "").replace(SNAPSHOT, "");
    if (stem === before) break;
  }
  return stem.replace(/\d+(?:\.\d+)*/g, "#");
}

function newerVersion(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? -1) - (b[i] ?? -1);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * Keep the latest of each family, plus everything `keep` names.
 *
 * ── NOT ON A LIVE PATH SINCE 2026-09-18, and said rather than implied ──────
 * `curation()` was its only caller, and the product now offers three
 * hand-written ids: there is nothing left for a family collapse to choose
 * between, and a hand-written list cannot contain two cuts of one model
 * unless somebody put them both there on purpose. It is kept, with tests
 * that assert it DIRECTLY rather than through a screen, because the day the
 * offer list widens past a handful this is the reasoning that stops the
 * admin dialog filling with four dated cuts of one model — and re-deriving
 * it from git is a worse deal than a paragraph saying plainly that it is
 * idle. `isNotAModel` below is in the same position, with one live
 * consumer: the guard that asserts no offered id is a routing plan.
 *
 * `keep` is not a convenience — it is what stops this filter from breaking
 * the screen it serves. The curation view is ALSO the table an admin removes
 * a model from, so a filter that hides an allowed model takes away the only
 * control for un-allowing it: the org would be running a model it could no
 * longer see, let alone stop. The suggested shelf is kept for the milder
 * version of the same problem — a lineup naming a model the list omits is
 * two screens disagreeing about one org.
 */
export function latestOfEachFamily<T extends { id: string }>(
  models: T[], keep: (id: string) => boolean,
): T[] {
  const best = new Map<string, { model: T; version: number[] }>();
  for (const model of models) {
    if (isNotAModel(model.id)) continue;
    const family = familyOf(model.id);
    const version = versionOf(model.id);
    const held = best.get(family);
    if (!held || newerVersion(version, held.version)) best.set(family, { model, version });
  }
  const chosen = new Set([...best.values()].map((entry) => entry.model.id));
  return models.filter((m) => chosen.has(m.id) || keep(m.id));
}

/** A stored preference the product will not serve is not a preference. */
function servablePreference(id: string | null): string | null {
  return id !== null && !isServable(id) ? null : id;
}

/**
 * THE LADDER, with the product rule applied at every rung.
 *
 * M5's ladder (the person's choice → the org's first allowed → the env
 * fallback) was written out FOUR separate times in the worker — summarizer,
 * workflow executor, mail poller, meeting prep — and not one of them asked
 * whether the model was allowed. `assertAskable` guards the API path only,
 * so a background run would happily route to a barred model on nothing more
 * than a stale row: the no-Claude rule was never true for anything that ran
 * without a person watching.
 *
 * A rung naming a barred model is a rung that is not there. That includes
 * the env fallback — a misconfigured WORKER_SUMMARY_MODEL is exactly the
 * kind of thing that would otherwise serve one silently forever.
 *
 * Since 2026-09-18 a rung naming a model the product no longer OFFERS is
 * equally absent, for the same reason. `inForce` above says what happens
 * when a whole org's allow-list lands in that state.
 */
export function firstServable(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "" && isServable(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** The offer list's own order first, then everything else unchanged. */
function bySuggestion<T extends { id: string }>(models: T[]): T[] {
  const rank = (id: string): number => {
    const at = OFFERED_MODELS.indexOf(id);
    return at === -1 ? OFFERED_MODELS.length : at;
  };
  // A STABLE sort: models outside the offer list keep catalogue order
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
     * the offer list only, deliberately no capability probe: this runs on
     * every ask, and refusing a legitimate model during a capability-check
     * outage would take conversations down for someone else's downtime.
     *
     * The two refusals stay distinct because they are different facts about
     * the caller's id: "we have never heard of this" and "we have heard of
     * it and do not serve it" send a person to different places.
     */
    assertAskable(modelId: string): void {
      if (!catalogue().some((m) => m.id === modelId)) {
        throw new ValidationError(`unknown model: ${modelId}`);
      }
      if (!isServable(modelId)) {
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

      const allowed = inForce(row.allowed_models ?? []);
      const curated = allowed.length > 0;
      const all = catalogue();
      // Empty allow-list = admin has not curated = everything the product
      // offers (db/0002's comment). NOT "nothing is allowed" — that reading
      // would leave every new org unable to pick a model at all.
      // The product's own rules apply FIRST and unconditionally: an admin's
      // allow-list cannot re-admit a barred provider or a model this product
      // does not offer, and neither can the capability filter passing one
      // through. A rule that any later filter could undo is not a rule.
      const offered = all.filter((m) => isServable(m.id));
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
        selected: m.id === servablePreference(row.preferred_model),
        ...(capability.known ? { tools: capability.toolCapable.has(m.id) } : {}),
      }));

      return {
        models,
        /* the SAME rule the ask applies (see `preferred` below): a stored
           model the product will not serve is not a preference. Reporting it
           here while the ask ignores it would be two readers disagreeing
           about one fact — the picker would show a choice that silently is
           not in force. */
        preferred_model: servablePreference(row.preferred_model),
        curated,
        tool_capability_filtered: capability.known,
        ...(capability.stale === true ? { tool_capability_stale: true } : {}),
      };
    },

    /**
     * The CURATION view (Part 3): everything the product offers with a flag
     * per model, for the admin allow-list screen. Distinct from `list()` on
     * purpose — the picker serves what a member may USE (allow-list applied),
     * the curation serves what an admin may PERMIT (allow-list rendered, not
     * applied). The product's rules still apply FIRST: a barred provider and
     * an unoffered model are not offered even as a checkbox, because a rule
     * any later filter can undo is not a rule.
     *
     * The `suggested` and `recommended` flags left this wire on 2026-09-18
     * with the two lists that fed them. Both would now be true of every row
     * — the offer list IS the catalogue here — and a flag true of every row
     * is a flag that says nothing, so the admin table lost the chip and the
     * add dialog lost the shelf-versus-search split it needed when there
     * were three hundred candidates to sort through.
     *
     * Tool capability is a MARKER here, never a filter: an admin allowing a
     * tool-incapable model should see why members won't be offered it,
     * rather than watching a checked box produce nothing.
     */
    async curation(identity: Identity): Promise<{
      models: {
        id: string; name: string; allowed: boolean; tools?: boolean;
        cost?: { input: number; output: number }; contextWindow?: number;
      }[];
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
      const allowed = inForce(row.allowed_models ?? []);
      const curated = allowed.length > 0;
      /*
       * An org whose allow-list still names a model the product no longer
       * offers does NOT get a row for it here, and that is deliberate: the
       * page writes the WHOLE array from the rows it can see, so the first
       * toggle an admin makes drops the stale ids rather than carrying them
       * forward invisibly. Until then those ids are already inert — `list()`
       * and `forRun` both refuse them — so the row would be a control for
       * removing something that is not doing anything.
       */
      const offered = catalogue().filter((m) => isServable(m.id));
      const capability = await capabilityOf();
      return {
        models: bySuggestion(offered).map((m) => ({
          id: m.id,
          name: m.name,
          /* the two facts that make a row answerable. Passed through rather
             than formatted: "$1.75 / $14 per M" is a decision about language
             and locale, and this is the wire. */
          ...(m.cost ? { cost: m.cost } : {}),
          ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
          allowed: !curated || allowed.includes(m.id),
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
      const stored = rows[0]?.preferred_model ?? null;
      /**
       * A stored preference for a BARRED model is a dangling pointer, and
       * reading it as a preference breaks every run the person makes.
       *
       * This was decided the other way once, on the argument that "a legacy
       * preference stored before the exclusion existed is as refused as a
       * typed one" — a refusal that names the model beats a vague one. That
       * argument is right about the CALLER NAMING a model and wrong here:
       * `assertAskable` still refuses `body.model` by name, but nobody typed
       * this one. The first real member had `~anthropic/claude-opus-latest`
       * saved from when the catalogue offered it, and the consequence was
       * not a clear message — it was the workflow run in their thread ending
       * on "model is not available on this product" with no answer, every
       * time, until someone thought to open a settings page.
       *
       * So the ladder does what a ladder is for: this rung is missing, take
       * the next one. What the person chose is untouched in the row, and the
       * moment the product serves that model again it takes effect.
       */
      return servablePreference(stored);
    },

    /**
     * THE MODEL A RUN NOBODY TYPED A MODEL FOR USES — M5's ladder from the
     * api side: the person's servable preference, else the org's first
     * permitted model, else the first the catalogue offers (tool-capable
     * where that is known, since a run with tools is what asks).
     *
     * Exists because the ROOM answered only people who had once opened the
     * model picker (user report, 2026-09-05: a colleague named @roya and
     * @echo and neither answered him). `answerIfNamed` read `preferred()`
     * alone and treated null as "no model" — an `agent_failed` on the stream,
     * nothing in the log, and every member who never saved a preference was
     * silently unanswerable. The four workers already walk this ladder
     * (mail-poll, meeting-prep, summarizer, workflow-step); the api's
     * unattended path now walks the same one rather than a shorter copy.
     */
    async forRun(identity: Identity): Promise<string | null> {
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
      const row = rows[0];
      if (!row) return null;
      const allowed = inForce(row.allowed_models ?? []);
      const offered = catalogue().filter((m) => isServable(m.id));
      const permitted = allowed.length > 0 ? offered.filter((m) => allowed.includes(m.id)) : offered;
      const capability = await capabilityOf();
      const usable = capability.known ? permitted.filter((m) => capability.toolCapable.has(m.id)) : permitted;
      return firstServable(row.preferred_model, allowed[0], bySuggestion(usable)[0]?.id);
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
        if (!isServable(modelId)) {
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
