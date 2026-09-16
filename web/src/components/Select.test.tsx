import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

/**
 * The dropdown replaced a NATIVE control, so what it owes is everything the
 * browser used to guarantee for free. Each of these is a thing a native
 * `<select>` did without being asked:
 *
 *  1. it announces itself as a listbox, and says which row is chosen;
 *  2. it works from the keyboard alone;
 *  3. it closes when you click away instead of trapping the page;
 *  4. a value matching NO option shows the placeholder — the native control
 *     shows its first option instead, which is a lie about the record even
 *     when the record survives it (that exact defect shipped once: an org
 *     stored as `fa-IR` displayed as Persian).
 */
const OPTIONS = [
  { value: "a", label: "الف" },
  { value: "b", label: "ب" },
  { value: "c", label: "ج" },
];

describe("Select", () => {
  it("announces itself as a listbox and marks the chosen row", async () => {
    render(<Select value="b" options={OPTIONS} onChange={vi.fn()} ariaLabel="حرف" />);
    const trigger = screen.getByRole("combobox", { name: "حرف" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("ب");

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", { name: "ب" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "الف" })).toHaveAttribute("aria-selected", "false");
  });

  it("opens, moves and chooses from the keyboard alone", async () => {
    const onChange = vi.fn();
    render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="حرف" />);
    screen.getByRole("combobox", { name: "حرف" }).focus();

    await userEvent.keyboard("{ArrowDown}");        // opens, cursor on the current value
    await userEvent.keyboard("{ArrowDown}");        // → ب
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape dismisses without choosing", async () => {
    const onChange = vi.fn();
    render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="حرف" />);
    await userEvent.click(screen.getByRole("combobox", { name: "حرف" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a click outside closes it — the page is never trapped", async () => {
    render(
      <div>
        <Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="حرف" />
        <button type="button">جای دیگر</button>
      </div>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "حرف" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "جای دیگر" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows the PLACEHOLDER for a value no option carries, never another label", async () => {
    /* verified red by falling back to `options[0]`: the trigger read «الف»
       for a record that says `zz`, which is the native control's behaviour
       and the reason this is not one */
    render(
      <Select value="zz" options={OPTIONS} onChange={vi.fn()} placeholder="انتخاب کن" ariaLabel="حرف" />,
    );
    const trigger = screen.getByRole("combobox", { name: "حرف" });
    expect(trigger).toHaveTextContent("انتخاب کن");
    expect(trigger.textContent).not.toContain("الف");
  });

  it("a disabled control does not open", async () => {
    render(<Select value="a" options={OPTIONS} onChange={vi.fn()} disabled ariaLabel="حرف" />);
    await userEvent.click(screen.getByRole("combobox", { name: "حرف" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

/**
 * MANY VALUES, SAME CONTROL (2026-09-16) — the meeting dialogs' attendees row.
 * Each case is a thing the one-value mode must NOT start doing, which is why
 * the single-value suite above stays exactly as it was: the union in the
 * props is what keeps them apart, and these are what keep them honest.
 */
describe("Select · many values", () => {
  it("says it takes several, marks every chosen row, and STAYS OPEN on a press", async () => {
    const onToggle = vi.fn();
    render(<Select values={["a", "c"]} options={OPTIONS} onToggle={onToggle} ariaLabel="حرف‌ها" />);
    const trigger = screen.getByRole("combobox", { name: "حرف‌ها" });
    /* the closed control reads the chosen labels, joined */
    expect(trigger).toHaveTextContent("الف");
    expect(trigger).toHaveTextContent("ج");

    await userEvent.click(trigger);
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getByRole("option", { name: "الف" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "ب" })).toHaveAttribute("aria-selected", "false");

    await userEvent.click(screen.getByRole("option", { name: "ب" }));
    expect(onToggle).toHaveBeenCalledWith("b");
    /* THE ONE THAT MATTERS: picking three people through a menu that shuts
       each time is three round trips for one decision */
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("shows the placeholder with nothing chosen, and a caller's own summary over the labels", async () => {
    const { rerender } = render(
      <Select values={[]} options={OPTIONS} onToggle={vi.fn()} placeholder="هیچ‌کس" ariaLabel="حرف‌ها" />,
    );
    expect(screen.getByRole("combobox", { name: "حرف‌ها" })).toHaveTextContent("هیچ‌کس");

    rerender(
      <Select values={["a", "b"]} options={OPTIONS} onToggle={vi.fn()} summary="دو حرف" ariaLabel="حرف‌ها" />,
    );
    const trigger = screen.getByRole("combobox", { name: "حرف‌ها" });
    expect(trigger).toHaveTextContent("دو حرف");
    /* the summary REPLACES the joined labels rather than joining them */
    expect(trigger.textContent).not.toContain("الف");
  });

  it("THE CONTROL: one value still closes on a press, and says nothing about being multiple", async () => {
    const onChange = vi.fn();
    render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="حرف" />);
    await userEvent.click(screen.getByRole("combobox", { name: "حرف" }));
    expect(screen.getByRole("listbox")).not.toHaveAttribute("aria-multiselectable");
    await userEvent.click(screen.getByRole("option", { name: "ب" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("a disabled row is not chosen by a press — the host of a meeting is one", async () => {
    const onToggle = vi.fn();
    render(
      <Select
        values={[]}
        onToggle={onToggle}
        ariaLabel="حرف‌ها"
        options={[{ value: "host", label: "میزبان", disabled: true }, ...OPTIONS]}
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "حرف‌ها" }));
    await userEvent.click(screen.getByRole("option", { name: "میزبان" }));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
