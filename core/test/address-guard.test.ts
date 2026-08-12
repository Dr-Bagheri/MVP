/**
 * SSRF guard for webhook delivery (steward finding, M17).
 *
 * The finding's sharp half: `webhook_delivery.response_code` is stored and
 * admin-readable, so an unguarded delivery is a **port-scan oracle** for the
 * internal network — register, read the code, repeat. https-only does not
 * close that; `https://10.0.0.5/` is a valid https URL.
 */
import { describe, expect, it } from "vitest";

import {
  assertDeliverableUrl, BlockedAddressError, guardedLookup, isBlockedAddress,
} from "../src/net/address-guard.ts";

describe("which addresses we refuse to be pointed at", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["0.0.0.0", "this network"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.254", "private, top of range"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "cloud metadata — the highest-value SSRF target there is"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["224.0.0.1", "multicast"],
    ["::1", "IPv6 loopback"],
    ["fe80::1", "IPv6 link-local"],
    ["fd00::1", "IPv6 unique-local"],
    ["::ffff:10.0.0.1", "IPv4-mapped private — every v4 rule bypassed by spelling"],
  ])("blocks %s (%s)", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([["8.8.8.8"], ["1.1.1.1"], ["172.32.0.1"], ["2606:4700::1111"]])(
    "allows the public address %s",
    (address) => {
      // The negative half matters as much: a guard that blocks everything
      // passes every "does it block?" test and delivers no webhook ever.
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it("treats a non-address as blocked rather than guessing", () => {
    expect(isBlockedAddress("localhost")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("10.0.0")).toBe(true);
  });
});

describe("registration-time checks", () => {
  it("accepts a normal https url", () => {
    expect(assertDeliverableUrl("https://hooks.example.com/echo").hostname)
      .toBe("hooks.example.com");
  });

  it("refuses http, credentials, and a literal private address", () => {
    expect(() => assertDeliverableUrl("http://example.com")).toThrow(BlockedAddressError);
    // credentials end up in logs and in the admin UI, and are a classic way
    // to smuggle a different host past a naive parser
    expect(() => assertDeliverableUrl("https://user:pw@example.com")).toThrow(/credentials/);
    expect(() => assertDeliverableUrl("https://10.0.0.5/hook")).toThrow(/private or reserved/);
    expect(() => assertDeliverableUrl("https://[::1]/hook")).toThrow(/private or reserved/);
    expect(() => assertDeliverableUrl("not a url")).toThrow(BlockedAddressError);
  });

  it("does NOT resolve a hostname here — that guarantee would be stale", () => {
    // A parse-time DNS check implies a promise DNS can revoke a millisecond
    // later (rebinding). A public-looking hostname passes registration; the
    // control is at connect time.
    expect(() => assertDeliverableUrl("https://rebind.example.test/hook")).not.toThrow();
  });
});

describe("the actual control: connect-time lookup", () => {
  const lookupOf = (hostname: string) =>
    new Promise<{ error: NodeJS.ErrnoException | null; addresses: unknown }>((resolve) => {
      guardedLookup(hostname, {}, (error, addresses) => { resolve({ error, addresses }); });
    });

  it("refuses a hostname that resolves to loopback", async () => {
    // `localhost` is the honest local stand-in for a rebinding target: a name
    // that resolves into a blocked range at the moment of connection.
    const { error } = await lookupOf("localhost");
    expect(error).toBeTruthy();
    expect((error as NodeJS.ErrnoException).code).toBe("EBLOCKED");
    expect(error!.message).toMatch(/blocked address/);
  });

  it("passes a public hostname through with its addresses", async () => {
    const { error, addresses } = await lookupOf("example.com");
    // Positive assertion: the guard must still deliver webhooks. A test that
    // only proves it blocks would be satisfied by a guard that blocks all.
    expect(error).toBeNull();
    expect(Array.isArray(addresses)).toBe(true);
    expect((addresses as unknown[]).length).toBeGreaterThan(0);
  }, 15_000);
});
