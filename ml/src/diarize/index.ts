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

/**
 * Test seam, the shape `setLanes` already has for the STT lanes: the pipeline
 * now PREFERS the local diarizer over a lane's own labels (2026-09-10), and
 * that preference is a rule worth a test that does not depend on two ONNX
 * models being present on the machine running it.
 */
export function setDiarizer(engine: Diarizer | null): void {
  cached = engine;
}

export type { Diarizer, DiarSegment } from "./types.js";
export { assignSpeakers } from "./types.js";
