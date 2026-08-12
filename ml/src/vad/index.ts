import { config } from "../config.js";
import { logger } from "../log.js";
import { EnergyVad } from "./energy.js";
import { SileroVad } from "./silero.js";
import type { VadEngine } from "./types.js";

let engine: VadEngine | undefined;

/**
 * One engine per process. Silero when its model is configured and loads;
 * otherwise the energy gate, loudly, once. A missing model degrades the
 * silence trimming — it never fails a job.
 */
export async function vadEngine(): Promise<VadEngine> {
  if (engine) return engine;

  const modelPath = config().ML_SILERO_MODEL;
  if (modelPath) {
    try {
      engine = await SileroVad.load(modelPath);
      logger.info({ engine: engine.name }, "vad engine ready");
      return engine;
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "silero model failed to load; falling back to energy VAD");
    }
  } else {
    logger.warn("ML_SILERO_MODEL unset; using the energy VAD fallback");
  }

  engine = new EnergyVad();
  return engine;
}

export function resetVadEngine(): void {
  engine = undefined;
}

export type { VadEngine } from "./types.js";
