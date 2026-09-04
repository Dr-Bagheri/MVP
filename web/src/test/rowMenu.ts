import { fireEvent, screen } from "@testing-library/react";

/**
 * Open a table row's action menu the way a person does.
 *
 * Every `DataTable` that passes `menuItems` renders a ⋯ at the end of each row
 * (user directive, 2026-09-04: "instead of right click kebab menu for all
 * tables in the platform, at the end of the row add the three dot"). Before
 * that the gesture was a right-click, and five suites each wrote their own
 * `fireEvent.contextMenu` — so changing the affordance meant changing five
 * files that had independently learned the same thing.
 *
 * One helper, so the next change to how a row's menu opens is one edit. Going
 * through the real control is the point: a test that reached past it into the
 * items would keep passing after the only way in disappeared, which is exactly
 * how a table ends up with actions nobody can reach.
 *
 * POINTERDOWN, never `fireEvent.click` — that is the event a Radix trigger
 * opens on, and a click alone never reaches it.
 *
 * Dispatched directly rather than through `userEvent`, which schedules its own
 * delays on REAL timers: the voice-enrollment suite runs under
 * `vi.useFakeTimers()`, so a `userEvent.click` there waits for a clock nobody
 * is advancing and the test dies at the 5s limit with no hint that timers were
 * the cause. A helper used by six suites cannot assume any of them.
 */
export async function openRowMenu(cellText: string | RegExp): Promise<void> {
  const cell = screen.getByText(cellText);
  const row = cell.closest("tr");
  if (row === null) throw new Error(`"${String(cellText)}" is not inside a table row`);
  /* scoped to the row, so a table of twenty rows cannot open the wrong menu
     and report on the wrong record's actions */
  const trigger = row.querySelector<HTMLElement>("button[aria-haspopup='menu']");
  if (trigger === null) throw new Error(`the row for "${String(cellText)}" has no ⋯ menu`);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  /* let Radix's open-state effect flush before the caller looks for items */
  await Promise.resolve();
}
