/**
 * Redaction, first slice (user Persian-moat item, 2026-08-23): mask the
 * digit shapes that identify a PERSON — کد ملی, card numbers, mobile
 * numbers, شبا — before a transcript leaves the product through an export.
 *
 * The classifier is a LENGTH heuristic over digit runs (both scripts,
 * space/dash separators): 10+ joined digits is an identifier shape —
 * national id (10), mobile (10–11), card (16), شبا (24). Anything shorter
 * survives untouched, because amounts, dates and quantities are the
 * transcript's VALUE (the figures ledger exists to surface them) — a
 * redactor that eats «۲۵۰ هزار تومان» is an edit wearing a safeguard.
 * Known tradeoff, on record: a 10+ digit amount written with space groups
 * would mask; comma-grouped and worded amounts (میلیون/میلیارد) survive.
 */
const DIGIT_RUN = /[0-9۰-۹](?:[ -]?[0-9۰-۹]){9,}/g;

export const REDACTION_MASK = "██████";

export function redactSensitive(text: string): string {
  return text.replace(DIGIT_RUN, REDACTION_MASK);
}
