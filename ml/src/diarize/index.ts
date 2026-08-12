import { config } from "../config.js";
import { SherpaDiarizer } from "./sherpa.js";
import type { Diarizer } from "./types.js";

let cached: Diarizer | null | undefined;

/**
 * The diarizer, or null when none is usable. Null is a normal state, not an
 * error: two-channel audio never needs one, and the Soniox lane diarizes for
 * us. A local diarizer matters for mono audio on a lane that does not.
 */
export async function diarizer(): Promise<Diarizer | null> {
  if (cached !== undefined) return cached;

  if (config().ML_DIARIZER === "off") {
    cached = null;
    return cached;
  }

  const sherpa = new SherpaDiarizer();
  cached = (await sherpa.available()) ? sherpa : null;
  return cached;
}

export async function diarizerName(): Promise<string> {
  return (await diarizer())?.name ?? "unavailable";
}

export function resetDiarizer(): void {
  cached = undefined;
}

export type { Diarizer, DiarSegment } from "./types.js";
export { assignSpeakers } from "./types.js";
