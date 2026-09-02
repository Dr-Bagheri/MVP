import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./PasswordInput";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("the reveal button's side", () => {
  it("sits where the field reserved room for it — the same side, in either locale", () => {
    /*
     * THE REPORTED BUG. The field is pinned `dir="ltr"`, because a password is
     * typed left to right whatever the page does, so its trailing edge is the
     * RIGHT — but the button lives outside it, and a logical `end-2` resolves
     * against the PAGE. In Persian that put the reserved padding on one side
     * and the eye on the other, sitting on top of the characters.
     *
     * The assertion is that the two halves AGREE. What matters is not that
     * either is "right" in the abstract: it is that the space and the control
     * are on the same side. A change that moves both is fine; one that moves
     * one is this bug again.
     */
    render(<PasswordInput value="hunter2" onChange={() => {}} />);
    const input = document.querySelector("input")!;
    const button = screen.getByRole("button");

    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.className).toContain("pr-11");
    expect(button.className).toContain("right-2");

    /* the control, and the half that actually catches a regression: neither
       may be the LOGICAL form. Those flip under a locale, which is precisely
       how this shipped looking correct in English. */
    expect(input.className).not.toContain("pe-11");
    expect(button.className).not.toContain("end-2");
  });
});
