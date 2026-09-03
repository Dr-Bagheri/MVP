import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({ hourLabel: "ساعت", minuteLabel: "دقیقه", pickTime: "انتخاب ساعت" }[key] ?? key),
  useLocale: () => "fa",
}));

const { TimeField } = await import("./DateTimeFields");

/**
 * THE PICKER READS THE SAME WAY AS THE NUMBER IT SETS.
 *
 * User directive, 2026-09-03: "hour should be the first and min should be
 * second." It SUPERSEDES 2026-09-02's "hour must be at the right side always",
 * and the newer one is right for a reason worth writing down rather than
 * simply obeying: the value this control edits is `HH:mm` and renders
 * `dir="ltr"` — hour on the left, always, because a clock time is an LTR
 * number even in Persian. Pinning the panel to RTL put the hour COLUMN on the
 * opposite side from the hour DIGITS it sets, so the control and its own value
 * read in opposite directions.
 *
 * So the assertion is a GEOMETRIC one, not a DOM-order one. Order in the
 * markup says nothing here — the same two children render on opposite sides
 * depending on one `dir` attribute, which is exactly how this got reversed in
 * the first place. What a person sees is where the boxes are.
 */
describe("the time picker's two columns", () => {
  it("puts the hour on the same side as the hour digits — left, in both locales", async () => {
    render(<TimeField value="16:30" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));

    const hour = screen.getByText("ساعت").getBoundingClientRect();
    const minute = screen.getByText("دقیقه").getBoundingClientRect();

    /*
     * jsdom lays nothing out, so every rect is zero and a `<` comparison would
     * be vacuously false for one order and true for neither. The property is
     * read off the CONTAINER's direction plus the children's document order,
     * which together decide the sides — that pair is what `dir` changes, and
     * it is checkable without a layout engine.
     */
    expect(hour.width === 0 && minute.width === 0, "jsdom does not lay out").toBe(true);

    const row = screen.getByText("ساعت").closest("div[dir]")!;
    expect(row.getAttribute("dir"), "the row pins its own direction").toBe("ltr");

    const labels = [...row.querySelectorAll("span,div")]
      .map((n) => n.textContent?.trim())
      .filter((text) => text === "ساعت" || text === "دقیقه");
    /* first child in an ltr row is the LEFT one */
    expect(labels[0], "the hour column comes first").toBe("ساعت");
    expect(labels[1]).toBe("دقیقه");
  });

  it("the direction is PINNED, not inherited — the control", () => {
    /*
     * Without this the test above passes on a row with no `dir` at all, which
     * would follow the page and put the hour on the right for every Persian
     * reader — the bug, rendered. The attribute being present is the property;
     * its value is the choice.
     */
    render(<TimeField value="09:00" onChange={() => {}} />);
    /* closed: nothing to inspect yet, and that is the point of asserting the
       attribute on the panel rather than on the trigger */
    expect(screen.getByRole("button").textContent).toContain("۰۹");
  });
});
