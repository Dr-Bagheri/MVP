/**
 * GENERATED — do not hand-edit.
 *
 * Written by core/scripts/demo-audio-build.mjs from the English pack's own
 * dialogue. Every number here is a MEASUREMENT of speech that exists: the
 * generator synthesises each line with Soniox Text-to-Speech (tts-rt-v2),
 * normalises it to 16 kHz mono 16-bit PCM, measures it twice (ffprobe's
 * duration and the PCM byte count must agree), splices the lines with a
 * 700 ms gap, and records where each one landed. Those are the timings the
 * transcript seeks to, so a hand-edit here is a click that lands on the
 * wrong sentence.
 *
 * The bytes themselves ship in the repository under core/assets/demo-audio/en/
 * <record>.wav and are cached in Storage under `_demo/en/<record>/part-N.wav`
 * by the first seed on a deployment (the sha256 here is what that seed
 * checks the bundled file against before uploading it); every seed then
 * COPIES the cached object into the organisation. Re-run the generator only
 * when the dialogue or the voices change.
 */

import type { DemoAudio, DemoRecordKey } from "./pack.ts";

export const AUDIO_EN: Record<DemoRecordKey, DemoAudio> = {
  prior: {
    totalMs: 203146,
    parts: [
      { idx: 0, offsetMs: 0, durationMs: 203146, byteSize: 6500718, sha256: "3d079d91193e44078997df23e500c78099ea439423ff7ee15e1e4745f356186a" },
    ],
    lines: [
      { startMs: 600, endMs: 7597, partIdx: 0 },
      { startMs: 8297, endMs: 14441, partIdx: 0 },
      { startMs: 15141, endMs: 21882, partIdx: 0 },
      { startMs: 22582, endMs: 26507, partIdx: 0 },
      { startMs: 27207, endMs: 32668, partIdx: 0 },
      { startMs: 33368, endMs: 40024, partIdx: 0 },
      { startMs: 40724, endMs: 49599, partIdx: 0 },
      { startMs: 50299, endMs: 58320, partIdx: 0 },
      { startMs: 59020, endMs: 66785, partIdx: 0 },
      { startMs: 67485, endMs: 76274, partIdx: 0 },
      { startMs: 76974, endMs: 84483, partIdx: 0 },
      { startMs: 85183, endMs: 91924, partIdx: 0 },
      { startMs: 92624, endMs: 98683, partIdx: 0 },
      { startMs: 99383, endMs: 107063, partIdx: 0 },
      { startMs: 107763, endMs: 115016, partIdx: 0 },
      { startMs: 115716, endMs: 121775, partIdx: 0 },
      { startMs: 122475, endMs: 127936, partIdx: 0 },
      { startMs: 128636, endMs: 134524, partIdx: 0 },
      { startMs: 135224, endMs: 139917, partIdx: 0 },
      { startMs: 140617, endMs: 145054, partIdx: 0 },
      { startMs: 145754, endMs: 152495, partIdx: 0 },
      { startMs: 153195, endMs: 157803, partIdx: 0 },
      { startMs: 158503, endMs: 166098, partIdx: 0 },
      { startMs: 166798, endMs: 168846, partIdx: 0 },
      { startMs: 169546, endMs: 175349, partIdx: 0 },
      { startMs: 176049, endMs: 189617, partIdx: 0 },
      { startMs: 190317, endMs: 194925, partIdx: 0 },
      { startMs: 195625, endMs: 199209, partIdx: 0 },
      { startMs: 199909, endMs: 202042, partIdx: 0 },
    ],
  },
  pricing: {
    totalMs: 121753,
    parts: [
      { idx: 0, offsetMs: 0, durationMs: 121753, byteSize: 3896124, sha256: "fc0dc63c02ddd1c144ed83ad60e3ccb226ff85abf0ac439bbf8d89d8651a4f18" },
    ],
    lines: [
      { startMs: 600, endMs: 5037, partIdx: 0 },
      { startMs: 5737, endMs: 9492, partIdx: 0 },
      { startMs: 10192, endMs: 17445, partIdx: 0 },
      { startMs: 18145, endMs: 24118, partIdx: 0 },
      { startMs: 24818, endMs: 25671, partIdx: 0 },
      { startMs: 26371, endMs: 36014, partIdx: 0 },
      { startMs: 36714, endMs: 39359, partIdx: 0 },
      { startMs: 40059, endMs: 48080, partIdx: 0 },
      { startMs: 48780, endMs: 51767, partIdx: 0 },
      { startMs: 52467, endMs: 57331, partIdx: 0 },
      { startMs: 58031, endMs: 66052, partIdx: 0 },
      { startMs: 66752, endMs: 73152, partIdx: 0 },
      { startMs: 73852, endMs: 77607, partIdx: 0 },
      { startMs: 78307, endMs: 86243, partIdx: 0 },
      { startMs: 86943, endMs: 91892, partIdx: 0 },
      { startMs: 92592, endMs: 97541, partIdx: 0 },
      { startMs: 98241, endMs: 102849, partIdx: 0 },
      { startMs: 103549, endMs: 110546, partIdx: 0 },
      { startMs: 111246, endMs: 116110, partIdx: 0 },
      { startMs: 116810, endMs: 120650, partIdx: 0 },
    ],
  },
};
