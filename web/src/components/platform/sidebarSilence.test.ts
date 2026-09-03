import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sidebarIsSilentOn } from "./AssistantSidebar";

/**
 * Where the assistant sidebar appears, and where it must not.
 *
 * This replaces `orbSilence.test.ts`, and the rule it checks is a smaller one
 * than the orb's. The orb's list had three reasons in it; the sidebar's has
 * one: **it is silent exactly where the platform shell does not render.**
 *
 * The clause that went is the assistant's own surfaces (`/assistant`,
 * `/conversations`, `/workflows`, `/agents`, `/integrations`). The orb was
 * silent there because "an orb is a second door to the room you are standing
 * in — one whose panel covers the thing it duplicates". A docked column does
 * not cover what it sits beside; the directive of 2026-09-03 is "in all
 * pages"; and the sidebar is now where AGENTS POST, so silencing it on
 * `/agents` would hide an agent's own message on the page about that agent.
 *
 * The negative control is the point of the file — a predicate that only ever
 * said "silent" would satisfy every positive assertion above it and be
 * completely wrong.
 */
describe("sidebarIsSilentOn", () => {
  it("is silent on the surfaces that render outside the shell", () => {
    for (const route of [
      "/fa/sign-in",
      "/en/sign-up",
      "/fa/reset",
      "/en/forgot",
      "/fa/pending",
      "/en/suspended",
      /* the guest join page: a stranger with a meeting code and no account.
         Every shell element there is a door that refuses, and offering doors
         that refuse is worse than offering none. */
      "/fa/join/ABC123",
      /* the vendor's operations room — not the product, and an org-scoped
         assistant has no authority in it */
      "/en/platform",
    ]) {
      expect(sidebarIsSilentOn(route), route).toBe(true);
    }
  });

  it("SPEAKS on the assistant's own surfaces now — the clause the orb had", () => {
    /* the change this pass makes, asserted as a change rather than left to be
       inferred from the absence of an entry */
    for (const route of [
      "/fa/assistant",
      "/en/conversations",
      "/fa/workflows",
      "/en/workflows/draft-email-replies",
      "/fa/agents",
      "/en/integrations",
      "/fa", // the landing page — the dashboard, inside the shell
      "/en",
    ]) {
      expect(sidebarIsSilentOn(route), route).toBe(false);
    }
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
      "/en/meetings/9f2",
      "/fa/tasks",
      "/en/help",
    ]) {
      expect(sidebarIsSilentOn(route), route).toBe(false);
    }
  });

  it("does not mistake a longer name for one of its own", () => {
    /* `/join` is silent; `/joined-meetings` would be a different page, and a
       prefix match without the boundary would silence it too */
    expect(sidebarIsSilentOn("/en/joined-meetings")).toBe(false);
    expect(sidebarIsSilentOn("/fa/platform-status")).toBe(false);
    expect(sidebarIsSilentOn("/en/sign-in-help")).toBe(false);
  });

  it("every silenced route still exists in the route tree", () => {
    /*
     * The stale-entry half. An allow-list naming a page that has been deleted
     * or moved reads as coverage and is a hole — the same rule the rhythm and
     * persian-type guards carry. This does not try to DERIVE the list from the
     * tree (a page reaches `PlatformShell` through TwoPane, EchoAppShell,
     * Agents and Workflows, so the derivation would be an import walk that
     * cries wolf the first time somebody adds a wrapper); it checks the
     * cheaper, non-flaky half: each silenced family names a real page file.
     */
    const APP = join(process.cwd(), "src", "app", "[locale]");
    const pages: Record<string, string> = {
      "(auth)/sign-in": "/sign-in",
      "(auth)/sign-up": "/sign-up",
      "(auth)/reset": "/reset",
      "(auth)/forgot": "/forgot",
      "(auth)/pending": "/pending",
      "(auth)/suspended": "/suspended",
      "join/[code]": "/join/ABC123",
      platform: "/platform",
    };
    const missing = Object.entries(pages)
      .filter(([dir]) => !existsSync(join(APP, dir, "page.tsx")))
      .map(([dir]) => dir);
    expect(missing, "silenced routes with no page file").toEqual([]);
    /* and each of those files' routes really is silenced — the two halves of
       the same entry, so a renamed directory cannot leave the predicate
       pointing at nothing while this test still passes */
    for (const route of Object.values(pages)) {
      expect(sidebarIsSilentOn(`/fa${route}`), route).toBe(true);
    }
  });
});
