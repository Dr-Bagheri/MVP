import { describe, expect, it } from "vitest";

import { providerDef } from "../src/api/connector-providers.ts";
import { needsRefresh } from "../src/api/connectors.ts";

/**
 * WHETHER A CONNECTOR TOKEN IS RENEWED BEFORE USE (2026-09-10).
 *
 * Found on production: Slack read «متصل است» on the shelf with an expiry
 * twelve hours after the connect and every read since a 502. The definition
 * said Slack tokens never expire; the app has token rotation on, so they do —
 * and the refresh token that came with them sat unused because the rule
 * asked the spec and never the token. The Slack case is the load-bearing one
 * here; the rest is the behaviour the fix must not have changed.
 */
const NOW = Date.parse("2026-09-10T06:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const token = (over: { refreshToken?: string | null; expiresAt?: string | null }) => ({
  accessToken: "xoxe-…", refreshToken: "xoxe-1-refresh", expiresAt: at(-3_600_000), scopes: [],
  ...over,
});

describe("whether a connector token is renewed before use", () => {
  it("a refreshable provider's token is renewed when it is about to expire, and left alone while it has time", () => {
    expect(needsRefresh({ refreshable: true }, token({ expiresAt: at(30_000) }), NOW)).toBe(true);
    expect(needsRefresh({ refreshable: true }, token({ expiresAt: at(10 * 60_000) }), NOW)).toBe(false);
  });

  it("THE SLACK CASE: a token that came WITH a refresh token is renewed even where the definition expected none", () => {
    expect(needsRefresh({ refreshable: false }, token({}), NOW)).toBe(true);
  });

  it("a token with no expiry is never renewed — there is nothing to renew it for", () => {
    expect(needsRefresh({ refreshable: true }, token({ expiresAt: null }), NOW)).toBe(false);
    expect(needsRefresh({ refreshable: false }, token({ expiresAt: null }), NOW)).toBe(false);
  });

  it("an expiring token with NO refresh token, from a provider that offers none, is left alone — the provider then names the failure", () => {
    expect(needsRefresh({ refreshable: false }, token({ refreshToken: null }), NOW)).toBe(false);
  });

  it("an EXPIRED row is retried on its next use — a failed refresh must not brick the connection", () => {
    expect(needsRefresh({ refreshable: true }, token({ expiresAt: at(10 * 60_000) }), NOW, "expired")).toBe(true);
    /* the control: the same row while connected, with time left, is left alone */
    expect(needsRefresh({ refreshable: true }, token({ expiresAt: at(10 * 60_000) }), NOW, "connected")).toBe(false);
  });

  it("Slack's definition now says what its tokens do under rotation", () => {
    expect(providerDef("slack")?.oauth?.refreshable).toBe(true);
  });
});
