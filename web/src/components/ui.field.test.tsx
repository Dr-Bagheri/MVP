import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./ui";

/**
 * **A name is not a description**, and conflating them is invisible to anyone
 * who looks at the screen.
 *
 * `Field` rendered its `hint` inside the `<label>`, so the accessible NAME of
 * every hinted control was the label plus the entire hint — announced on focus,
 * and again wherever a screen reader lists the form's fields. Nothing looked
 * wrong; the layout is identical either way.
 *
 * These assert the split rather than the markup: the name is exactly the label,
 * and the hint is reachable as the description. Asserting "the hint is on the
 * screen" would pass against the broken version, which is the whole problem.
 */
describe("Field", () => {
  it("names the control with the label ALONE, not label + hint", () => {
    render(
      <Field label="نام کاربری" hint="۳ تا ۳۲ نویسه: حروف کوچک لاتین، رقم و زیرخط">
        <input />
      </Field>,
    );

    // exact match: the failure mode is extra text appended to the name
    expect(screen.getByLabelText("نام کاربری")).toBeTruthy();
  });

  it("offers the hint as the DESCRIPTION of the control", () => {
    render(
      <Field label="نام کاربری" hint="۳ تا ۳۲ نویسه">
        <input />
      </Field>,
    );

    const input = screen.getByLabelText("نام کاربری");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("۳ تا ۳۲ نویسه");
  });

  it("keeps the hint visible — this is an association fix, not a removal", () => {
    render(
      <Field label="نام کاربری" hint="۳ تا ۳۲ نویسه">
        <input />
      </Field>,
    );
    expect(screen.getByText("۳ تا ۳۲ نویسه")).toBeTruthy();
  });

  it("preserves an aria-describedby the caller already set", () => {
    render(
      <Field label="نام" hint="راهنما">
        <input aria-describedby="caller-owned" />
      </Field>,
    );
    const input = screen.getByLabelText("نام");
    expect(input.getAttribute("aria-describedby")).toContain("caller-owned");
  });

  it("still labels a control with no hint", () => {
    render(
      <Field label="نام سازمان">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText("نام سازمان");
    // no hint, so nothing to describe — an empty describedby would point nowhere
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });
});
