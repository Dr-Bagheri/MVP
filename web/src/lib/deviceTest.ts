"use client";

/**
 * The speaker test chime, extracted from DeviceCheck (2026-08-26) so the
 * speaker DROPDOWN can play the same sound from its own footer — one chime,
 * not two spellings of one chime.
 *
 * A soft two-tone through the CHOSEN output (setSinkId where the browser
 * has it), at a volume that is never a shock. Everything it opens, it
 * closes on a timer — a test tone must not hold an AudioContext.
 */
export async function playTestChime(sinkId: string, volume = 0.7): Promise<void> {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const gainNode = ctx.createGain();
  gainNode.gain.value = volume * 0.35;
  gainNode.connect(dest);
  const play = (freq: number, at: number) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    env.gain.exponentialRampToValueAtTime(1, ctx.currentTime + at + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
    osc.connect(env).connect(gainNode);
    osc.start(ctx.currentTime + at);
    osc.stop(ctx.currentTime + at + 0.32);
  };
  play(660, 0);
  play(880, 0.22);
  const el = new Audio();
  el.srcObject = dest.stream;
  el.volume = 1;
  const withSink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (sinkId && typeof withSink.setSinkId === "function") {
    await withSink.setSinkId(sinkId).catch(() => undefined);
  }
  await el.play().catch(() => undefined);
  setTimeout(() => {
    el.pause();
    el.srcObject = null;
    void ctx.close().catch(() => undefined);
  }, 900);
}
