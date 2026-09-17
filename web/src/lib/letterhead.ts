/**
 * THE COMPANY SHEET, WHATEVER SHAPE IT ARRIVES IN.
 *
 * User directive, 2026-09-17: an organisation uploads «their company sheet
 * with logo», and asked what that file would be, the answer was "it might be
 * a word template or a pdf letterhead".
 *
 * ── WHY EVERYTHING BECOMES ONE PAGE IMAGE ────────────────────────────────
 *
 * The two exports are produced by two mechanisms that have exactly one thing
 * in common: both are HTML. Word opens an HTML document saved as .doc, and
 * the PDF is the browser's own print of that same document. So the only
 * letterhead either of them can carry is one an <img> can hold — and the
 * alternative, composing each export against the file the admin happened to
 * upload, is how a feature ends up in the Word file and missing from the PDF.
 * A letterhead that reaches one export and not the other is the half-feature
 * this directive exists to close.
 *
 * So the conversion happens ONCE, here, at upload:
 *
 *   an image   is the page.
 *   a PDF      is rendered — page one, through pdf.js, at print resolution.
 *   a .docx    is a zip, and its letterhead is the picture in its header:
 *              `word/header*.xml` names an image through its rels, and that
 *              image is what the company's paper looks like. When the file
 *              does not say so unambiguously we REFUSE IT BY NAME rather
 *              than guess — a wrong letterhead is worse than none, and the
 *              remedy is one step the person already knows (save it as PDF).
 *
 * Nothing here talks to the server: the server is handed an image and asked
 * no questions about where it came from, beyond the source type it records
 * so the screen can say «از فایل PDF ساخته شد».
 */

/** what the exports can draw, and what db/0228 will store */
export type PageMime = "image/png" | "image/jpeg" | "image/webp";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** what an admin may hand us, with the two office formats they named */
export const SHEET_ACCEPT = [
  "image/png", "image/jpeg", "image/webp", "application/pdf", DOCX_MIME,
].join(",");

/** the derived page's longest edge. A4 at ~190dpi: sharp in print, and a
    third of the 3MB the column allows (0228) for an ordinary letterhead. */
export const PAGE_MAX_PX = 1600;

/** a refusal the screen can translate — a code, never a sentence, because
    the sentence belongs to the catalogue in the reader's language */
export class SheetError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SheetError"; }
}

export interface DerivedPage {
  /** the page image as a data URL — previewed before it is ever uploaded */
  dataUrl: string;
  mime: PageMime;
  /** what the admin actually gave us (db/0228's `sheet_source_mime`) */
  sourceMime: string;
  widthPx: number;
  heightPx: number;
}

/** the base64 half of a data URL, which is what the upload route wants */
export function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

export async function derivePage(file: File): Promise<DerivedPage> {
  const type = file.type;
  if (type === "application/pdf") return fromPdf(file);
  if (type === DOCX_MIME) return fromDocx(file);
  if (type === "image/png" || type === "image/jpeg" || type === "image/webp") {
    return fromImage(await file.arrayBuffer(), type, type);
  }
  throw new SheetError("sheet_unsupported");
}

/* ── an image ───────────────────────────────────────────────────────────── */

async function fromImage(
  bytes: ArrayBuffer, mime: PageMime, sourceMime: string,
): Promise<DerivedPage> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  const scale = Math.min(1, PAGE_MAX_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new SheetError("sheet_unreadable");
  /* WHITE FIRST. A transparent PNG letterhead drawn straight onto a canvas
     keeps its alpha, and behind a printed page that reads as nothing at all;
     paper is white, and this is paper. */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return {
    dataUrl: canvas.toDataURL("image/png"), mime: "image/png",
    sourceMime, widthPx: width, heightPx: height,
  };
}

/* ── a PDF ──────────────────────────────────────────────────────────────── */

async function fromPdf(file: File): Promise<DerivedPage> {
  /* DYNAMIC, and that is the point: pdf.js is a megabyte of renderer that
     only an admin uploading a PDF letterhead ever needs. Loading it with the
     page would put it in front of everybody who opens a meeting. */
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc =
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new SheetError("sheet_unreadable_pdf");
  }
  try {
    /* PAGE ONE. A letterhead is one sheet; a multi-page PDF is somebody's
       document rather than their paper, and taking page 3 of it would be a
       guess nobody asked for. */
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = PAGE_MAX_PX / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new SheetError("sheet_unreadable");
    /* a PDF page has no background of its own — white it, or the render
       lands on transparency and prints as nothing */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return {
      dataUrl: canvas.toDataURL("image/png"), mime: "image/png",
      sourceMime: "application/pdf",
      widthPx: canvas.width, heightPx: canvas.height,
    };
  } finally {
    void doc.cleanup();
  }
}

/* ── a Word template ────────────────────────────────────────────────────── */

/**
 * A .docx is a zip, and this reads exactly as much of it as the question
 * needs: which picture is in the header.
 *
 * No zip library, deliberately — the browser has the hard half
 * (`DecompressionStream("deflate-raw")`), and what is left is walking a
 * central directory. A dependency for sixty lines that only ever reads two
 * kinds of entry is a dependency that also has to be kept.
 */
async function fromDocx(file: File): Promise<DerivedPage> {
  const zip = await readZip(new Uint8Array(await file.arrayBuffer()));

  /* the HEADER's own picture: `word/_rels/headerN.xml.rels` maps the header's
     references to files, and an image among them IS the letterhead. Reading
     the rels rather than globbing `word/media/` is what keeps a photograph
     inside the document's body from being mistaken for company paper. */
  const headerRels = [...zip.keys()].filter((n) => /^word\/_rels\/header\d*\.xml\.rels$/.test(n));
  const targets = new Set<string>();
  for (const rel of headerRels) {
    const xml = new TextDecoder().decode(zip.get(rel)!);
    for (const m of xml.matchAll(/Target="([^"]+)"/g)) {
      const target = m[1]!.replace(/^\.\.\//, "").replace(/^\//, "");
      if (/\.(png|jpe?g)$/i.test(target)) targets.add(`word/${target}`.replace("word/word/", "word/"));
    }
  }
  const found = [...targets].filter((t) => zip.has(t));
  /*
   * ONE picture or none. Two images in a header is a letterhead we would be
   * choosing between — a logo and a signature, a header and a footer — and
   * picking the first is exactly the kind of quiet guess that produces a
   * document with the wrong thing at the top of it. The refusal names the
   * one step that fixes it, which the screen turns into a sentence.
   */
  if (found.length !== 1) throw new SheetError("sheet_unreadable_docx");
  const name = found[0]!;
  const bytes = zip.get(name)!;
  const mime: PageMime = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
  return fromImage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, mime, DOCX_MIME);
}

/** name → bytes, for the entries this reader can decompress */
async function readZip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  /* the End of Central Directory record, found from the back: its signature
     is the only fixed point in a zip, and the comment after it may be
     anything at all */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new SheetError("sheet_unreadable_docx");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    /* only what the question needs: the header rels and the pictures. A .docx
       carries fonts and styles that nothing here will ever look at. */
    if (!/^word\/(_rels\/header\d*\.xml\.rels|media\/.+)$/.test(name)) continue;

    /* the LOCAL header's own lengths — the central directory's name length
       and the local one need not agree, and reading the wrong offset is how
       a zip parser hands back somebody else's bytes */
    const localNameLen = view.getUint16(localAt + 26, true);
    const localExtraLen = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compressed);
    if (method === 0) { out.set(name, raw); continue; }
    if (method !== 8) continue;
    const stream = new Blob([raw.slice().buffer as ArrayBuffer]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return out;
}
