/**
 * Float32 PCM → a 16-bit mono WAV blob.
 *
 * The voice matcher's snippet leaves the browser as a WAV because that is
 * the one container this pipeline can produce from raw samples without a
 * codec: ml/ normalises whatever arrives to mono 16 kHz anyway, so the job
 * here is only to hand it something with a header it can read.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);          // PCM header size
  view.setUint16(20, 1, true);           // format: PCM
  view.setUint16(22, 1, true);           // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let at = 44;
  for (let i = 0; i < samples.length; i += 1) {
    // clamp before scaling: a sample above 1 wraps to full negative
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    at += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}
