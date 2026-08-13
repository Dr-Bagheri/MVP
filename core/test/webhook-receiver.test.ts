/**
 * Does the signature we send actually verify for someone following the docs?
 *
 * Every existing signing test checks `verifyDelivery` against `signDelivery` —
 * both ours, both in one file. That proves our signer agrees with our verifier,
 * which it would even if the documented algorithm were something else entirely.
 * The claim that matters to a customer is different: **a stranger implementing
 * the published spec can validate what we send.**
 *
 * So this exercises the receiver's own implementation — written in Deno against
 * the docs, using WebCrypto and nothing of ours — against real output from the
 * real signer. It runs here, before any deploy, so the Edge Function is not the
 * first place the two implementations ever meet.
 */
import { describe, expect, it } from "vitest";

import { signDelivery, REPLAY_TOLERANCE_SECONDS } from "../src/worker/webhook-signing.ts";
import { verifyDelivery } from "../supabase/functions/echo-webhook-probe/verify.ts";

// Shaped like a real delivery: identifiers and status ONLY (M17's outbound
// twin of no-content-in-logs). No transcript text ever rides this wire.
const BODY = JSON.stringify({
  event: "call.ready",
  call_id: "3f000000-0000-4000-8000-00000000000c",
  org_id: "0d000000-0000-4000-8000-00000000000d",
  status: "ready",
});

const SECRET = "9f2b7c1d4e6a8b0c2d4e6f8a0b1c3d5e7f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c";
const AT = 1_786_000_000;

describe("an integrator following the docs can verify what we send", () => {
  it("accepts a genuine delivery", async () => {
    const header = signDelivery(SECRET, BODY, AT);
    expect(await verifyDelivery(SECRET, BODY, header, { nowSeconds: AT })).toBe("ok");
  });

  it("REFUSES a tampered body — one flipped character", async () => {
    // The whole point of the signature. A receiver that cannot fail this is a
    // receiver that validates nothing, and a harness pointed at it is vacuous.
    const header = signDelivery(SECRET, BODY, AT);
    const tampered = BODY.replace('"ready"', '"failed"');
    expect(tampered).not.toBe(BODY);
    expect(await verifyDelivery(SECRET, tampered, header, { nowSeconds: AT })).toBe("mismatch");
  });

  it("REFUSES a tampered signature — one flipped hex digit", async () => {
    const header = signDelivery(SECRET, BODY, AT);
    const flipped = header.replace(/v1=(.)/, (_m, c: string) => `v1=${c === "0" ? "1" : "0"}`);
    expect(flipped).not.toBe(header);
    expect(await verifyDelivery(SECRET, BODY, flipped, { nowSeconds: AT })).toBe("mismatch");
  });

  it("REFUSES a replay outside the tolerance", async () => {
    const header = signDelivery(SECRET, BODY, AT);
    const later = AT + REPLAY_TOLERANCE_SECONDS + 1;
    expect(await verifyDelivery(SECRET, BODY, header, { nowSeconds: later })).toBe("stale");
    // Still inside the window, still fine — the boundary is a boundary.
    expect(
      await verifyDelivery(SECRET, BODY, header, { nowSeconds: AT + REPLAY_TOLERANCE_SECONDS }),
    ).toBe("ok");
  });

  it("REFUSES a FUTURE-dated delivery as firmly as an old one", async () => {
    // Only checking the past accepts a forged future timestamp that stays
    // valid indefinitely — which is worse than no replay window at all.
    const header = signDelivery(SECRET, BODY, AT + 10_000);
    expect(await verifyDelivery(SECRET, BODY, header, { nowSeconds: AT })).toBe("stale");
  });

  it("REFUSES a signature made with a different key", async () => {
    const header = signDelivery(`${SECRET.slice(0, -1)}d`, BODY, AT);
    expect(await verifyDelivery(SECRET, BODY, header, { nowSeconds: AT })).toBe("mismatch");
  });

  it("names a malformed header as malformed, not as a bad MAC", async () => {
    // Three different bugs share one status code on the wire; the receiver
    // still has to tell them apart on our side.
    for (const header of ["", "garbage", "t=abc,v1=deadbeef", "v1=deadbeef", `t=${AT}`]) {
      expect(await verifyDelivery(SECRET, BODY, header, { nowSeconds: AT })).toBe("malformed");
    }
  });

  it("treats a non-hex signature as a mismatch rather than throwing", async () => {
    const header = `t=${AT},v1=zzzz`;
    expect(await verifyDelivery(SECRET, BODY, header, { nowSeconds: AT })).toBe("mismatch");
  });
});
