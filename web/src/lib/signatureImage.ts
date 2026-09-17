/**
 * A PERSON'S SIGNATURE, as the document can carry it (db/0229).
 *
 * "their real signature that uploaded in jpg or png" — so the file is a
 * picture of a hand, and what is stored is the picture brought down to the
 * size a signature line needs. Two things this does on purpose, and one it
 * does not:
 *
 *   · it SHRINKS: a phone photograph of a signed page is twelve megapixels,
 *     and a signature in a table cell is fourteen millimetres tall. The
 *     longest edge lands at `SIGNATURE_MAX_PX`, a third of the column's
 *     megabyte at worst and a few kilobytes for a clean scan;
 *   · it KEEPS TRANSPARENCY: a PNG with a cut-out background is the best
 *     kind of signature, because on the printed page it sits over the
 *     organisation's own paper rather than in a white box on top of it — so,
 *     unlike the letterhead (lib/letterhead.ts), the canvas is NOT filled
 *     white first. A JPEG has no alpha and arrives with whatever ground the
 *     scan had, which is also what the person sees in the preview;
 *   · it does NOT crop, straighten or threshold. A signature is exactly what
 *     the person uploaded, and a picture that has been "cleaned" is one they
 *     did not sign with.
 *
 * Nothing here talks to the server: the server sniffs the bytes it is given
 * and decides the MIME itself (the letterhead's rule).
 */

/** what the profile's picker accepts — the two the directive named, and
    WebP because it is the third thing a phone exports */
export const SIGNATURE_ACCEPT = "image/png,image/jpeg,image/webp";

/** the derived picture's longest edge — a signature line is ~50mm wide and
    prints sharp from this, and a PNG this size is well under 0229's megabyte */
export const SIGNATURE_MAX_PX = 900;

/** a refusal the screen can translate — a code, never a sentence */
export class SignatureError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SignatureError"; }
}

export interface DerivedSignature {
  /** a PNG data URL — previewed before it is ever uploaded */
  dataUrl: string;
  /** the same picture's base64, which is what the upload routes take */
  base64: string;
  widthPx: number;
  heightPx: number;
}

export async function deriveSignature(file: File): Promise<DerivedSignature> {
  const type = file.type;
  if (type !== "image/png" && type !== "image/jpeg" && type !== "image/webp") {
    throw new SignatureError("signature_unsupported");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([await file.arrayBuffer()], { type }));
  } catch {
    throw new SignatureError("signature_unreadable");
  }
  const scale = Math.min(1, SIGNATURE_MAX_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new SignatureError("signature_unreadable");
  /* no white fill — see the header: the transparency IS the feature */
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/png");
  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    widthPx: width,
    heightPx: height,
  };
}
