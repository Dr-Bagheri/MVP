import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * THE VIDEO ROOM'S TWO FACTS, both learned the same way: by pressing the
 * button on the live product and reading what came back.
 *
 * 1. The calendar scope must be the WRITE one. The room is a calendar event
 *    carrying a conference request — Google mints the Meet link and returns
 *    it on the created event — and `calendar.events.readonly` cannot insert
 *    one. The first live press returned 502 with a Google account that was
 *    connected, working, and drafting mail.
 *
 * 2. A 403 from the provider must reach the caller as a NAMED refusal.
 *    `provider_refused` alone becomes an upstream fault, which is true of
 *    the transport and useless to the reader: nothing is broken, a
 *    permission was never granted, and the generic sentence sent a person
 *    to check a connection that was fine. Different nothings.
 *
 * Both are asserted against the source rather than a live provider: this is
 * the default suite, and the live lane is opt-in. What makes them worth
 * having is that each states the thing that was WRONG, so the scope cannot
 * quietly revert to readonly and the translation cannot quietly widen to
 * every status.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL("../src/api/connectors.ts", import.meta.url)), "utf8",
);

describe("the video room's calendar grant", () => {
  it("asks for the WRITE scope, and no longer for the read-only one", () => {
    expect(SOURCE).toContain('"https://www.googleapis.com/auth/calendar.events",');
    /* the exact string that could not create a room. `.readonly` is a
       superset match of the write scope, so this asserts the suffix rather
       than the name — the trap that makes a grep agree with itself */
    expect(SOURCE).not.toContain("calendar.events.readonly");
  });

  it("derives can_meet from what was GRANTED, in both places status is built", () => {
    /* Two call sites — the list and the freshly-connected row — and a
       capability true in one and absent in the other is how a screen offers
       a button that fails at the provider.
       The DERIVATION is what is counted, not the word: `can_meet:` alone
       matched three times on a clean tree, because the interface declares
       the field with the same spelling. A name matching itself, on its
       first run, in a test written by someone who had corrected exactly
       that in two other files an hour earlier. */
    const derivations = SOURCE.match(/can_meet: provider === "google"/g) ?? [];
    expect(derivations.length).toBe(2);
    expect(SOURCE).toContain('const MEET_SCOPE = "https://www.googleapis.com/auth/calendar.events"');
  });
});

describe("a provider refusal on the room", () => {
  it("translates 403 — and ONLY 403 — into the named scope refusal", () => {
    const guard = SOURCE.slice(
      SOURCE.indexOf("async function withScopeCheck"),
      SOURCE.indexOf("/** The scope each provider's drafting needs"),
    );
    expect(guard).toContain('refusal.providerStatus === 403');
    expect(guard).toContain('code: "meet_scope_missing"');
    /* the NEGATIVE half, and the one that matters: a 500 from Google is an
       outage, and calling that a scope problem sends someone to re-consent
       their way out of somebody else's incident */
    expect(guard).toContain("throw error;");
  });

  it("wraps the room's own insert, so the translation is reachable at all", () => {
    /* A helper nobody calls is the shape this repo has shipped before. */
    expect(SOURCE).toContain("await withScopeCheck(providerFetch(");
  });
});
