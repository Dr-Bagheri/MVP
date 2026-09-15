import { describe, expect, it } from "vitest";
import { plausibleZone } from "./zone";

describe("plausibleZone — the shape an IANA name can take", () => {
  it("passes the zones browsers actually resolve", () => {
    for (const zone of [
      "Asia/Tehran",
      "UTC",
      "America/Argentina/Buenos_Aires",
      "Etc/GMT+3",
      "America/Port-au-Prince",
    ]) {
      expect(plausibleZone(zone), zone).toBe(zone);
    }
  });

  it("trims what it accepts", () => {
    expect(plausibleZone("  Asia/Tehran ")).toBe("Asia/Tehran");
  });

  it("drops what an IANA name can never be — the control", () => {
    /* each is a different way of not being a zone; a helper that accepted
       any of them would be passing a shape check that checks nothing */
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "   ",
      "Asia\nTehran",
      "Asia Tehran",
      "Asia/Tehran; drop table",
      "/Asia",
      "Asia/",
      "A".repeat(65),
      "🙂/Tehran",
    ]) {
      expect(plausibleZone(bad), String(bad)).toBeUndefined();
    }
  });

  it("keeps exactly the maximum length", () => {
    const edge = "A".repeat(64);
    expect(plausibleZone(edge)).toBe(edge);
  });
});
