import type { MeetingItem, MeetingRecord } from "@/api/types";
import type { SummaryBlock } from "@/components/echo/SummaryBody";
import { digits, formatDate, formatTime } from "@/lib/format";
import { dayAsInstant } from "./ItemsPanel";

/**
 * THE EXPORTED FILE — a صورت‌جلسه, on the organisation's own paper when it
 * has any.
 *
 * User directive, 2026-09-17: "if not uploaded just go as simple but still
 * with structure related to regulations of companies and organizations back
 * in iran" — and, when a company sheet IS uploaded, "all the information in
 * summarization must be fit inside it".
 *
 * ── ON THE WORD ───────────────────────────────────────────────────────────
 *
 * The 2026-09-09 ruling retired the minutes' LIFECYCLE — draft → تأیید → امضا
 * → بستن — and nothing here brings it back: there is no state, no button, no
 * column, and nothing reads a signature back. What returns is the FORM a
 * meeting record takes on paper in an Iranian organisation: an identified
 * document, the roster, the agenda, the account of what was said, the
 * decisions as numbered clauses, the actions as a table naming who and by
 * when, and a place to sign. The screen stays «خلاصه» — a thing you read and
 * correct; this is the thing you hand to somebody.
 *
 * ── ONE DOCUMENT, TWO READERS, AND THE THREE THINGS WORD REFUSES ──────────
 *
 * The PDF is the browser's own print; the Word file is opened by Word. They
 * disagree about everything a repeating background needs, and the differences
 * were not guessable — each of these was MEASURED by building the file,
 * opening it in Word 16 through COM, exporting what Word rendered to PDF and
 * looking at the page:
 *
 *   an <img> in a header        → Word makes it INLINE, the header grows to a
 *                                 page, the body is squeezed, and a 3-page
 *                                 record came out as FIFTY-EIGHT pages.
 *   <v:imagedata src="data:…">  → the shape is floating and the right size,
 *                                 and the page is BLANK: Word does not load a
 *                                 data URI there (it loads one in an ordinary
 *                                 body <img> perfectly well, which is how the
 *                                 two halves were told apart).
 *   MHTML + <v:imagedata        → renders. The image is a real part with a
 *   src="letterhead.png">         Content-Location the VML can name.
 *
 * So the Word file is an MHTML archive — the same construct Word's own "Save
 * as Single File Web Page" produces — and the browser keeps the CSS it
 * understands:
 *
 *   the BROWSER   gets `@page` margins (which repeat on every page) and a
 *                 `position: fixed` image pulled back OUT of the page area by
 *                 those same margins, so it covers the paper rather than the
 *                 text box. Fixed boxes repeat on every printed page, which
 *                 is what makes a three-page record land on three sheets of
 *                 company paper.
 *   WORD          gets a VML shape in a HEADER, anchored to the PAGE and
 *                 behind the text. That is the only construct Word repeats on
 *                 every page from HTML.
 *
 * Each half is written only into the file that reader gets (`target`), so
 * neither pays for the other's copy of a three-megabyte image, and Word can
 * never render the browser's background as an ordinary picture at the top of
 * page one.
 */

/** HTML-escape. Everything interpolated below is USER OR MODEL text, and a
    raw title written into a document is stored XSS wearing a .doc extension. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SheetForDocument {
  /** the page image as a data URI — a document that fetched it would arrive
      at Word, and at a print window, with nothing to show */
  dataUrl: string;
  topMm: number;
  bottomMm: number;
  sideMm: number;
}

export interface MinutesDocumentArgs {
  /** the meetings catalogue, in the reader's language */
  t: (key: string, vars?: Record<string, string | number>) => string;
  locale: string;
  meeting: MeetingRecord;
  /** the roster, already resolved by `meetingPeople` */
  attendees: string[];
  /** the summary as the SCREEN parsed it — one parse, two renderings */
  summaryBlocks: SummaryBlock[];
  decisions: string[];
  /** the rows, not a rendering: the table's owner and deadline columns are
      the reason this section is in the document at all */
  actions: MeetingItem[];
  sheet: SheetForDocument | null;
  /** which reader this copy is for — see the header for what each refuses.
      Defaults to the browser's, which is what the print path takes. */
  target?: "browser" | "word";
}

/** the letterhead's part name inside the Word file's MHTML archive, named
    once so the VML reference and the part cannot drift apart */
export const SHEET_PART = "letterhead.png";

const DASH = "—";

export function minutesDocument(args: MinutesDocumentArgs): string {
  const { t, locale, meeting, attendees, summaryBlocks, decisions, actions, sheet } = args;
  const rtl = locale === "fa";

  const item = (x: string, i: number) => `<p>${digits(i + 1, locale)}. ${esc(x)}</p>`;

  const summaryHtml = summaryBlocks
    .map((b) =>
      b.kind === "heading" ? `<h3>${esc(b.text)}</h3>`
        : b.kind === "bullets" ? `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
          : b.kind === "numbered" ? `<ol>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`
            : `<p>${esc(b.text)}</p>`)
    .join("");

  /* the IDENTITY BLOCK — every row a fact the record already holds, and a row
     with nothing behind it is left out rather than printed empty: «محل
     برگزاری: —» claims the place was asked for and not answered, which for an
     online meeting is simply untrue */
  const metaHtml = ([
    [t("minutesNumber"), `MTG-${meeting.id.slice(0, 8)}`],
    [t("minutesDate"), formatDate(meeting.scheduled_at, locale)],
    [t("fieldTime"), formatTime(meeting.scheduled_at, locale)],
    [t("minutesDuration"), meeting.duration_minutes === null
      ? "" : t("agendaMinutes", { n: digits(meeting.duration_minutes, locale) })],
    [t("fieldMode"), t(`mode_${meeting.mode}`)],
    [t("fieldLocation"), meeting.location ?? ""],
  ] as Array<[string, string]>)
    .filter(([, value]) => value !== "")
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join("");

  const agendaHtml = meeting.agenda.length === 0
    ? `<p class="none">${esc(t("agendaEmpty"))}</p>`
    : `<ol>${meeting.agenda.map((a) => `<li>${esc(a.title)}${
      a.minutes === null ? "" : ` — ${esc(t("agendaMinutes", { n: digits(a.minutes, locale) }))}`
    }</li>`).join("")}</ol>`;

  /* THE ACTIONS ARE A TABLE, because the two columns beside the text are why
     this section is in the document: an action with no owner and no date is a
     sentence, and what a company files is an assignment. A dash is the truth
     (the ledger holds no owner), not a question nobody answered. */
  const actionsHtml = actions.length === 0
    ? `<p class="none">${esc(t("minutesNoActions"))}</p>`
    : `<table><thead><tr><th>${esc(t("minutesRow"))}</th><th>${esc(t("minutesAction"))}</th><th>${
      esc(t("minutesOwner"))}</th><th>${esc(t("minutesDue"))}</th></tr></thead><tbody>${
      actions.map((r, i) => `<tr><td>${esc(digits(i + 1, locale))}</td><td>${esc(r.body)}</td><td>${
        esc(r.owner ?? DASH)}</td><td>${
        esc(r.due_on === null ? DASH : formatDate(dayAsInstant(r.due_on), locale))}</td></tr>`).join("")
    }</tbody></table>`;

  /* A PLACE TO SIGN — not an approval ladder: paper minutes are signed by the
     people who were in the room, and nothing in this product reads these
     boxes back. Omitted entirely when the roster is empty, because an empty
     signature grid is a form nobody can complete. */
  const signHtml = attendees.length === 0 ? "" : `<h2>${esc(t("minutesSignatures"))}</h2>
<table class="sign"><tbody>${attendees.map((n) => `<tr><th>${esc(n)}</th><td></td></tr>`).join("")}</tbody></table>`;

  const top = sheet?.topMm ?? 18;
  const bottom = sheet?.bottomMm ?? 18;
  const side = sheet?.sideMm ?? 15;

  /*
   * THE PRINTED PAGE, when there is a letterhead — and every line of this was
   * measured in a headless Chrome print rather than reasoned about, because
   * the obvious version is wrong:
   *
   *   a fixed box is anchored to the PAGE AREA, not the paper. Measured: a
   *   box at `top:0;left:0` under a 52mm margin lands at 52.2mm, and REPEATS
   *   on every page. Pulling it back out with `top:-52mm` does not reach the
   *   paper — it lands at 221mm on page one and does not repeat at all.
   *
   * So the paper is reached the only way Chrome allows: `@page { margin: 0 }`,
   * which makes the page area the whole sheet. The text's own insets then
   * cannot come from the page margins — those are gone — and padding applies
   * once, which would drop page two onto the letterhead's header. A TABLE's
   * `<thead>` and `<tfoot>` repeat on every printed page, so the top and
   * bottom of the clear area are spacer rows, and the sides are padding on
   * the cell (a horizontal inset needs no repeating).
   *
   * Verified on a three-page print: the band starts at 0.0mm and ends at
   * 296.6mm — the paper's own edges — on pages one and three alike, with the
   * first line of text at 57.7mm under a 52mm header.
   */
  const pageCss = `
@page { size: A4; margin: ${sheet === null ? `${top}mm ${side}mm ${bottom}mm` : "0"}; }
/* PAPER, said out loud. This document declared its ink and left the ground to
   the browser — and the PDF path writes into a window the reader LOOKS at
   before the print dialog covers it, so on a dark-mode browser the whole
   صورت‌جلسه arrived as near-black text on a near-black page. The printed sheet
   would have been perfect, which is why only a screenshot of the rendered
   file could catch it. */
html { color-scheme: light; }
body { background: #fff; margin: 0; font-family: Vazirmatn, Tahoma, Arial, sans-serif; font-size: 11pt; line-height: 1.9; color: #111; }
.kind { margin: 0; text-align: center; font-size: 10pt; color: #555; }
h1 { margin: 2mm 0 4mm; text-align: center; font-size: 15pt; }
h2 { margin: 6mm 0 2mm; padding-bottom: 1.5mm; border-bottom: 1px solid #bbb; font-size: 11.5pt; }
h3 { margin: 3mm 0 1mm; font-size: 11pt; }
p { margin: 0 0 1.5mm; }
ul, ol { margin: 0 0 2mm; padding-${rtl ? "right" : "left"}: 6mm; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 1mm; }
th, td { border: 1px solid #999; padding: 2mm 3mm; font-size: 10.5pt; vertical-align: top; }
th { background: #f2f2f2; font-weight: 700; }
table.meta th { width: 30%; }
table.sign { page-break-inside: avoid; }
table.sign td { height: 16mm; }
.none { color: #666; }
${sheet === null ? "" : `
/* the paper: the page area IS the sheet now, so the box sits at its origin */
.sheet { position: fixed; top: 0; left: 0; width: 210mm; height: 297mm; z-index: -1; }
.sheet img { width: 210mm; height: 297mm; }
/* and the clear area, repeated per page by the table's own head and foot */
table.frame { width: 100%; border-collapse: collapse; }
table.frame > thead > tr > td { height: ${top}mm; }
table.frame > tfoot > tr > td { height: ${bottom}mm; }
table.frame > tbody > tr > td { padding: 0 ${side}mm; }
`}`;

  const forWord = args.target === "word";

  /* WORD'S HALF. A VML shape in a header, anchored to the PAGE and behind the
     text, naming the image as a PART of the MHTML archive this document is
     wrapped in — the three measurements in the header say why each of those
     words is load-bearing. `v:shapetype` is declared because Word's own
     exported HTML declares it; a bare `type="#_x0000_t75"` reference with no
     shapetype in the file is a reference to nothing. */
  const wordSheet = sheet === null || !forWord ? "" : `
<style>
@page WordSection1 { size: 21cm 29.7cm; margin: ${top}mm ${side}mm ${bottom}mm; mso-header-margin: 0cm; mso-header: h1; }
div.WordSection1 { page: WordSection1; }
</style>`;

  const wordHeader = sheet === null || !forWord ? "" : `
<div style='mso-element:header' id=h1>
<p style='margin:0'><span style='mso-no-proof:yes'><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" filled="f" stroked="f"><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype><v:shape id="sheet" type="#_x0000_t75" stroked="f"
 style='position:absolute;margin-left:0;margin-top:0;width:595.3pt;height:841.9pt;z-index:-251658752;
 mso-position-horizontal-relative:page;mso-position-vertical-relative:page'>
<v:imagedata src="${SHEET_PART}" o:title="letterhead"/></v:shape></span></p>
</div>`;

  /* the browser's half: the image ITSELF, because a print window has no
     session with which to fetch anything */
  const browserSheet = sheet === null || forWord ? "" : `
<div class="sheet"><img src="${sheet.dataUrl}" alt=""></div>`;

  const ns = forWord
    ? ` xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"`
    : "";

  /* the repeating frame, and ONLY for the browser's copy with a sheet on it:
     Word has its own margins (`@page WordSection1`) and would render this as
     an ordinary table around the whole document */
  const framed = sheet !== null && !forWord;
  const frameOpen = framed
    ? `<table class="frame"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>`
    : "";
  const frameClose = framed ? `</td></tr></tbody></table>` : "";

  return `<!doctype html><html${ns} dir="${rtl ? "rtl" : "ltr"}" lang="${esc(locale)}"><head><meta charset="utf-8"><title>${esc(meeting.title)}</title>
<style>${pageCss}</style>${wordSheet}</head><body>${browserSheet}
${frameOpen}<div class="WordSection1">
<p class="kind">${esc(t("minutesDocKind"))}</p>
<h1>${esc(meeting.title)}</h1>
<table class="meta"><tbody>${metaHtml}</tbody></table>
<h2>${esc(t("minutesAttendees"))}</h2>${attendees.length === 0 ? `<p class="none">${esc(t("minutesNoAttendees"))}</p>` : `<p>${attendees.map(esc).join(esc(rtl ? "، " : ", "))}</p>`}
<h2>${esc(t("fieldAgenda"))}</h2>${agendaHtml}
<h2>${esc(t("minutesSummary"))}</h2>${summaryHtml === "" ? `<p class="none">${esc(t("minutesNoSummary"))}</p>` : summaryHtml}
<h2>${esc(t("ext_decisions"))}</h2>${decisions.length === 0 ? `<p class="none">${esc(t("minutesNoDecisions"))}</p>` : decisions.map(item).join("")}
<h2>${esc(t("ext_actions"))}</h2>${actionsHtml}
${signHtml}
</div>${frameClose}${wordHeader}
</body></html>`;
}

/**
 * THE WORD FILE.
 *
 * With no letterhead it is the document as it has always been: HTML that Word
 * opens. With one it is an MHTML ARCHIVE — the multipart format Word's own
 * "Save as Single File Web Page" writes — because that is the only way
 * measured (see the header) to get an image Word will repeat on every page:
 * it has to be a PART the VML can name, and a data URI is not.
 *
 * The image is carried ONCE. The browser's copy of the document is a separate
 * string with the data URI in it, so neither file pays for the other's
 * three megabytes.
 */
export function minutesWordFile(args: MinutesDocumentArgs): string {
  const html = minutesDocument({ ...args, target: "word" });
  const sheet = args.sheet;
  if (sheet === null) return html;

  const base64 = sheet.dataUrl.slice(sheet.dataUrl.indexOf(",") + 1);
  const type = /^data:([^;]+)/.exec(sheet.dataUrl)?.[1] ?? "image/png";
  /* 76 characters, which is what RFC 2045 asks of base64 in a MIME body and
     what Word writes itself. A single ten-megabyte line is legal-ish and is
     exactly the kind of thing an old parser refuses. */
  const wrap = (s: string) => (s.match(/.{1,76}/g) ?? []).join("\r\n");
  const boundary = "----=_NextPart_NeurAI_Minutes";
  /* the Content-Location base is arbitrary and never resolved by anything —
     what matters is that the VML's `src` matches the part's own name */
  const base = "file:///C:/neurai/minutes";

  return [
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
    "",
    `--${boundary}`,
    `Content-Location: ${base}/document.html`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(bytesToBase64(new TextEncoder().encode(html))),
    "",
    `--${boundary}`,
    `Content-Location: ${base}/${SHEET_PART}`,
    `Content-Type: ${type}`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap(base64),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** UTF-8 bytes → base64, chunked: `fromCharCode(...millionBytes)` overflows
    the argument list, and a Persian document is mostly multi-byte */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return btoa(binary);
}
