import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DetailPanel } from "./DetailPanel";

/**
 * THE DETAIL FRAME IS A DIALOG (2026-09-06, the check-up). It was a hand-
 * rolled fixed layer — no focus trap, no Escape, no scroll lock — extracted
 * from the task detail before anybody pressed Escape on it. It stands on
 * Overlay now, and this is the press that the old frame did not answer.
 */
describe("DetailPanel — the platform's dialog shell", () => {
  it("Escape closes it, like every other pop-up", async () => {
    const onClose = vi.fn();
    render(
      <DetailPanel label="کارت" closeLabel="بستن" onClose={onClose} rail={<span>ریل</span>}>
        <p>بدنه</p>
      </DetailPanel>,
    );
    expect(screen.getByRole("dialog", { name: "کارت" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("THE CONTROL: a press inside the card closes nothing; the close button does", async () => {
    const onClose = vi.fn();
    render(
      <DetailPanel label="کارت" closeLabel="بستن" onClose={onClose} rail={null}>
        <p>بدنه</p>
      </DetailPanel>,
    );
    await userEvent.click(screen.getByText("بدنه"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "بستن" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
