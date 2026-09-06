import { describe, expect, it } from "vitest";
import { AREAS, PLATFORM_MAP, REACH_RULE, areaOf, floorInstruction } from "../src/agent/platform-map.ts";
import { CLIENT_TOOL_NAMES } from "../src/agent/client-tools.ts";
import { DOMAIN_TOOL_NAMES } from "../src/agent/domain-tools.ts";
import { createWriteTools } from "../src/agent/write-tools.ts";
import { toolsFor } from "../src/agent/platform-tools.ts";

/**
 * THE MAP COVERS THE PRODUCT (user, 2026-09-06: "understand all parts of the
 * platform"). Coverage is DERIVED from the registries — every tool the
 * platform registers must fall under an area, and every area must be a
 * paragraph — so a new family of tools with no paragraph fails here rather
 * than leaving the agents ignorant of a room somebody just built.
 *
 * Its first run found five tools no area claimed (whoami_surface,
 * mark_notification_read, create_person, set_model_allowed,
 * set_role_permission) — a true positive before any green.
 */
const registered = [
  ...CLIENT_TOOL_NAMES,
  ...DOMAIN_TOOL_NAMES,
  ...createWriteTools().map((t) => t.name),
  ...toolsFor().map((t) => t.name),
];

describe("the platform map", () => {
  it("had something to check", () => {
    expect(registered.length).toBeGreaterThan(60);
    expect(AREAS.length).toBeGreaterThan(5);
  });

  it("every registered tool falls under an area of the map", () => {
    const orphans = registered.filter((name) => areaOf(name) === null);
    expect(orphans, "a tool family the map does not describe").toEqual([]);
  });

  it("every area is a paragraph the agents actually read", () => {
    for (const area of AREAS) {
      /* the heading opens its paragraph; a Persian word may follow it */
      expect(PLATFORM_MAP, area.key).toContain(`· ${area.heading}`);
    }
  });

  it("the control: a made-up tool has no area, so the coverage check can fail", () => {
    expect(areaOf("launch_rocket")).toBeNull();
  });

  it("the reach rule forbids the sentence the user kept hearing", () => {
    expect(REACH_RULE).toMatch(/never say/i);
    expect(REACH_RULE).toContain("«دسترسی ندارم»");
    expect(REACH_RULE).toMatch(/THEIR role does not allow it/);
  });

  it("a called colleague is told how to arrive and how to stay", () => {
    const alone = floorInstruction("رؤیا", []);
    expect(alone).toContain("greet in one short sentence");
    expect(alone).toContain("until they name somebody else");
    const together = floorInstruction("رؤیا", ["آوا"]);
    expect(together).toContain("آوا is in this conversation too");
  });
});
