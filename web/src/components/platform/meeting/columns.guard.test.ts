import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE COLUMN RHYTHM ACROSS A MEETING.
 *
 * The plan and the live stage sit on the same two columns, so the rail does
 * not change width under the person as they walk from step 1 to step 2. That
 * used to be two hand-written ratios — `1.4fr 1fr` on the plan and
 * `1fr 280px` on the stage — which put the rail 150px narrower one click
 * later, on the screen where the person is least able to look away and check.
 *
 * The ratio itself is the reference product's, measured on its own pre page
 * (604.797px / 403.203px = 3:2 exactly), not a number picked here.
 *
 * This guard is a grep because that is the failure it catches: the next
 * author reaches for a literal `grid-cols-[…]` rather than the constant, the
 * page still renders, every test stays green, and the rhythm is gone. Only
 * reading the source can see a divergence that has no wrong pixel of its own
 * — each half looks right alone.
 */
const SOURCE = readFileSync(
  join(process.cwd(), "src", "components", "platform", "MeetingPage.tsx"), "utf8",
);

describe("the meeting's two columns", () => {
  it("are named constants, one per stage, each used exactly once", () => {
    /* TWO ratios and not one: the plan's rail carries as much as its main
       column, the stage's rail is a strip beside a canvas. What must not
       come back is the LITERAL — a screen picking its own ratio is how the
       rail changed width under the person between step 1 and step 2. */
    const plan = SOURCE.match(/const PLAN_COLUMNS = "([^"]+)"/);
    const stage = SOURCE.match(/const STAGE_COLUMNS = "([^"]+)"/);
    expect(plan, "PLAN_COLUMNS must be declared in MeetingPage.tsx").not.toBeNull();
    expect(stage, "STAGE_COLUMNS must be declared in MeetingPage.tsx").not.toBeNull();
    expect(plan![1]).toBe("lg:grid-cols-[1.5fr_1fr]");
    expect(stage![1]).toBe("lg:grid-cols-[4fr_1fr]");
    /* PLAN_COLUMNS is worn TWICE since 2026-09-03: by the plan and by the
       page's loading frame, which draws the plan's two columns as skeletons
       so nothing moves when the record lands. That second use is the rule
       working, not a violation — the frame wearing a literal would be the
       exact drift this guard exists to catch (a skeleton 150px off from the
       columns it stands in for). "Exactly once" was only ever a proxy for
       "never a literal", and the negative half below is the real rule. */
    expect(SOURCE.match(/\$\{PLAN_COLUMNS\}/g) ?? []).toHaveLength(2);
    expect(SOURCE.match(/\$\{STAGE_COLUMNS\}/g) ?? []).toHaveLength(1);
  });

  it("leaves no hand-written column ratio behind to disagree with them", () => {
    /* The NEGATIVE half, and the one that actually fires: a literal
       `lg:grid-cols-[…]` anywhere in this file is a second opinion about a
       width the constant already decides.
       The declaration is cut from its own corpus first — the constant holds
       the very string this searches for, so a scan of the whole file reports
       the one line that is CORRECT and fires on every green tree. It failed
       exactly that way on its first run. */
    const corpus = SOURCE
      .replace(/const PLAN_COLUMNS = "[^"]+";/, "")
      .replace(/const STAGE_COLUMNS = "[^"]+";/, "");
    const literals = corpus.match(/"[^"]*lg:grid-cols-\[[^\]]+\][^"]*"/g) ?? [];
    expect(literals, `hand-written column ratios: ${literals.join(" | ")}`).toHaveLength(0);
  });
});
