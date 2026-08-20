/**
 * The Create chip's promise, kept as FILES (user directive, 2026-08-20:
 * "both must fully work"). Create → Doc/PDF used to only prefix the prompt;
 * the person got document-shaped prose and no document.
 *
 * - PDF: a print-ready window and the browser's own Save-as-PDF. No library,
 *   works everywhere — but it MUST be opened from a click (popup blockers
 *   swallow a window.open with no gesture), so this one is a button.
 * - Doc: Word-openable HTML served as `.doc` (the mso-HTML convention Word
 *   and LibreOffice both honour) — a real document with headings, bold and
 *   RTL, not a `.md` most machines shrug at. Downloads need no gesture, so
 *   the Hub triggers it the moment the tagged answer finishes.
 *
 * Content is HTML-escaped BEFORE the minimal markdown pass — order matters:
 * transforming first would let answer content smuggle markup in.
 */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The few markdown forms the assistant actually emits, nothing more. */
function renderDocBody(text: string): { html: string; rtl: boolean } {
  const html = escapeHtml(text)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-•] (.*)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br>\n");
  return { html, rtl: /[؀-ۿ]/.test(text) };
}

const DOC_STYLE =
  "body{font-family:Vazirmatn,system-ui,sans-serif;max-width:720px;"
  + "margin:2rem auto;padding:0 1.5rem;line-height:2;color:#111}"
  + "h1,h2,h3{line-height:1.5}li{margin-inline-start:1rem}";

/** Opens the print dialog on a clean rendering — the user saves as PDF. */
export function deliverPdf(text: string, title: string): void {
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  const { html, rtl } = renderDocBody(text);
  w.document.write(
    `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">`
    + `<title>${escapeHtml(title)}</title><style>${DOC_STYLE}</style>`
    + `</head><body>${html}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}

/** Downloads a Word-openable .doc of the answer. */
export function deliverDoc(text: string, title: string): void {
  const { html, rtl } = renderDocBody(text);
  const doc =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office"`
    + ` xmlns:w="urn:schemas-microsoft-com:office:word" dir="${rtl ? "rtl" : "ltr"}">`
    + `<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + `<style>${DOC_STYLE}</style></head><body>${html}</body></html>`;
  // The BOM as a "\u"-ESCAPE, never a literal: the encoding sweep hunts the
  // raw BOM byte sequence, and a deliberate literal in source would be
  // indistinguishable from the corruption the sweep exists to catch. Word
  // wants the BOM for charset detection of the HTML payload.
  const blob = new Blob(["\uFEFF", doc], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "document.doc";
  a.click();
  URL.revokeObjectURL(url);
}
