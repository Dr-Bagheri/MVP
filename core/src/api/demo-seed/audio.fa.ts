/**
 * GENERATED — do not hand-edit.
 *
 * Written by core/scripts/demo-audio-build.mjs from the Persian pack's own
 * dialogue. Every number here is a MEASUREMENT of speech that exists: the
 * generator synthesises each line with Soniox Text-to-Speech (tts-rt-v2),
 * normalises it to 16 kHz mono 16-bit PCM, measures it twice (ffprobe's
 * duration and the PCM byte count must agree), splices the lines with a
 * 700 ms gap, and records where each one landed. Those are the timings the
 * transcript seeks to, so a hand-edit here is a click that lands on the
 * wrong sentence.
 *
 * The bytes themselves ship in the repository under core/assets/demo-audio/fa/
 * <record>.wav and are cached in Storage under `_demo/fa/<record>/part-N.wav`
 * by the first seed on a deployment (the sha256 here is what that seed
 * checks the bundled file against before uploading it); every seed then
 * COPIES the cached object into the organisation. Re-run the generator only
 * when the dialogue or the voices change.
 */

import type { DemoAudio, DemoRecordKey } from "./pack.ts";

export const AUDIO_FA: Record<DemoRecordKey, DemoAudio> = {
  prior: {
    totalMs: 248202,
    parts: [
      { idx: 0, offsetMs: 0, durationMs: 248202, byteSize: 7942508, sha256: "23dcbdc8465b26e23ebf13d5204765969a77f7cced41f69b452147db2bcbfcc7" },
    ],
    lines: [
      { startMs: 600, endMs: 10328, partIdx: 0 },
      { startMs: 11028, endMs: 18111, partIdx: 0 },
      { startMs: 18811, endMs: 27088, partIdx: 0 },
      { startMs: 27788, endMs: 30775, partIdx: 0 },
      { startMs: 31475, endMs: 38814, partIdx: 0 },
      { startMs: 39514, endMs: 48986, partIdx: 0 },
      { startMs: 49686, endMs: 61974, partIdx: 0 },
      { startMs: 62674, endMs: 72487, partIdx: 0 },
      { startMs: 73187, endMs: 82488, partIdx: 0 },
      { startMs: 83188, endMs: 93513, partIdx: 0 },
      { startMs: 94213, endMs: 101978, partIdx: 0 },
      { startMs: 102678, endMs: 111553, partIdx: 0 },
      { startMs: 112253, endMs: 118312, partIdx: 0 },
      { startMs: 119012, endMs: 127375, partIdx: 0 },
      { startMs: 128075, endMs: 137206, partIdx: 0 },
      { startMs: 137906, endMs: 147122, partIdx: 0 },
      { startMs: 147822, endMs: 155417, partIdx: 0 },
      { startMs: 156117, endMs: 163968, partIdx: 0 },
      { startMs: 164668, endMs: 168935, partIdx: 0 },
      { startMs: 169635, endMs: 175864, partIdx: 0 },
      { startMs: 176564, endMs: 186804, partIdx: 0 },
      { startMs: 187504, endMs: 192709, partIdx: 0 },
      { startMs: 193409, endMs: 203222, partIdx: 0 },
      { startMs: 203922, endMs: 206141, partIdx: 0 },
      { startMs: 206841, endMs: 213753, partIdx: 0 },
      { startMs: 214453, endMs: 229216, partIdx: 0 },
      { startMs: 229916, endMs: 237511, partIdx: 0 },
      { startMs: 238211, endMs: 242990, partIdx: 0 },
      { startMs: 243690, endMs: 247103, partIdx: 0 },
    ],
  },
  pricing: {
    totalMs: 156824,
    parts: [
      { idx: 0, offsetMs: 0, durationMs: 156824, byteSize: 5018422, sha256: "9f9707b979613621341e40540779ca1c7ad5d7ca1eeec2bf4e5d7152090079de" },
    ],
    lines: [
      { startMs: 600, endMs: 5720, partIdx: 0 },
      { startMs: 6420, endMs: 11796, partIdx: 0 },
      { startMs: 12496, endMs: 20773, partIdx: 0 },
      { startMs: 21473, endMs: 29324, partIdx: 0 },
      { startMs: 30024, endMs: 30792, partIdx: 0 },
      { startMs: 31492, endMs: 40793, partIdx: 0 },
      { startMs: 41493, endMs: 46016, partIdx: 0 },
      { startMs: 46716, endMs: 57468, partIdx: 0 },
      { startMs: 58168, endMs: 62264, partIdx: 0 },
      { startMs: 62964, endMs: 69705, partIdx: 0 },
      { startMs: 70405, endMs: 80133, partIdx: 0 },
      { startMs: 80833, endMs: 90220, partIdx: 0 },
      { startMs: 90920, endMs: 97832, partIdx: 0 },
      { startMs: 98532, endMs: 110649, partIdx: 0 },
      { startMs: 111349, endMs: 118261, partIdx: 0 },
      { startMs: 118961, endMs: 125702, partIdx: 0 },
      { startMs: 126402, endMs: 132973, partIdx: 0 },
      { startMs: 133673, endMs: 143316, partIdx: 0 },
      { startMs: 144016, endMs: 150160, partIdx: 0 },
      { startMs: 150860, endMs: 155724, partIdx: 0 },
    ],
  },
};
