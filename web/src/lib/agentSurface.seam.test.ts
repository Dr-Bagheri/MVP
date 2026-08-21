import { describe, expect, it } from "vitest";
import { NAVIGABLE, SURFACE_TOOLS } from "./agentSurface";
// The PRODUCER's registry, imported directly (rule 10/13½): a hand-copied
// list here would be a second belief about the same wire — the thing every
// seam instrument in this repo exists to refuse.
import { CLIENT_TOOLS, CLIENT_TOOL_NAMES } from "../../../core/src/agent/client-tools";

describe("the client-tool seam (core registry ↔ web executor)", () => {
  it("every route core's navigate enum offers, the web executor will actually perform", () => {
    const navigate = CLIENT_TOOLS.find((t) => t.name === "navigate");
    expect(navigate).toBeDefined();
    const params = navigate!.parameters as {
      properties: { path: { enum?: string[] } };
    };
    const routes = params.properties.path.enum ?? [];
    // the enum exists — a description-only tool is back to model guessing
    expect(routes.length).toBeGreaterThan(10);
    const rejected = routes.filter((route) => !NAVIGABLE.test(route));
    // a route the model can choose but the executor refuses would be
    // "navigation failed" with no wrong party visible on either side
    expect(rejected).toEqual([]);
  });

  it("negative control: the seam test itself can tell a bad route from a good one", () => {
    expect(NAVIGABLE.test("/management/users")).toBe(true);
    expect(NAVIGABLE.test("/definitely/not/a/route")).toBe(false);
  });

  it("the surface advertises exactly the names core registers", () => {
    expect([...SURFACE_TOOLS].sort()).toEqual([...CLIENT_TOOL_NAMES].sort());
  });
});
