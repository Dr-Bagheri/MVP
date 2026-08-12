// Word error rate, with the Persian normalization that makes it mean anything.
//
// WER on raw Persian text measures the wrong thing. Half the apparent errors
// are orthographic: Arabic ي vs Persian ی, Arabic ك vs Persian ک, a ZWNJ
// written as a space, Persian vs ASCII digits, a stray tatweel. Those are the
// same word spelled two ways — counting them as recognition errors flatters or
// punishes a provider for the keyboard its training data used, and buries the
// errors that actually matter.
//
// So both sides are folded to one orthography first, and ONLY then compared.
// This is a MEASUREMENT tool: it deliberately does not share code with the
// pipeline, because a normalizer that quietly changed what we store would be a
// much worse bug than a slightly wrong number.

const ARABIC_YEH = /ي/g; // ي → ی
const ARABIC_KEHEH = /ك/g; // ك → ک
const ARABIC_ALEF_VARIANTS = /[آأإ]/g; // آأإ → ا
const HARAKAT = /[ً-ْٰ]/g; // fatha, kasra, sukun, dagger alef…
const TATWEEL = /ـ/g;
const ZWNJ = /‌/g;
const PERSIAN_DIGITS = /[۰-۹]/g;
const ARABIC_DIGITS = /[٠-٩]/g;
// Persian punctuation plus the ASCII a transcript picks up from either side.
const PUNCTUATION = /[.,!?;:()«»"'،؛؟…\-–—\[\]{}]/g;

export function normalizeFa(text: string): string {
  return text
    .normalize("NFC")
    .replace(ARABIC_YEH, "ی")
    .replace(ARABIC_KEHEH, "ک")
    .replace(ARABIC_ALEF_VARIANTS, "ا")
    .replace(HARAKAT, "")
    .replace(TATWEEL, "")
    // ZWNJ becomes a SPACE rather than nothing, in both texts alike. Whether
    // «می‌خوایم» was written joined or spaced is a typing convention, not a
    // transcription error, and making both sides tokenize identically is what
    // stops it counting as one.
    .replace(ZWNJ, " ")
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeFa(text);
  return normalized ? normalized.split(" ") : [];
}

export interface WerResult {
  /** (substitutions + deletions + insertions) / reference length. */
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  hits: number;
  referenceWords: number;
  hypothesisWords: number;
  /** The aligned operations, for a human to read. */
  ops: AlignOp[];
}

export interface AlignOp {
  type: "hit" | "sub" | "del" | "ins";
  reference?: string;
  hypothesis?: string;
}

/**
 * Levenshtein alignment over WORDS, with backtrace so the caller can show a
 * human which words went wrong. A bare percentage tells you a provider is
 * worse without telling you how — and "how" is what decides whether a lane is
 * usable for a domain.
 */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);

  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const cost = Array.from({ length: rows }, () => new Int32Array(cols));
  // 0 = hit, 1 = sub, 2 = del (ref consumed), 3 = ins (hyp consumed)
  const from = Array.from({ length: rows }, () => new Uint8Array(cols));

  for (let i = 1; i < rows; i++) {
    cost[i]![0] = i;
    from[i]![0] = 2;
  }
  for (let j = 1; j < cols; j++) {
    cost[0]![j] = j;
    from[0]![j] = 3;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = ref[i - 1] === hyp[j - 1];
      const sub = cost[i - 1]![j - 1]! + (same ? 0 : 1);
      const del = cost[i - 1]![j]! + 1;
      const ins = cost[i]![j - 1]! + 1;
      const best = Math.min(sub, del, ins);
      cost[i]![j] = best;
      from[i]![j] = best === sub ? (same ? 0 : 1) : best === del ? 2 : 3;
    }
  }

  const ops: AlignOp[] = [];
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let hits = 0;

  let i = ref.length;
  let j = hyp.length;
  while (i > 0 || j > 0) {
    const move = from[i]![j]!;
    if (i > 0 && j > 0 && (move === 0 || move === 1)) {
      if (move === 0) {
        hits++;
        ops.push({ type: "hit", reference: ref[i - 1]!, hypothesis: hyp[j - 1]! });
      } else {
        substitutions++;
        ops.push({ type: "sub", reference: ref[i - 1]!, hypothesis: hyp[j - 1]! });
      }
      i--;
      j--;
    } else if (i > 0 && move === 2) {
      deletions++;
      ops.push({ type: "del", reference: ref[i - 1]! });
      i--;
    } else {
      insertions++;
      ops.push({ type: "ins", hypothesis: hyp[j - 1]! });
      j--;
    }
  }
  ops.reverse();

  return {
    // An empty reference cannot have an error rate; reporting 0 would claim a
    // perfect score for a measurement that never happened.
    wer: ref.length === 0 ? Number.NaN : (substitutions + deletions + insertions) / ref.length,
    substitutions,
    deletions,
    insertions,
    hits,
    referenceWords: ref.length,
    hypothesisWords: hyp.length,
    ops,
  };
}
