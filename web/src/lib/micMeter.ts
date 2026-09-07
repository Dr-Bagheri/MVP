"use client";

/**
 * THE MICROPHONE'S OWN EVIDENCE (user report, 2026-09-07: "the enrolment
 * voice detection part of the platform does not work — i did 2 samples in it
 * and never it realise i am talking to it").
 *
 * Voice enrolment recorded for up to ninety seconds behind a seconds counter
 * and nothing else. A person reading the passage had no way to tell a working
 * microphone from a muted one, the wrong input device, or a browser that had
 * granted the permission to a headset nobody was wearing — and the far end
 * could not tell them either: ml/'s `/embed` reported the CLIP'S DURATION as
 * `speech_ms`, so a silent take was accepted, embedded into a near-constant
 * "silence" vector, and stored as that person's signature. Both halves are
 * fixed; this is the half that speaks while there is still time to fix it.
 *
 * Deliberately NOT the recording engine's meter: that one lives on a
 * module-level singleton because a take must survive navigation, and an
 * enrolment take must not — it belongs to a panel that closes. Same
 * arithmetic, one owner each.
 */

/**
 * THE DECISION IS MADE ON THE RAW RMS, NOT ON THE BAR'S CURVE.
 *
 * The first draft put the floor on the display value and its own test caught
 * it: the curve below is deliberately aggressive at the bottom so a bar reads
 * well, and it turns ONE least-significant bit of a silent capture — the
 * quantisation noise of a muted microphone — into 0.12 of a full bar. A floor
 * there would have been a floor on the cosmetics.
 *
 * 0.02 of raw RMS sits above that noise (~0.008) and well below any real
 * speech (0.05 and up at arm's length). It errs PERMISSIVE on purpose: ml/'s
 * VAD is the wall that refuses a clip with no voice in it, and this gate only
 * has to catch the microphone that is plainly dead — being wrong here costs a
 * person a needless "check your microphone", and being wrong the other way
 * costs them a round trip to a refusal that says the same thing.
 */
export const HEARD_RMS_FLOOR = 0.02;

/**
 * How much sound has to arrive before the take counts as heard. Short enough
 * that a person reading a passage clears it in their first breath, long
 * enough that one door slam does not.
 */
export const HEARD_MS_FLOOR = 800;

export interface MicMeterState {
  /** 0..1 for the bar — zero below the floor, so a dead microphone draws nothing */
  level: number;
  /** milliseconds of sound above the floor, over the whole take */
  heardMs: number;
}

/** the take carried sound — not "carried speech", which only ml/ can say */
export function wasHeard(heardMs: number): boolean {
  return heardMs >= HEARD_MS_FLOOR;
}

/**
 * The RMS of one analyser frame, 0..1 — the MEASUREMENT.
 *
 * Byte time-domain data is centred on 128, so each sample is offset from the
 * middle rather than from zero.
 */
export function frameRms(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const centered = ((data[i] ?? 128) - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

/**
 * What the BAR draws. Speech sits low as a raw RMS, so the square root
 * spreads it across a bar a person can read — the recorder's own curve. Below
 * the floor it draws nothing at all, because a bar twitching over a
 * microphone that is delivering nothing is the false reassurance this whole
 * module exists to remove.
 */
export function frameLevel(data: Uint8Array): number {
  const rms = frameRms(data);
  if (rms < HEARD_RMS_FLOOR) return 0;
  return Math.min(1, Math.sqrt(rms) * 1.4);
}

/**
 * Watch a live stream and report its level. Returns the stopper; calling it
 * releases the audio graph but NOT the stream — the caller opened it and the
 * caller closes it, because the recorder is using the same one.
 *
 * `onTick` is called about twelve times a second with the running state, so
 * a component can render a bar and decide, at the end, whether anything was
 * ever heard.
 */
export function startMicMeter(
  stream: MediaStream,
  onTick: (state: MicMeterState) => void,
): () => void {
  const Ctor: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) {
    /* no meter is a legitimate state on a browser without WebAudio, and it
       must not read as "we heard nothing": the caller is handed Infinity, so
       the refusal never fires on somebody whose take is fine and whose
       browser simply has no analyser to offer */
    onTick({ level: 0, heardMs: Number.POSITIVE_INFINITY });
    return () => undefined;
  }

  const ctx = new Ctor();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  const state: MicMeterState = { level: 0, heardMs: 0 };
  let last = 0;
  let raf = 0;
  let stopped = false;

  const loop = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (now - last < 80) return; // ~12fps is plenty for a meter
    const elapsed = last === 0 ? 0 : now - last;
    last = now;
    analyser.getByteTimeDomainData(data);
    state.level = frameLevel(data);
    if (state.level > 0) state.heardMs += elapsed;
    onTick({ ...state });
  };
  raf = requestAnimationFrame(loop);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close().catch(() => undefined);
  };
}
