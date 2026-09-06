import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScheduleFields } from "./TaskDialogs";

/**
 * The task detail's schedule dialog forces the schedule ON and used to pass
 * `onRepeats={() => undefined}` — a checkbox that ignored its press
 * (2026-09-06). Absent `onRepeats` now means no switch is drawn at all.
 */
describe("ScheduleFields — forced on means no switch", () => {
  it("draws the checkbox only when somebody will hear it", () => {
    const { rerender } = render(
      <ScheduleFields repeats gapDays="7" until={null} onRepeats={() => undefined} onGapDays={() => undefined} onUntil={() => undefined} />,
    );
    expect(screen.getByRole("checkbox")).toBeTruthy();
    rerender(
      <ScheduleFields repeats gapDays="7" until={null} onGapDays={() => undefined} onUntil={() => undefined} />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    /* the schedule's own fields are still there — only the dead switch went */
    expect(screen.getByRole("spinbutton")).toBeTruthy();
  });
});
