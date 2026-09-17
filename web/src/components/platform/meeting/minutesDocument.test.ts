import { describe, expect, it } from "vitest";
import { meetingFixture } from "@/test/fixtures";
import {
  minutesDocument, minutesWordFile, SHEET_PART,
  type MinutesDocumentArgs, type SheetForDocument, type SignatureForDocument,
} from "./minutesDocument";

/**
 * THE DOCUMENT ON THE ORGANISATION'S OWN PAPER (user directive, 2026-09-17).
 *
 * What cannot be seen from a screen: this string goes to TWO readers that
 * agree about almost nothing — Word, which repeats a background only from a
 * header part, and the browser's print, which repeats one only from a fixed
 * box. Both halves have to be there, each fenced from the other, or the
 * letterhead lands on one export and not the other — which is the
 * half-feature the directive exists to close.
 */
const t = (key: string, vars?: Record<string, string | number>) =>
  vars === undefined ? key : `${key}:${Object.values(vars).join(",")}`;

const MEETING = meetingFixture({
  id: "bb8ff8e1-1111-4000-8000-000000000001",
  title: "جلسهٔ هفتگی", host_name: "رؤیا", duration_minutes: 60, mode: "online",
});

const SHEET: SheetForDocument = {
  dataUrl: "data:image/png;base64,AAAA", topMm: 52, bottomMm: 30, sideMm: 22,
};

/** the roster as `meetingPeople` keys it: an account id per member */
const PEOPLE = [{ key: "u1", name: "رؤیا" }, { key: "u2", name: "سینا" }];

/** a placed signature (db/0229) — the payload is NOT the sheet's "AAAA", so
    the Word assertion that the letterhead never travels as a data URI can
    still distinguish the two pictures */
const SIGNED_BY_SINA: SignatureForDocument = {
  key: "u2", dataUrl: "data:image/png;base64,U0lHTkFUVVJF", signedAt: "2026-09-17T10:00:00.000Z",
};

const args = (
  sheet: SheetForDocument | null,
  signatures: SignatureForDocument[] = [],
): MinutesDocumentArgs => ({
  t, locale: "fa", meeting: MEETING,
  people: PEOPLE,
  signatures,
  summaryBlocks: [{ kind: "para", text: "دربارهٔ بودجه گفت‌وگو شد." }],
  decisions: ["قرارداد تمدید شود"],
  actions: [],
  sheet,
});

const doc = (sheet: SheetForDocument | null) => minutesDocument(args(sheet));

/** the HTML part of an MHTML archive, decoded — the markup is base64 in
    there, which is the format doing its job and not something to assert
    around: a decoder here proves the part is well-formed as well. */
function htmlPartOf(mhtml: string): string {
  const CRLF = String.fromCharCode(13, 10);
  /* `.slice(1)` drops the PREAMBLE, whose own headers say
     `multipart/related; type="text/html"` — searching the whole file for
     "text/html" finds that first and decodes the archive's prologue as if it
     were the document, which is gibberish that reads like a broken builder */
  const parts = mhtml.split(`--=_NextPart_NeurAI_Minutes`).slice(1);
  const html = parts.find((p) => p.includes("Content-Type: text/html"));
  if (html === undefined) throw new Error("no html part in the archive");
  /* a MIME part is headers, a blank line, then the body */
  const body = html.slice(html.indexOf(CRLF + CRLF) + 4).replace(/\s+/g, "");
  return Buffer.from(body, "base64").toString("utf8");
}
const word = (sheet: SheetForDocument | null, signatures: SignatureForDocument[] = []) =>
  minutesWordFile(args(sheet, signatures));

describe("the minutes on the organisation's letterhead", () => {
  it("gives the BROWSER a full-page sheet and a clear area that repeats", () => {
    const html = doc(SHEET);
    expect(html).toContain('class="sheet"');
    expect(html).toContain("position: fixed");
    /* at the page area's ORIGIN, under a zero page margin — measured: a fixed
       box is anchored to the page AREA and a negative offset does not reach
       the paper (it landed at 221mm and stopped repeating) */
    expect(html).toContain("@page { size: A4; margin: 0; }");
    expect(html).toContain(".sheet { position: fixed; top: 0; left: 0; width: 210mm; height: 297mm");
    expect(html).not.toContain(`top: -${SHEET.topMm}mm`);
    /* the clear area repeats through a table head and foot, because the page
       margins that would have repeated it are the ones we just gave up */
    expect(html).toContain(`table.frame > thead > tr > td { height: ${SHEET.topMm}mm; }`);
    expect(html).toContain(`table.frame > tfoot > tr > td { height: ${SHEET.bottomMm}mm; }`);
    expect(html).toContain(`table.frame > tbody > tr > td { padding: 0 ${SHEET.sideMm}mm; }`);
    expect(html).toContain('<table class="frame">');
    /* the image ITSELF: a print window has no session to fetch one with */
    expect(html).toContain(SHEET.dataUrl);
    expect(html).not.toContain("/api/org/sheet");
    /* and NONE of Word's furniture — the browser's copy does not carry a
       three-megabyte image twice, nor markup only Word reads */
    expect(html).not.toContain("mso-element:header");
    expect(html).not.toContain("v:imagedata");
  });

  it("gives WORD an MHTML archive: a VML shape naming a real image part", () => {
    /*
     * Each of these was MEASURED against Word 16, because none of it was
     * guessable and two plausible versions shipped-and-failed first:
     *   · an <img> in the header  → inline, header a page tall, 58 pages;
     *   · v:imagedata + data URI  → floating and correctly sized, BLANK page.
     * MHTML with a real part is the one that renders.
     */
    const file = word(SHEET);
    expect(file.startsWith("MIME-Version: 1.0")).toBe(true);
    expect(file).toContain('Content-Type: multipart/related; type="text/html"');
    expect(file).toContain(`Content-Location: file:///C:/neurai/minutes/${SHEET_PART}`);
    const markup = htmlPartOf(file);
    expect(markup).toContain(`<v:imagedata src="${SHEET_PART}"`);
    /* anchored to the PAGE and behind the text — the two attributes that make
       it a watermark rather than a picture in the header's flow */
    expect(markup).toContain("mso-position-vertical-relative:page");
    expect(markup).toContain("z-index:-251658752");
    expect(markup).toContain("@page WordSection1");
    /* the image travels ONCE: as a part, never also as a data URI inside the
       HTML part — that would double a three-megabyte file */
    expect(markup).not.toContain("data:image/png;base64,AAAA");
    /* and the browser's fixed box is not in Word's copy */
    expect(markup).not.toContain('class="sheet"');
  });

  it("insets the text by the clear area the admin measured, in both files", () => {
    /* the BROWSER gets its inset from the repeating frame (its page margin is
       zero, so the sheet can reach the paper — see the other test); WORD gets
       it from its own `@page WordSection1`, which Word honours: opened
       through COM, the document reports margins of 52/24/20mm. */
    expect(htmlPartOf(word(SHEET))).toContain(`margin: ${SHEET.topMm}mm ${SHEET.sideMm}mm ${SHEET.bottomMm}mm; mso-header-margin`);
  });

  it("prints on plain paper when the organisation has no letterhead", () => {
    /* THE CONTROL, and the half that keeps every assertion above honest: a
       document that always carried a sheet would pass all of them. */
    const html = doc(null);
    expect(html).not.toContain('class="sheet"');
    expect(html).not.toContain("data:image/png");
    expect(html).toContain("@page { size: A4; margin: 18mm 15mm 18mm; }");
    /* with no image there is nothing for MHTML to carry, so the Word file is
       the plain document it has always been */
    const file = word(null);
    expect(file.startsWith("MIME-Version")).toBe(false);
    expect(file).not.toContain("v:imagedata");
    /* it is still a صورت‌جلسه: the sheet is the paper, not the document */
    for (const each of [html, file]) {
      expect(each).toContain("minutesDocKind");
      expect(each).toContain("minutesSignatures");
    }
  });
});

/**
 * THE SIGNATURES ON THE PAGE (user directive, 2026-09-17: "when the host is
 * printing it, all of their real signatures that were uploaded in jpg or png
 * are already added there").
 */
describe("the signatures placed on the minutes (db/0229)", () => {
  it("prints a placed signature in its person's row and leaves the others a blank line", () => {
    const html = minutesDocument(args(null, [SIGNED_BY_SINA]));
    /* the picture ITSELF, in the signer's own row — a data URI, for the
       letterhead's reason: the file travels and cannot fetch */
    expect(html).toContain(`<th>سینا</th><td><img class="autograph" height="53" src="${SIGNED_BY_SINA.dataUrl}"`);
    /* the moment under it */
    expect(html).toContain('class="signed-at"');
    /* and the person who has not signed keeps a blank line — paper minutes
       are still signed by hand, and a missing row would say they were not
       there */
    expect(html).toContain("<th>رؤیا</th><td></td>");
    expect(html.match(/class="autograph"/g)).toHaveLength(1);
  });

  it("matches a signature to its row by KEY, never by name", () => {
    /* two colleagues with one display name: the signature belongs to the
       SECOND account, and a name-keyed match would hang it on the first row
       (or on both) */
    const twins = [{ key: "u1", name: "سینا" }, { key: "u2", name: "سینا" }];
    const html = minutesDocument({ ...args(null, [SIGNED_BY_SINA]), people: twins });
    const rows = html.split("<tr>").filter((r) => r.startsWith("<th>سینا</th>"));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.startsWith("<th>سینا</th><td></td></tr>")).toBe(true);
    expect(rows[1]).toContain('class="autograph"');
  });

  it("carries the signature into Word's copy as a body data URI, beside a letterhead that never is", () => {
    /* MEASURED on the letterhead round: Word loads a data URI in an ordinary
       body <img> and refuses one in a header shape — so the signature rides
       inline while the sheet stays an MHTML part. Both halves in one file. */
    const markup = htmlPartOf(word(SHEET, [SIGNED_BY_SINA]));
    expect(markup).toContain(SIGNED_BY_SINA.dataUrl);
    expect(markup).not.toContain(SHEET.dataUrl);
    expect(markup).toContain(`<v:imagedata src="${SHEET_PART}"`);
  });

  it("prints no picture where nothing was signed — the control", () => {
    for (const each of [minutesDocument(args(null)), word(SHEET)]) {
      expect(each).not.toContain('class="autograph"');
      expect(each).not.toContain(SIGNED_BY_SINA.dataUrl);
    }
    /* the rows are still there to sign by hand */
    expect(minutesDocument(args(null))).toContain("<th>رؤیا</th><td></td>");
  });
});
