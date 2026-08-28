import { describe, expect, it } from "vitest";
import { orbIsSilentOn } from "./PresenceDock";

/**
 * Where the orb appears, and where it must not.
 *
 * The second half is the one worth a test: three separate user directives
 * have removed the orb from a surface, and each time the rule lived as an
 * early return nobody could see from outside. The negative control is the
 * point — a predicate that only ever says "silent" would satisfy every
 * assertion above it and be completely wrong.
 */
describe("orbIsSilentOn", () => {
  it("is silent on the assistant's own surfaces", () => {
    /* the assistant IS the page there; an orb is a second door to the room
       you are standing in (user directive, 2026-08-27) */
    for (const route of [
      "/fa/assistant",
      "/en/conversations",
      "/fa/workflows",
      "/en/workflows/draft-email-replies",
      "/fa/agents",
      "/en/integrations",
    ]) {
      expect(orbIsSilentOn(route), route).toBe(true);
    }
  });

  it("is silent at the root, which is the assistant's door", () => {
    /* `/` redirects to `/assistant`, so an orb rendered for the split second
       before the redirect is an orb on the assistant */
    expect(orbIsSilentOn("/fa")).toBe(true);
    expect(orbIsSilentOn("/en")).toBe(true);
  });

  it("stays silent on the operations room and on the way in", () => {
    expect(orbIsSilentOn("/en/platform")).toBe(true);
    expect(orbIsSilentOn("/fa/sign-in")).toBe(true);
    expect(orbIsSilentOn("/en/pending")).toBe(true);
  });

  it("SPEAKS everywhere else — the control", () => {
    /* without this the predicate could return true unconditionally and every
       assertion above would still pass, which is the whole failure mode this
       file exists to prevent */
    for (const route of [
      "/fa/echo",
      "/en/echo/records",
      "/fa/calls/abc-123",
      "/en/management",
      "/fa/management/users",
      "/en/settings",
      "/fa/profile",
      "/en/help",
    ]) {
      expect(orbIsSilentOn(route), route).toBe(false);
    }
  });

  it("does not mistake a longer name for one of its own", () => {
    /* `/agents` is silent; `/agentstore` would be a different page, and a
       prefix match without the boundary would silence it too */
    expect(orbIsSilentOn("/en/agentstore")).toBe(false);
    expect(orbIsSilentOn("/fa/workflows-archive")).toBe(false);
  });
});
