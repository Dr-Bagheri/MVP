import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Overlay } from "./platform/Overlay";
import { ConfirmDialog } from "./rowActions";

/**
 * R8 — ONE DIALOG CORNER (2026-09-05).
 *
 * Every dialog in the product declared `rounded-2xl` — the panel token, 18px,
 * measured off the reference — and every one of them rendered at 12. The
 * shadcn `DialogContent` under `Overlay` carried `sm:rounded-lg` in its base
 * class list, and a responsive variant wins over a bare utility from 640px up,
 * so on every desktop the base beat the token. The markup read as satisfied;
 * only the computed value disagreed (the new-task dialog measured 12, the
 * task detail — its own markup — 18).
 *
 * jsdom computes no Tailwind, so this asserts the CLASS LIST the element
 * actually carries: the token present, and no responsive corner beside it
 * that could outrank it. It went red against the shipped base and green when
 * the override left.
 */
describe("R8: one dialog corner", () => {
  it("Overlay carries the panel token and no responsive corner that outranks it", () => {
    render(<Overlay onClose={() => undefined} label="x" size="sm">hi</Overlay>);
    const cls = screen.getByRole("dialog").className;
    expect(cls).toMatch(/\brounded-2xl\b/);
    expect(cls).not.toMatch(/\b(?:sm|md|lg|xl):rounded/);
    expect(cls).not.toMatch(/\brounded-(?:lg|xl|md|sm)\b/);
  });

  it("the confirm dialog — the other Radix panel — wears the same corner", () => {
    render(
      <ConfirmDialog
        title="t"
        body="b"
        confirmLabel="ok"
        cancelLabel="no"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const cls = screen.getByRole("alertdialog").className;
    expect(cls).toMatch(/\brounded-2xl\b/);
    expect(cls).not.toMatch(/\b(?:sm|md|lg|xl):rounded/);
  });
});
