import { describe, expect, it, vi } from "vitest";
import { derivePage, SheetError } from "./letterhead";

/**
 * READING A WORD TEMPLATE'S LETTERHEAD.
 *
 * The user said the company sheet «might be a word template or a pdf
 * letterhead», so a .docx has to be read — and a .docx is a zip whose header
 * part names the picture that IS the company's paper.
 *
 * The fixtures here are REAL ZIPS, built byte by byte with STORED entries.
 * That is deliberate: a fake `readZip` would agree with whatever this file's
 * author believed about the format, and the format is the whole question.
 */

/** a zip with stored (uncompressed) entries — the shape a reader must walk */
function zip(files: Array<[string, Uint8Array]>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length + bytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true);              // stored
    lv.setUint32(18, bytes.length, true);  // compressed size
    lv.setUint32(22, bytes.length, true);  // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(bytes, 30 + nameBytes.length);
    locals.push(local);

    const entry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += local.length;
  }
  const centralSize = central.reduce((n, e) => n + e.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = [...locals, ...central, eocd];
  const out = new Uint8Array(total.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of total) { out.set(part, at); at += part.length; }
  return out;
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const text = (s: string) => new TextEncoder().encode(s);
/** an 8-byte stand-in: what matters is WHICH entry is chosen, not its pixels */
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const rels = (target: string) =>
  text(`<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="${target}"/></Relationships>`);

function docx(files: Array<[string, Uint8Array]>): File {
  return new File([zip(files) as unknown as BlobPart], "sheet.docx", { type: DOCX });
}

describe("the company sheet, whatever shape it arrives in", () => {
  /* the deriving step ends in a canvas, which jsdom does not paint. The
     DRAWING is not what these tests are about — WHICH picture is chosen is —
     so the canvas is stubbed and the assertion is the bytes that reached it. */
  const drawn: Array<{ width: number; height: number }> = [];
  function stubCanvas() {
    drawn.length = 0;
    vi.stubGlobal("createImageBitmap", async (blob: Blob) => ({
      width: 100, height: 141, close: () => {}, blob,
    }));
    const proto = globalThis.HTMLCanvasElement.prototype as unknown as {
      getContext: unknown; toDataURL: unknown;
    };
    proto.getContext = () => ({
      fillStyle: "", fillRect: () => {},
      drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => drawn.push({ width: w, height: h }),
    });
    proto.toDataURL = () => "data:image/png;base64,STUB";
  }

  it("takes the picture the HEADER names, not just any picture in the file", async () => {
    stubCanvas();
    const file = docx([
      ["word/_rels/header1.xml.rels", rels("media/letterhead.png")],
      ["word/media/letterhead.png", png()],
      /* a photograph in the BODY — globbing `word/media/` would have to
         choose between the two, and choosing wrong puts somebody's holiday
         snap at the top of a صورت‌جلسه */
      ["word/media/body-photo.png", png()],
      ["word/document.xml", text("<w:document/>")],
    ]);
    const page = await derivePage(file);
    expect(page.sourceMime).toBe(DOCX);
    expect(page.dataUrl).toBe("data:image/png;base64,STUB");
    expect(drawn).toHaveLength(1);
  });

  it("refuses a Word file whose header names two pictures, by name", async () => {
    stubCanvas();
    const file = docx([
      ["word/_rels/header1.xml.rels", text(
        `<Relationships><Relationship Id="r1" Target="media/logo.png"/><Relationship Id="r2" Target="media/stamp.png"/></Relationships>`,
      )],
      ["word/media/logo.png", png()],
      ["word/media/stamp.png", png()],
    ]);
    /* a LOGO and a STAMP: picking the first is the quiet guess that produces
       a document with the wrong thing at the top. The refusal carries a code
       the screen turns into the one step that fixes it. */
    await expect(derivePage(file)).rejects.toThrow(SheetError);
    await expect(derivePage(file)).rejects.toMatchObject({ code: "sheet_unreadable_docx" });
  });

  it("refuses a Word file with no header picture at all", async () => {
    stubCanvas();
    const file = docx([["word/document.xml", text("<w:document/>")]]);
    await expect(derivePage(file)).rejects.toMatchObject({ code: "sheet_unreadable_docx" });
  });

  it("refuses a file type it cannot read, rather than storing something wrong", async () => {
    stubCanvas();
    const file = new File(["not a sheet"], "sheet.txt", { type: "text/plain" });
    await expect(derivePage(file)).rejects.toMatchObject({ code: "sheet_unsupported" });
  });

  it("takes an image as the page it already is", async () => {
    stubCanvas();
    const file = new File([png() as unknown as BlobPart], "sheet.png", { type: "image/png" });
    const page = await derivePage(file);
    expect(page.sourceMime).toBe("image/png");
    expect(page.mime).toBe("image/png");
    /* scaled DOWN only: a 100×141 letterhead is not stretched to 1600px and
       printed as a blur */
    expect(drawn).toEqual([{ width: 100, height: 141 }]);
  });
});
