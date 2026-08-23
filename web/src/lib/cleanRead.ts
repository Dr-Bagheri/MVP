/**
 * Clean-read (user directive, 2026-08-23): a DISPLAY mode that hides pure
 * hesitation sounds from the transcript view. The list is deliberately
 * narrow — only sounds with no lexical reading in either language. Words
 * that can carry meaning («خب» = "well", "like", «مثلاً») are never
 * stripped: a clean-read that changes what was said is an edit wearing a
 * view. The record itself is untouched; verbatim is one toggle away.
 */
const LATIN_FILLER = /^(?:u+h+m*|u+m+|e+r+m*|h+m+|m{2,}|mhm+)$/i;
const PERSIAN_FILLER = /^(?:اوم+|هوم+|اِم+|اِه+|آ+)$/;
/** punctuation the transcriber glues onto a filler («اوم،», "um,") */
const EDGE_PUNCT = /^[\s.,،؛;:!؟?…"'«»()-]+|[\s.,،؛;:!؟?…"'«»()-]+$/g;

export function isFillerWord(word: string): boolean {
  const bare = word.replace(EDGE_PUNCT, "");
  if (bare === "") return false;
  return LATIN_FILLER.test(bare) || PERSIAN_FILLER.test(bare);
}

/** Display-only strip for rows that carry no per-word structure. */
export function stripFillers(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => !isFillerWord(word))
    .join(" ");
}
