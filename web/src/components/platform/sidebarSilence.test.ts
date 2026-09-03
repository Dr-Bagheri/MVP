import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sidebarIsSilentOn } from "./AssistantSidebar";

/**
 * Where the assistant sidebar appears, and where it must not.
 *
 * This replaces `orbSilence.test.ts`, and the rule it checks has TWO reasons
 * where the orb's had three:
 *
 *  1. **the platform shell does not render there** — the auth pages, the guest
 *     door, the vendor console. No content column to step aside, so a fixed
 *     strip would lie over the page rather than beside it.
 *  2. **the page IS this conversation** — /assistant alone. A strip there
 *     offers to open a second copy of what fills the screen (user directive,
 *     2026-09-03: "in assistant page there is no need for assistant side bar").
 *
 * What went is the orb's WIDER version of reason 2: it was silent on
 * `/conversations`, `/workflows`, `/agents` and `/integrations` too, because
 * "an orb is a second door to the room you are standing in — one whose panel
 * covers the thing it duplicates". A docked column does not cover what it sits
 * beside, and those surfaces are ABOUT the assistant rather than being it.
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

  it("is silent on /assistant ALONE among the assistant's surfaces", () => {
    /*
     * TWO CHANGES, one line apart, and asserting them together is the point.
     *
     * The orb was silent on every assistant-adjacent surface, on the reasoning
     * that it was "a second door to the room you are standing in". A docked
     * column is not a door, so the sidebar SPEAKS on conversations, workflows,
     * agents and integrations — they are ABOUT the assistant rather than being
     * it.
     *
     * /assistant is the exception the user named (2026-09-03): that page IS
     * this conversation at full width, so a strip beside it would offer to
     * open a second copy of what is already on screen. One surface, and the
     * neighbours below are what stop that becoming the orb's over-wide rule
     * again.
     */
    expect(sidebarIsSilentOn("/fa/assistant"), "/fa/assistant").toBe(true);
    expect(sidebarIsSilentOn("/en/assistant"), "/en/assistant").toBe(true);
    for (const route of [
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
