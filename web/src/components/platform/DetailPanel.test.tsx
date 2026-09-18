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

  it("keeps the CLOSE alone on its side and the acts on the other", async () => {
    /*
     * User directive, 2026-09-19: "put the three dot and edit on the other
     * side for tasks and projects".
     *
     * Measured on production first, because a screenshot crop cannot say
     * which side anything is on: the kebab and «ویرایش» were at x=578 and
     * x=502 against a panel whose right edge was 640 — clustered WITH the
     * close at 606 — while the done toggle sat alone at the far end. Chrome
     * and content in one group, and the object's own acts split across two.
     *
     * jsdom lays nothing out, so "which side" is not a question it can
     * answer. What it CAN answer is the structure that decides the side, and
     * that is the real rule anyway: the close button's group holds the close
     * button and nothing else. A version that put the acts back beside it
     * would fail here without any geometry at all.
     */
    render(
      <DetailPanel
        label="کارت" closeLabel="بستن" onClose={() => {}} rail={null}
        end={<button type="button">ویرایش</button>}
      >
        <p>بدنه</p>
      </DetailPanel>,
    );
    const close = screen.getByRole("button", { name: "بستن" });
    const group = close.parentElement!;
    expect([...group.querySelectorAll("button")], "the close button shares its group").toHaveLength(1);
    /* and the control: the act IS in the bar, just not in that group — an
       assertion that only counted the close's neighbours would pass on a
       panel that rendered no acts at all */
    const bar = group.parentElement!;
    expect([...bar.querySelectorAll("button")].map((b) => b.textContent)).toContain("ویرایش");
  });
});
