import { describe, expect, it, vi } from "vitest";
import { deriveSignature, SIGNATURE_MAX_PX, SignatureError } from "./signatureImage";

/**
 * A SIGNATURE, brought down to size and otherwise left alone (db/0229).
 *
 * jsdom paints nothing, so the canvas is stubbed and the assertions are
 * about what reached it: the size it was asked to draw at, and — the one
 * that matters here — whether anything was painted UNDER the picture.
 */
describe("a person's signature, as the document can carry it", () => {
  const drawn: Array<{ width: number; height: number }> = [];
  const filled: string[] = [];
  function stubCanvas(size: { width: number; height: number }) {
    drawn.length = 0;
    filled.length = 0;
    vi.stubGlobal("createImageBitmap", async () => ({ ...size, close: () => {} }));
    const proto = globalThis.HTMLCanvasElement.prototype as unknown as {
      getContext: unknown; toDataURL: unknown;
    };
    proto.getContext = () => ({
      fillStyle: "",
      fillRect: () => filled.push("fill"),
      drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => drawn.push({ width: w, height: h }),
    });
    proto.toDataURL = () => "data:image/png;base64,U0lH";
  }
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "sig.png", { type: "image/png" });

  it("shrinks a photograph to the signature line and keeps a small scan as it is", async () => {
    stubCanvas({ width: 4000, height: 1500 });
    const big = await deriveSignature(png());
    expect(big.widthPx).toBe(SIGNATURE_MAX_PX);
    expect(big.heightPx).toBe(Math.round(1500 * (SIGNATURE_MAX_PX / 4000)));
    expect(drawn[0]).toEqual({ width: big.widthPx, height: big.heightPx });

    stubCanvas({ width: 300, height: 90 });
    const small = await deriveSignature(png());
    /* never UP: a scan is the resolution it is, and enlarging it invents
       pixels */
    expect(small.widthPx).toBe(300);
    expect(small.heightPx).toBe(90);
  });

  it("paints NOTHING under the picture — the transparency is the feature", async () => {
    /* the letterhead fills white first (paper); a signature must not, or a
       cut-out PNG lands on the printed page inside a white box over the
       organisation's own paper. The assertion is the absence of the fill
       the sibling module makes. */
    stubCanvas({ width: 300, height: 90 });
    await deriveSignature(png());
    expect(filled).toHaveLength(0);
    expect(drawn).toHaveLength(1);
  });

  it("hands back the base64 the upload route takes, cut from its own data URL", async () => {
    stubCanvas({ width: 300, height: 90 });
    const derived = await deriveSignature(png());
    expect(derived.dataUrl).toBe("data:image/png;base64,U0lH");
    expect(derived.base64).toBe("U0lH");
  });

  it("refuses what it cannot read, by name", async () => {
    stubCanvas({ width: 300, height: 90 });
    const pdf = new File(["%PDF"], "sig.pdf", { type: "application/pdf" });
    await expect(deriveSignature(pdf)).rejects.toThrow(SignatureError);
    await expect(deriveSignature(pdf)).rejects.toMatchObject({ code: "signature_unsupported" });

    vi.stubGlobal("createImageBitmap", async () => { throw new Error("decode"); });
    await expect(deriveSignature(png())).rejects.toMatchObject({ code: "signature_unreadable" });
  });
});
