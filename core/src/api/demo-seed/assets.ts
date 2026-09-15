/**
 * The demo speech that ships IN THE REPOSITORY (M52).
 *
 * `core/assets/demo-audio/<language>/<record>.wav` is the source of truth for
 * a record's audio; the `_demo/...` object in Storage is a CACHE the seeder
 * fills from it. So production needs no manual upload step: the first seed
 * on a deployment finds the bucket empty, reads the bundled file, verifies
 * its sha256 against the pack's own measurement, uploads it once, and every
 * later seed copies as before.
 *
 * Reading is a dependency the engine takes (`SeedContentInput.assets`) so a
 * test can hand it bytes or an absence without touching the disk — but the
 * DEFAULT reads the real files, and the upload test uses that default on
 * purpose: it is the one assertion that the bundle and the generated
 * `audio.<lang>.ts` module describe the same bytes.
 *
 * The path is resolved from THIS module's URL, decoded — `fileURLToPath`
 * turns `%20` back into a space, which matters on a checkout whose folder
 * name contains one; a `new URL(...).pathname` would not, and the file
 * would be "missing" on exactly the machines whose paths have spaces.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { DemoLanguage, DemoRecordKey } from "./pack.ts";
import { bundledDemoAudioFile } from "./pack.ts";

/** What the seeder learns about one bundled part: where it looked, and what it found. */
export interface DemoAsset {
  /** the absolute file path the bytes were (or would have been) read from */
  path: string;
  /** null when there is no such file — the "seeded without audio" branch */
  bytes: Uint8Array | null;
}

export type DemoAssetReader = (
  language: DemoLanguage,
  record: DemoRecordKey,
  idx: number,
) => Promise<DemoAsset>;

/** The directory the bundled recordings live in, as a decoded filesystem path. */
export const DEMO_ASSETS_DIR = fileURLToPath(
  new URL("../../../assets/demo-audio/", import.meta.url),
);

/** Where one bundled part lives on disk. */
export const bundledDemoAudioPath = (
  language: DemoLanguage,
  record: DemoRecordKey,
  idx: number,
): string => `${DEMO_ASSETS_DIR}${language}/${bundledDemoAudioFile(record, idx)}`;

/**
 * The default reader. A missing file is an ANSWER (`bytes: null`), because
 * the engine has a branch for it and must name the path; any other failure
 * (permissions, a directory where a file should be) is a fault and is thrown.
 */
export const bundledDemoAudio: DemoAssetReader = async (language, record, idx) => {
  const path = bundledDemoAudioPath(language, record, idx);
  try {
    return { path, bytes: await readFile(path) };
  } catch (cause) {
    if ((cause as { code?: string }).code === "ENOENT") return { path, bytes: null };
    throw cause;
  }
};
