import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every surface that lists workflows renders their names through
 * `workflowCopy`, never the stored string.
 *
 * ── the bug this exists for ───────────────────────────────────────────────
 * Reported from the English UI: the agent panel's INSTALLED list showed
 * Persian workflow names directly above a catalogue list that localized
 * correctly. Those rows come from `echo.workflow`, whose `name` is the
 * Persian a shipped starter was seeded with, and three of the four lists on
 * those two screens rendered it raw. The one that did it right sat inches
 * below the ones that did not.
 *
 * ── why this is a SOURCE check and not a rendering one ────────────────────
 * The test harness stubs next-intl with `fa.json` and only `fa.json`. For a
 * shipped starter the catalogue string and the stored string are then the
 * same characters, so a raw render and a localized one are
 * indistinguishable on screen — a rendering test would pass against the bug
 * and could never fail for its own reason.
 *
 * The other direction IS visible there and is asserted in
 * `AgentOverviewPanel.test.tsx`: a workflow an org RENAMED keeps its own
 * words, because `workflowCopy` substitutes the catalogue only while the
 * stored name still equals the seeded one.
 *
 * So this reads the source and asks a narrow question: does any of these
 * files interpolate a workflow's `.name` directly into JSX? It matches the
 * FORM a raw render takes rather than the word "name", which appears in
 * types, props and comments throughout — the name-matching-itself trap.
 */
const FILES = ["./AgentOverviewPanel.tsx", "./AgentEditor.tsx"];

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

/** `{row.name}` / `{workflow.name}` inside JSX — a stored string, rendered. */
const RAW = /\{\s*(?:row|workflow|w)\.name\s*\}/g;

describe("workflow names are localized wherever they are listed", () => {
  for (const file of FILES) {
    it(`${file} renders no workflow name raw`, () => {
      const raw = [...read(file).matchAll(RAW)].map((m) => m[0]);
      expect(raw, `${file} interpolates a stored name directly: ${raw.join(", ")}`)
        .toEqual([]);
    });
  }

  it("every listing file actually calls the localizer", () => {
    /*
     * The had-something-to-check half. The assertions above are
     * empty-list checks, and a file that listed no workflows at all would
     * satisfy them perfectly — including one where somebody deleted the
     * lists. This asserts the positive: the localizer is present and used.
     */
    for (const file of FILES) {
      const source = read(file);
      expect(source, file).toContain("useWorkflowCopy");
      expect((source.match(/workflowCopy\(/g) ?? []).length, file).toBeGreaterThan(0);
    }
  });

  it("can tell a raw render from a localized one — the control", () => {
    /*
     * The question it must answer NO to. Without this the regex could be
     * wrong in a way that matches nothing, and both checks above would pass
     * against every possible source file.
     */
    expect([...`<span>{workflow.name}</span>`.matchAll(RAW)]).toHaveLength(1);
    expect([...`<span>{workflowCopy(workflow).name}</span>`.matchAll(RAW)]).toHaveLength(0);
  });
});
