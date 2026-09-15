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
  /*
   * Re-picked 2026-09-09.
   *
   * The previous five were set on 2026-08-16 and never revisited. By now
   * `openai/gpt-5.2` (1.75/14 per M) sat at rank 2 while `openai/gpt-5.6-terra`
   * — a later model, pi-verified, 1.05M context — costs 1/6, and the head of
   * the list was a PREVIEW id at 2/12. `meta-llama/llama-4-scout` has no
   * reasoning and is not on any current tool-calling ranking; it was the
   * cheap rung and it is the wrong one.
   *
   * What the picks are grounded in, so a later reader can re-check rather
   * than re-guess:
   *  - OpenRouter's tool-calling collection ranking (weekly real usage),
   *  - Pi's own release notes: the gpt-5.6 family carries verified metadata
   *    and thinking levels; Pi's tiny system prompt makes it model-agnostic,
   *    so raw tool-calling reliability is what matters, not harness tuning,
   *  - price and context from the bundled catalogue itself.
   *
   * Anthropic is barred by product rule, so the models most rankings put at
   * the very top are simply not candidates here — see EXCLUDED_PROVIDERS.
   *
   * Still a JUDGEMENT, not a measurement: nothing here was benchmarked by us.
   * The liveness seam named below (per-model `agent_run` errors as reputation)
   * is still the real fix.
   */
  // flagship agentic: 1M context, verified thinking levels, half gpt-5.2's price
  "openai/gpt-5.6-terra",
  // top of OpenRouter's tool-calling list for long-horizon agents; 1M context
  "z-ai/glm-5.2",
  // 1M context, lowest observed hallucination, a fifth of the flagship's cost
  "deepseek/deepseek-v4-pro",
  // the Google rung, now the current one rather than a preview id
  "google/gemini-3.6-flash",
  // the cheap/fast rung: 0.1/0.6 per M, and #2 on the tool-calling ranking
  "openai/gpt-5.6-luna",
];

/**
 * THE PICKER'S ORDER, and the shortlist the "add a model" dialog opens on.
 *
 * `SUGGESTED_MODELS` is the org's lineup — five, chipped as such. This is the
 * wider ranked shelf, and it exists because the ADD dialog was ordering the
 * rest of the catalogue alphabetically: an admin opening it saw
 * `ai21/jamba-large-1.7` (retired provider), three `aion-labs` and four
 * `amazon/nova` before anything they would plausibly choose. That is the same
 * failure the comment above records for the members' picker, still live one
 * dialog over — fixing one instance does not fix its siblings.
 *
 * Ordering only. Nothing is removed from the catalogue, and the dialog's
 * search still reaches every model — this decides what shows FIRST, and what
 * an empty search box shows at all.
 */
export const RECOMMENDED_MODELS: readonly string[] = [
  ...SUGGESTED_MODELS,
  "openai/gpt-5.6-sol",
  "x-ai/grok-4.5",
  "moonshotai/kimi-k2.6",
  "deepseek/deepseek-v4-flash",
  "google/gemini-3.5-flash",
  "qwen/qwen3.7-max",
  "minimax/minimax-m3",
  "z-ai/glm-5.1",
  "openai/gpt-5.4",
  "moonshotai/kimi-k3",
  "qwen/qwen3.7-plus",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "tencent/hy3",
  "mistralai/mistral-large-2512",
  "minimax/minimax-m2.7",
  "x-ai/grok-4.3",
  "qwen/qwen3.6-plus",
  "openai/gpt-5.4-mini",
  "z-ai/glm-4.7",
  // the previous lineup, kept on the shelf: an org already running one of
  // these must still find it without typing the id from memory.
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5.2",
  "google/gemini-3.1-flash-lite",
  "deepseek/deepseek-v3.2",
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
const isExcluded = (id: string): boolean => {
  const normalized = id.toLowerCase().replace(/^[^a-z0-9]+/, "");
  const vendor = normalized.split("/")[0] ?? "";
  return EXCLUDED_PROVIDERS.includes(vendor) || normalized.includes("claude");
};

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

const isNotAModel = (id: string): boolean =>
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
  return id !== null && isExcluded(id) ? null : id;
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
 */
export function firstServable(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "" && !isExcluded(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Recommended first (in the order above), then everything else unchanged. */
function bySuggestion<T extends { id: string }>(models: T[]): T[] {
  const rank = (id: string): number => {
    // RECOMMENDED_MODELS opens with SUGGESTED_MODELS, so the lineup still
    // leads — the wider list only decides what comes after it, instead of
    // letting the alphabet decide.
    const at = RECOMMENDED_MODELS.indexOf(id);
    return at === -1 ? RECOMMENDED_MODELS.length : at;
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
      models: {
        id: string; name: string; allowed: boolean; suggested: boolean;
        recommended: boolean; tools?: boolean;
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
      const allowed = row.allowed_models ?? [];
      const curated = allowed.length > 0;
      /*
       * The exclusion FIRST and unconditionally, then the catalogue's own
       * noise. `latestOfEachFamily` is presentation — it decides which of
       * four cuts of one model an admin is shown — so it must never be the
       * thing that keeps a barred provider out; that is `isExcluded`'s job
       * and it runs before this line, as it does everywhere else.
       *
       * Already-allowed and shelf models survive the filter (see the
       * function's own note): an org running an old snapshot must still find
       * the row that removes it.
       */
      const offered = latestOfEachFamily(
        catalogue().filter((m) => !isExcluded(m.id)),
        (id) => allowed.includes(id) || RECOMMENDED_MODELS.includes(id),
      );
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
          suggested: SUGGESTED_MODELS.includes(m.id),
          /* the shelf flag, distinct from the chip: `suggested` is the org's
             five, `recommended` is "worth showing before the admin has typed
             anything". Served rather than re-derived in the UI so one list
             decides both the ORDER and the shortlist. */
          recommended: RECOMMENDED_MODELS.includes(m.id),
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
      const allowed = row.allowed_models ?? [];
      const offered = catalogue().filter((m) => !isExcluded(m.id));
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
