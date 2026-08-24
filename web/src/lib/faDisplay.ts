/**
 * Persian DISPLAY normalization (quality pass, 2026-08-23) — rendering
 * only, the stored transcript is the record and stays byte-identical.
 * Deterministic character/spacing repairs a transcriber legitimately
 * emits and a Persian reader stumbles over: Arabic yeh/kaf variants
 * (render subtly wrong in Persian type), stray space before punctuation,
 * missing space after «،؛». Search is unaffected either way — the
 * database's fa_fold already folds these at index time.
 */
export function faDisplay(text: string): string {
  return text
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ۀ/g, "هٔ")
    // no space BEFORE a closing punctuation mark
    .replace(/[ \t]+([،؛؟!.:])/g, "$1")
    // exactly one space AFTER «،» و «؛» — unless a closer follows
    .replace(/([،؛])(?=[^\s»)\]،؛؟!.:])/g, "$1 ")
    .replace(/ {2,}/g, " ");
}
