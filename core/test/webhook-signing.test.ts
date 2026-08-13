/**
 * The signature an integrator has to reimplement from our docs.
 *
 * Every assertion is positive and concrete — a scheme test that only checks
 * "a tampered body fails" is satisfied by a verifier that rejects everything.
 */
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import {
  REPLAY_TOLERANCE_SECONDS,
  parseSignature,
  signDelivery,
  verifyDelivery,
} from "../src/worker/webhook-signing.ts";

const KEY = "b3c1f0a9d2e4c6b8a0f1e3d5c7b9a1f3e5d7c9b1a3f5e7d9c1b3a5f7e9d1c3b5";
const BODY = JSON.stringify({ event: "call.ready", call_id: "c-1" });
const T = 1_780_000_000;

describe("the signature an integrator verifies", () => {
  it("is exactly HMAC-SHA256 over `{t}.{body}` keyed by secret_sha256", () => {
    // Computed independently of the implementation: if these ever diverge, the
    // documented algorithm is what an integrator implemented and we are wrong.
    const expected = createHmac("sha256", KEY).update(`${T}.${BODY}`).digest("hex");
    expect(signDelivery(KEY, BODY, T)).toBe(`t=${T},v1=${expected}`);
  });

  it("carries the timestamp and a VERSION prefix in the header", () => {
    // `v1=` is the seam for asymmetric signing later — receivers accepting
    // both during a rotation is what stops that change breaking integrations.
    const parsed = parseSignature(signDelivery(KEY, BODY, T));
    expect(parsed).toEqual({ t: T, v1: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("verifies a delivery it just signed", () => {
    expect(verifyDelivery(KEY, BODY, signDelivery(KEY, BODY, T), { nowSeconds: T })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const header = signDelivery(KEY, BODY, T);
    expect(verifyDelivery(KEY, `${BODY} `, header, { nowSeconds: T })).toBe(false);
  });

  it("rejects a different key", () => {
    const header = signDelivery(KEY, BODY, T);
    expect(verifyDelivery(`${KEY.slice(0, -1)}0`, BODY, header, { nowSeconds: T })).toBe(false);
  });
});

describe("replay protection", () => {
  it("accepts a delivery inside the tolerance window", () => {
    const header = signDelivery(KEY, BODY, T);
    const late = T + REPLAY_TOLERANCE_SECONDS - 1;
    expect(verifyDelivery(KEY, BODY, header, { nowSeconds: late })).toBe(true);
  });

  it("rejects a captured delivery replayed later", () => {
    // Without the timestamp inside the MAC this passes forever, and "verify
    // the signature" gives the integrator false comfort — worse than no
    // signature, because they stop looking.
    const header = signDelivery(KEY, BODY, T);
    const muchLater = T + REPLAY_TOLERANCE_SECONDS + 1;
    expect(verifyDelivery(KEY, BODY, header, { nowSeconds: muchLater })).toBe(false);
  });

  it("rejects a FUTURE-dated delivery just as firmly", () => {
    // Only checking the past accepts a forged future timestamp that stays
    // valid indefinitely — the replay window reopened from the other side.
    const header = signDelivery(KEY, BODY, T + 10_000);
    expect(verifyDelivery(KEY, BODY, header, { nowSeconds: T })).toBe(false);
  });

  it("cannot be replayed by moving the timestamp, because t is signed", () => {
    // Rewriting `t` to now keeps the MAC from the original moment, so the two
    // no longer agree. This is the whole point of signing `{t}.{body}`.
    const original = signDelivery(KEY, BODY, T);
    const v1 = parseSignature(original)!.v1;
    const forged = `t=${T + 10_000},v1=${v1}`;
    expect(verifyDelivery(KEY, BODY, forged, { nowSeconds: T + 10_000 })).toBe(false);
  });
});

describe("malformed headers", () => {
  it("refuses rather than throwing", () => {
    for (const header of ["", "garbage", "t=abc,v1=zz", `t=${T}`, `v1=abcd`]) {
      expect(verifyDelivery(KEY, BODY, header, { nowSeconds: T })).toBe(false);
    }
  });

  it("refuses a signature of the wrong length without throwing", () => {
    // timingSafeEqual THROWS on a length mismatch; an uncaught throw here
    // would turn a bad signature into a 500 instead of a rejection.
    expect(verifyDelivery(KEY, BODY, `t=${T},v1=ab`, { nowSeconds: T })).toBe(false);
  });
});
