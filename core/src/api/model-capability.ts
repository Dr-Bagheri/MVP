/**
 * Which models can actually call tools (M5 / SPEC: "models that cannot call
 * tools are not selectable").
 *
 * `builtinModels()` does not carry the fact — id, name, api, baseUrl,
 * provider, reasoning, input, cost, contextWindow, maxTokens, compat, and
 * nothing about tools. OpenRouter's public catalogue does:
 * `supported_parameters` includes `"tools"` for 342 of its 410 models. So the
 * filter can be enforced from real metadata rather than from a heuristic,
 * which is what the steward asked for.
 *
 * ── The one place I have deviated from the ruling, deliberately ─────────────
 *
 * "Unknown treated as not-tool-capable, fail closed for selectability" is
 * right for a model we *checked* and could not confirm. Applied literally to
 * a FETCH FAILURE it empties the picker: OpenRouter has a blip, and every
 * user is told there are no models they may use — a false statement about
 * their account, produced by someone else's outage.
 *
 * So the two are distinguished (rule 12, "the kinds of nothing"):
 *
 *   checked, not tool-capable  → filtered out. Fail closed, as ruled.
 *   checked, tool-capable      → offered.
 *   COULD NOT CHECK            → nothing is filtered, and the response says
 *                                `tool_capability_filtered: false` so no
 *                                consumer claims a filter was applied.
 *
 * An unfiltered list labelled unfiltered is honest. An empty list implying
 * "you have no models" is not, and it is the failure the user cannot diagnose.
 * Flagged to the steward as a deviation rather than taken silently.
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Long enough that a picker render never waits on it. */
const REFRESH_MS = 60 * 60 * 1000;
/** A model picker must not hang on someone else's outage. */
const FETCH_TIMEOUT_MS = 4_000;

/**
 * What the provider says a model COSTS and how much it holds, today.
 *
 * The bundled catalogue carries both, and both go stale: measured
 * 2026-09-18, the snapshot billed `google/gemini-3.6-flash` at 1.5/7.5 per
 * million against a live 0.75/3.75, and `z-ai/glm-5.2` at 0.69/2.169 against
 * 0.554/1.742. That was tolerable while the admin screen listed hundreds and
 * the price was context; with three rows the price IS the comparison, and a
 * cost lever whose numbers are double is worse than one with no numbers.
 *
 * It rides on this lookup rather than getting a fetch of its own because the
 * response it comes from is already being fetched, three fields over. A
 * second call would be a second thing to fail, cache and reason about — and
 * two readers of one provider answer are how they come to disagree.
 */
export interface ModelFacts {
  cost?: { input: number; output: number };
  contextWindow?: number;
}

export interface CapabilityMap {
  /** Model ids known to accept `tools`. Empty when the lookup failed. */
  toolCapable: ReadonlySet<string>;
  /**
   * Price and context window per id, from the SAME successful fetch. Empty
   * when the lookup failed, and a missing entry means "the provider did not
   * state it" — the caller falls back to the bundled snapshot rather than
   * rendering a model as free.
   */
  facts: ReadonlyMap<string, ModelFacts>;
  /** False when the catalogue could not be read — NOT "nothing qualified". */
  known: boolean;
  /**
   * True when this answer came from a PREVIOUS successful fetch because the
   * current one failed. Still `known: true` — it is checked data, just not
   * fresh, and stale-but-checked beats unchecked (steward tightening).
   */
  stale?: boolean;
}

const UNKNOWN: CapabilityMap = { toolCapable: new Set(), facts: new Map(), known: false };

interface Cache { value: CapabilityMap; fetchedAt: number }
let cache: Cache | undefined;

/**
 * The last map we successfully fetched, kept indefinitely and separately from
 * the TTL cache.
 *
 * Model capabilities change on the order of weeks; an outage lasts minutes.
 * Serving yesterday's answer through today's outage is strictly better than
 * serving no answer, and it shrinks the unfiltered-list window to exactly one
 * case: a cold start that coincides with the catalogue being unreachable.
 * That is the only situation in which a user should ever see an unfiltered
 * list, which is what makes the honest `false` label rare enough to mean
 * something when it does appear.
 */
let lastGood: CapabilityMap | undefined;

export interface CapabilityOptions {
  fetchImpl?: typeof fetch | undefined;
  /** Milliseconds since epoch; injected so tests never depend on wall time. */
  now?: number | undefined;
}

/**
 * Tool capability per model id, cached.
 *
 * Never throws: a failure here must degrade the picker's *labelling*, not
 * break the request. The caller distinguishes the outcomes through `known`.
 */
export async function toolCapability(options: CapabilityOptions = {}): Promise<CapabilityMap> {
  const now = options.now ?? Date.now();
  if (cache && now - cache.fetchedAt < REFRESH_MS) return cache.value;

  const doFetch = options.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT_MS);
    let payload: {
      data?: {
        id?: unknown; supported_parameters?: unknown;
        pricing?: { prompt?: unknown; completion?: unknown };
        context_length?: unknown;
      }[];
    };
    try {
      const response = await doFetch(OPENROUTER_MODELS_URL, { signal: controller.signal });
      if (!response.ok) return failed(now);
      payload = (await response.json()) as typeof payload;
    } finally {
      clearTimeout(timer);
    }

    const toolCapable = new Set<string>();
    const facts = new Map<string, ModelFacts>();
    for (const model of payload.data ?? []) {
      if (typeof model?.id !== "string") continue;
      const params = model.supported_parameters;
      if (Array.isArray(params) && params.includes("tools")) toolCapable.add(model.id);
      const fact = factsOf(model);
      if (fact) facts.set(model.id, fact);
    }
    // An empty set from a SUCCESSFUL fetch would mean the shape changed —
    // `supported_parameters` renamed, say. Treating that as "no model can
    // call tools" would empty every picker and look like a product decision,
    // so it is treated as not-known instead.
    if (toolCapable.size === 0) return failed(now);

    const value: CapabilityMap = { toolCapable, facts, known: true };
    cache = { value, fetchedAt: now };
    lastGood = value;
    return value;
  } catch {
    return failed(now);
  }
}

/**
 * OpenRouter states prices PER TOKEN, as decimal strings ("0.00000075"), and
 * every screen in this product talks in dollars per million. The conversion
 * lives here, once, beside the parse — a caller doing it would be a second
 * place for a factor of a million to be wrong, and this file already records
 * what a factor-of-1000 mistake looks like on a screen (a 30-minute part
 * rendering as 1.8 seconds: "a number that looks like data, not an error").
 *
 * A price of 0 is REAL — some models are free — so it is passed through; what
 * is dropped is a field the provider did not state or stated unparseably,
 * because "we do not know what this costs" and "this costs nothing" are
 * different facts and on a price the second is the expensive way to be wrong.
 */
function factsOf(model: {
  pricing?: { prompt?: unknown; completion?: unknown };
  context_length?: unknown;
}): ModelFacts | null {
  const perMillion = (raw: unknown): number | null => {
    const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
    return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : null;
  };
  const input = perMillion(model.pricing?.prompt);
  const output = perMillion(model.pricing?.completion);
  const facts: ModelFacts = {
    ...(input !== null && output !== null ? { cost: { input, output } } : {}),
    ...(typeof model.context_length === "number" && model.context_length > 0
      ? { contextWindow: model.context_length }
      : {}),
  };
  return facts.cost || facts.contextWindow !== undefined ? facts : null;
}

function failed(now: number): CapabilityMap {
  // Serve the last CHECKED answer if we have one. It is not fresh, and it
  // says so — but "these 342 models accepted tools an hour ago" is real
  // information, while an unfiltered list is the absence of any.
  const value: CapabilityMap = lastGood
    ? { ...lastGood, stale: true }
    : UNKNOWN;
  // Short-cached so an outage doesn't cost a 4s timeout on every request,
  // while still retrying long before the hour is up.
  cache = { value, fetchedAt: now - REFRESH_MS + 60_000 };
  return value;
}

/** Test seam only — module-level state would otherwise leak between tests. */
export function resetCapabilityCache(): void {
  cache = undefined;
  lastGood = undefined;
}
