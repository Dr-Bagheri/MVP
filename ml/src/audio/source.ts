// Getting the bytes (CONTRACT.md §2). Three sources, one rule each:
//
//  - multipart bytes: whatever the caller streamed us, capped at ML_MAX_BYTES.
//  - audio_url:       a PRE-SIGNED, self-authorizing URL. ml/ sends no
//                     credentials of its own — the URL is the authority. Hosts
//                     must be allow-listed, because a service that fetches
//                     arbitrary URLs on request is an SSRF pivot (M10).
//  - audio_path:      local filesystem, dev profile only (M12.1), gated.
//
// The URL never reaches a log: a signed URL IS a credential.

import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import net from "node:net";
import { config } from "../config.js";
import { MlError } from "../errors.js";
import { hostOnly } from "../log.js";

export interface Workspace {
  dir: string;
  /** Delete everything this job touched. Always called, in a finally. */
  cleanup: () => Promise<void>;
}

export async function makeWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(path.join(config().ML_WORK_DIR, "echo-ml-"));
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function assertHostAllowed(url: string): void {
  const cfg = config();
  const host = hostOnly(url);
  if (host === "invalid") throw new MlError("bad_request", "audio_url is not a valid URL");

  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new MlError("audio_source_forbidden", "audio_url must be http(s)");
  }

  // A literal private/loopback address is never a legitimate audio source in
  // production, and is the classic SSRF target.
  const bare = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare) && isPrivateAddress(bare) && !cfg.ML_ALLOW_LOCAL_PATHS) {
    throw new MlError("audio_source_forbidden", "audio_url resolves to a private address");
  }

  if (cfg.ML_URL_ALLOWLIST.length > 0) {
    const ok = cfg.ML_URL_ALLOWLIST.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    if (!ok) throw new MlError("audio_source_forbidden", "audio_url host is not allow-listed");
    return;
  }

  // Empty allow-list is permitted only in the dev profile; in production it
  // means "no URL source is configured", not "any URL is fine".
  if (!cfg.ML_ALLOW_LOCAL_PATHS) {
    throw new MlError("audio_source_forbidden", "no audio_url allow-list is configured");
  }
}

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }
  const low = ip.toLowerCase();
  return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
}

/** Download a pre-signed URL into the workspace. Enforces the byte cap while streaming. */
export async function fetchToFile(url: string, dest: string): Promise<number> {
  assertHostAllowed(url);
  const cfg = config();

  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (e) {
    throw new MlError("download_failed", `could not fetch audio from ${hostOnly(url)}`, { cause: e });
  }
  if (!res.ok || !res.body) {
    throw new MlError("download_failed", `audio source returned HTTP ${res.status}`);
  }

  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cfg.ML_MAX_BYTES) {
    throw new MlError("media_too_long", "audio exceeds ML_MAX_BYTES");
  }

  let written = 0;
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      if (written > cfg.ML_MAX_BYTES) throw new MlError("media_too_long", "audio exceeds ML_MAX_BYTES");
      controller.enqueue(chunk);
    },
  });

  await pipeline(Readable.fromWeb(res.body.pipeThrough(cap) as any), createWriteStream(dest));
  return written;
}

/** Accept a local path only in the dev profile, and only for a real file. */
export async function assertLocalPathAllowed(p: string): Promise<number> {
  if (!config().ML_ALLOW_LOCAL_PATHS) {
    throw new MlError("audio_source_forbidden", "audio_path requires ML_ALLOW_LOCAL_PATHS=1");
  }
  let s;
  try {
    s = await stat(p);
  } catch (e) {
    throw new MlError("bad_request", "audio_path does not exist", { cause: e });
  }
  if (!s.isFile()) throw new MlError("bad_request", "audio_path is not a file");
  if (s.size > config().ML_MAX_BYTES) throw new MlError("media_too_long", "audio exceeds ML_MAX_BYTES");
  return s.size;
}
