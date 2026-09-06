// The Soniox ASYNC api, as one small client (2026-09-06): upload a file,
// create a transcription, wait, read the tokens, delete both. The lane and
// the translator both speak it; neither re-implements a request.
//
// Deleting is not politeness: audio and transcript are the customer's record,
// and ml/ leaves no copy anywhere it does not control.

import { openAsBlob } from "node:fs";
import { MlError } from "../errors.js";
import { logger } from "../log.js";
import type { SttContext } from "./types.js";

export const SONIOX_BASE = "https://api.soniox.com/v1";

export interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
  speaker?: number | string;
  language?: string;
  /** one-way translation (C4): "original" | "translation" | "none" */
  translation_status?: string;
  /** on a translated token: the language it was translated FROM */
  source_language?: string;
}

/** the caps the provider documents for `context` (≤ 8000 tokens), applied a little under */
const MAX_TERMS = 500;
const MAX_TERM_CHARS = 80;
const MAX_TERMS_CHARS = 6_000;
const MAX_TEXT_CHARS = 500;
const MAX_GENERAL = 10;

/**
 * The provider's `context` object from ours — or `undefined` when there is
 * nothing to say, because an empty context field is a claim we didn't make.
 * Terms are trimmed, de-duplicated (case-insensitively) and cut at the
 * provider's budget; order is kept, because the producer put the org's own
 * glossary first on purpose.
 */
export function sonioxContext(context: SttContext | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const seen = new Set<string>();
  const terms: string[] = [];
  let chars = 0;
  for (const raw of context.terms ?? []) {
    const term = raw.trim().replace(/\s+/g, " ").slice(0, MAX_TERM_CHARS);
    if (term.length < 2) continue;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    if (terms.length >= MAX_TERMS || chars + term.length > MAX_TERMS_CHARS) break;
    seen.add(key);
    terms.push(term);
    chars += term.length;
  }
  const text = (context.text ?? "").trim().slice(0, MAX_TEXT_CHARS);
  const general = (context.general ?? [])
    .map((g) => ({ key: g.key.trim(), value: g.value.trim() }))
    .filter((g) => g.key !== "" && g.value !== "")
    .slice(0, MAX_GENERAL);
  const out: Record<string, unknown> = {};
  if (terms.length > 0) out.terms = terms;
  if (text !== "") out.text = text;
  if (general.length > 0) out.general = general;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * How long to wait for an async job before calling it lost: the configured
 * floor, or the recording's own length plus a quarter hour — a five-hour
 * file is allowed the time a five-hour file takes, and a five-minute file
 * is still cut off at the floor rather than at twenty minutes.
 */
export function pollDeadlineMs(durationMs: number, floorMs: number): number {
  const byLength = Math.max(0, durationMs) + 15 * 60 * 1000;
  return Math.max(floorMs, byLength);
}

/**
 * Poll quickly at first (a short file finishes in seconds and nobody should
 * wait three more), then back off to ten seconds: a long file is minutes of
 * work at the provider, and a request every three seconds for an hour is
 * twelve hundred requests that each answer "not yet".
 */
export function pollIntervalMs(elapsedMs: number, baseMs: number): number {
  return elapsedMs < 2 * 60 * 1000 ? baseMs : Math.max(baseMs, 10_000);
}

export class SonioxApi {
  readonly key: string;
  readonly base: string;

  constructor(key: string, base: string = SONIOX_BASE) {
    this.key = key;
    this.base = base;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.key}` };
  }

  /** POST /files → the file id */
  async uploadFile(file: string): Promise<string> {
    const form = new FormData();
    form.append("file", await openAsBlob(file), "audio.wav");
    const res = await fetch(`${this.base}/files`, { method: "POST", headers: this.headers(), body: form });
    const body = await readJson(res, "soniox file upload");
    const id = body?.id;
    if (!id) throw new MlError("stt_failed", "soniox upload returned no file id");
    return String(id);
  }

  /** POST /transcriptions → the transcription id */
  async createTranscription(body: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${this.base}/transcriptions`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await readJson(res, "soniox create transcription");
    const id = parsed?.id;
    if (!id) throw new MlError("stt_failed", "soniox create returned no transcription id");
    return String(id);
  }

  /** poll GET /transcriptions/:id until completed, error, or the deadline */
  async waitUntilDone(id: string, opts: { deadlineMs: number; baseIntervalMs: number }): Promise<void> {
    const started = Date.now();
    const deadline = started + opts.deadlineMs;
    while (Date.now() < deadline) {
      const res = await fetch(`${this.base}/transcriptions/${id}`, { headers: this.headers() });
      const body = await readJson(res, "soniox poll");
      const status = String(body?.status ?? "");
      if (status === "completed") return;
      if (status === "error") {
        throw new MlError("stt_failed", `soniox transcription failed: ${String(body?.error_message ?? "unknown")}`);
      }
      await sleep(pollIntervalMs(Date.now() - started, opts.baseIntervalMs));
    }
    throw new MlError("stt_failed", "soniox transcription timed out");
  }

  /** GET /transcriptions/:id/transcript → the tokens */
  async transcript(id: string): Promise<SonioxToken[]> {
    const res = await fetch(`${this.base}/transcriptions/${id}/transcript`, { headers: this.headers() });
    const body = await readJson(res, "soniox transcript");
    const tokens = body?.tokens;
    if (!Array.isArray(tokens)) throw new MlError("stt_failed", "soniox transcript had no tokens array");
    return tokens as SonioxToken[];
  }

  /** best effort, and never allowed to mask a real failure */
  async delete(path: string): Promise<void> {
    try {
      await fetch(`${this.base}${path}`, { method: "DELETE", headers: this.headers() });
    } catch (e) {
      logger.warn({ step: "soniox_cleanup", err: (e as Error).message }, "soniox cleanup failed");
    }
  }
}

async function readJson(res: Response, what: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    // The body may echo request content, so it never reaches the message.
    throw new MlError("stt_failed", `${what} returned HTTP ${res.status}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new MlError("stt_failed", `${what} returned a non-JSON body`, { cause: e });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
