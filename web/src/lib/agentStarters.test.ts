import { describe, expect, it } from "vitest";
import { AGENT_STARTERS, STARTER_WORKFLOWS } from "../../../core/src/api/workflow-authoring.ts";
import { AGENT_STARTER_HANDLES } from "./agentStarters";
import { SEEDED_STARTERS } from "./workflowName";

/**
 * The parity that keeps `AGENT_STARTER_HANDLES` a mirror instead of a
 * belief — `workflowName.test.ts`'s pattern, applied to the menu: the
 * REAL producer is imported here in Node (it cannot enter the client
 * bundle, which is the whole reason the mirror exists) and compared
 * whole-object, both directions at once.
 */
describe("AGENT_STARTER_HANDLES mirrors core's AGENT_STARTERS", () => {
  it("every agent's menu matches the producer's, translated to handles, in order", () => {
    const fromCore = Object.fromEntries(
      Object.entries(AGENT_STARTERS).map(([agent, keys]) => [
        agent,
        keys.map((key) => STARTER_WORKFLOWS[key].handle),
      ]),
    );
    /* whole-object equality: an agent we invented and one core added are
       both failures — a per-agent loop over OUR keys could only ever
       check the agents we already knew about */
    expect(AGENT_STARTER_HANDLES).toEqual(fromCore);
  });

  it("every offered handle has display copy in SEEDED_STARTERS", () => {
    /* an option with no catalogue entry would render as nothing — the
       panel filters it out, so this is the check that keeps that filter
       from ever hiding a real menu entry */
    for (const [agent, handles] of Object.entries(AGENT_STARTER_HANDLES)) {
      for (const handle of handles) {
        expect(SEEDED_STARTERS[handle], `${agent}: ${handle}`).toBeDefined();
      }
    }
  });
});
