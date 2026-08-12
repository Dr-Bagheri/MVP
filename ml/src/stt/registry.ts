import { config } from "../config.js";
import { MlError } from "../errors.js";
import type { JobLog } from "../log.js";
import { OpenRouterLane } from "./openrouter.js";
import { SonioxLane } from "./soniox.js";
import type { SttInput, SttLane, SttResult } from "./types.js";

export interface Attempt {
  lane: string;
  ok: boolean;
  ms: number;
  error_type: string | null;
}

export interface LaneOutcome {
  result: SttResult;
  lane: string;
  attempts: Attempt[];
}

let registry: Map<string, SttLane> | undefined;

export function lanes(): Map<string, SttLane> {
  registry ??= new Map<string, SttLane>([
    ["soniox", new SonioxLane()],
    ["openrouter", new OpenRouterLane()],
  ]);
  return registry;
}

/** Test seam: swap the registry for stubs. */
export function setLanes(next: Map<string, SttLane>): void {
  registry = next;
}

export function resetLanes(): void {
  registry = undefined;
}

/** Which lanes exist, and whether each has a key. Never says if a key is valid. */
export function laneStatus(): Record<string, "configured" | "unconfigured"> {
  const out: Record<string, "configured" | "unconfigured"> = {};
  for (const [name, lane] of lanes()) out[name] = lane.configured() ? "configured" : "unconfigured";
  return out;
}

/**
 * Try lanes in policy order until one produces a transcript. Every attempt is
 * recorded — a fallback that silently happened is a fallback nobody fixes.
 */
export async function transcribe(input: SttInput, log: JobLog, pinned: string | null): Promise<LaneOutcome> {
  const all = lanes();
  const order = pinned ? [pinned] : config().ML_LANE_ORDER;

  const usable = order.map((n) => all.get(n)).filter((l): l is SttLane => Boolean(l) && l!.configured());
  if (usable.length === 0) {
    throw new MlError("stt_unavailable", pinned ? `lane '${pinned}' is not available` : "no STT lane is configured");
  }

  const attempts: Attempt[] = [];
  let last: unknown;

  for (const lane of usable) {
    const started = Date.now();
    try {
      const result = await lane.transcribe(input);
      attempts.push({ lane: lane.name, ok: true, ms: Date.now() - started, error_type: null });
      log.info({ step: "stt", lane: lane.name, ms: Date.now() - started, words: result.words.length }, "stt ok");
      return { result, lane: lane.name, attempts };
    } catch (e) {
      last = e;
      const type = e instanceof MlError ? e.type : "internal";
      attempts.push({ lane: lane.name, ok: false, ms: Date.now() - started, error_type: type });
      log.warn({ step: "stt", lane: lane.name, error_type: type }, "stt lane failed; trying the next");
    }
  }

  throw new MlError("stt_failed", "every STT lane failed", {
    cause: last,
    detail: { attempts },
  });
}
