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
    const trigger = screen.getByRole("button", { name: "حرف" });
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
    screen.getByRole("button", { name: "حرف" }).focus();

    await userEvent.keyboard("{ArrowDown}");        // opens, cursor on the current value
    await userEvent.keyboard("{ArrowDown}");        // → ب
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape dismisses without choosing", async () => {
    const onChange = vi.fn();
    render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="حرف" />);
    await userEvent.click(screen.getByRole("button", { name: "حرف" }));
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
    await userEvent.click(screen.getByRole("button", { name: "حرف" }));
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
    const trigger = screen.getByRole("button", { name: "حرف" });
    expect(trigger).toHaveTextContent("انتخاب کن");
    expect(trigger.textContent).not.toContain("الف");
  });

  it("a disabled control does not open", async () => {
    render(<Select value="a" options={OPTIONS} onChange={vi.fn()} disabled ariaLabel="حرف" />);
    await userEvent.click(screen.getByRole("button", { name: "حرف" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
