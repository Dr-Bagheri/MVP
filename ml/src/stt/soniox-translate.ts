// Translation THROUGH the transcriber (2026-09-06; user directive: "run
// translate_record through Soniox instead of a language model"). One async
// job with `translation: { type: "one_way", target_language }`: the provider
// transcribes and translates in one pass, and answers with the ORIGINAL
// tokens (timed) interleaved with the TRANSLATED tokens (untimed, in the
// target language) that follow each original run.
//
// What leaves here is a list of UNITS — one original run with its timing and
// its translation — on the file's own 0-based timeline. Aligning units to
// the product's stored lines is core's job (it holds the lines and the part
// offsets); this module knows tokens and nothing about records.

import { config } from "../config.js";
import { MlError } from "../errors.js";
import { SonioxApi, pollDeadlineMs, type SonioxToken } from "./soniox-api.js";

const MODEL = "stt-async-v5";

export interface TranslationUnit {
  /** the original run's span, ms on the file's timeline */
  start_ms: number;
  end_ms: number;
  /** what the provider heard, as the language it identified */
  source_language: string | null;
  source_text: string;
  /** the translation — or the source itself when the provider had nothing
   *  to translate (already in the target language); never empty */
  text: string;
}

export interface TranslateInput {
  file: string;
  durationMs: number;
  targetLanguage: string;
  languageHints: string[];
}

export interface TranslateOutcome {
  units: TranslationUnit[];
  model: string;
}

/**
 * Tokens → units. The provider's stream is `original… translation… original…
 * translation…`; a token with `translation_status: "none"` is one the
 * provider left as it was (already in the target language), which closes
 * nothing and carries its own text as its translation. Whitespace is the
 * tokens' own — a token beginning with a space begins a word — and each side
 * is collapsed once at the end.
 */
export function groupTranslation(tokens: readonly SonioxToken[]): TranslationUnit[] {
  const units: TranslationUnit[] = [];
  let current: TranslationUnit | null = null;
  let inTranslation = false;
  /* what the open unit's SOURCE is made of: a run the provider translated
     ("original") or one it left as it was ("none") — a change of kind is a
     new unit even when no translation sat between them, or an English
     aside would be glued onto the Persian sentence after it */
  let currentKind: "original" | "none" | null = null;

  const close = (): void => {
    if (current) units.push(finish(current));
    current = null;
    inTranslation = false;
    currentKind = null;
  };

  for (const token of tokens) {
    const status = token.translation_status ?? "none";
    const text = token.text ?? "";
    if (status === "translation") {
      if (!current) {
        current = { start_ms: 0, end_ms: 0, source_language: token.source_language ?? null, source_text: "", text: "" };
      }
      if (current.source_language === null && token.source_language) current.source_language = token.source_language;
      current.text += text;
      inTranslation = true;
      continue;
    }
    // an original (or an untranslated) token: a new run when the previous
    // run's translation has already arrived, or when the kind changes
    if (inTranslation || (current && currentKind !== status)) close();
    currentKind = status === "original" ? "original" : "none";
    if (!current) {
      current = {
        start_ms: Math.round(token.start_ms ?? 0),
        end_ms: Math.round(token.end_ms ?? token.start_ms ?? 0),
        source_language: token.language ?? null,
        source_text: "",
        text: "",
      };
    }
    current.source_text += text;
    if (typeof token.end_ms === "number") current.end_ms = Math.max(current.end_ms, Math.round(token.end_ms));
    if (status === "none") current.text += text;
  }
  close();
  return units.filter((u) => u.source_text !== "" || u.text !== "");
}

function finish(unit: TranslationUnit): TranslationUnit {
  const source = unit.source_text.replace(/\s+/g, " ").trim();
  const text = unit.text.replace(/\s+/g, " ").trim();
  return { ...unit, source_text: source, text: text === "" ? source : text };
}

/** the provider's own request — exported so the test asserts the body, not a paraphrase */
export function translateBody(fileId: string, input: TranslateInput): Record<string, unknown> {
  return {
    file_id: fileId,
    model: MODEL,
    language_hints: input.languageHints,
    enable_language_identification: true,
    translation: { type: "one_way", target_language: input.targetLanguage },
  };
}

async function sonioxTranslate(input: TranslateInput): Promise<TranslateOutcome> {
  const cfg = config();
  const key = cfg.SONIOX_API_KEY;
  if (!key) throw new MlError("stt_unavailable", "soniox translation has no key");
  if (input.durationMs > cfg.ML_SONIOX_MAX_DURATION_MS) {
    throw new MlError("media_too_long", "audio exceeds the soniox lane's ceiling");
  }
  const api = new SonioxApi(key);
  let fileId: string | undefined;
  let transcriptionId: string | undefined;
  try {
    fileId = await api.uploadFile(input.file);
    transcriptionId = await api.createTranscription(translateBody(fileId, input));
    await api.waitUntilDone(transcriptionId, {
      deadlineMs: pollDeadlineMs(input.durationMs, cfg.ML_STT_TIMEOUT_MS),
      baseIntervalMs: cfg.ML_STT_POLL_MS,
    });
    const tokens = await api.transcript(transcriptionId);
    return { units: groupTranslation(tokens), model: MODEL };
  } finally {
    if (transcriptionId) await api.delete(`/transcriptions/${transcriptionId}`);
    if (fileId) await api.delete(`/files/${fileId}`);
  }
}

export type Translator = (input: TranslateInput) => Promise<TranslateOutcome>;

let active: Translator = sonioxTranslate;

/** the provider's translator, or the one a test installed */
export function translator(): Translator {
  return active;
}

/** test seam: swap the translator for a stub (like setLanes) */
export function setTranslator(next: Translator | undefined): void {
  active = next ?? sonioxTranslate;
}

export function translationAvailable(): boolean {
  return Boolean(config().SONIOX_API_KEY);
}
