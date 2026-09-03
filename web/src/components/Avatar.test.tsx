import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./Avatar";

/**
 * The decisions that were being re-made at fifteen call sites, asserted once.
 */
describe("Avatar", () => {
  it("shows the first letter of the name, uppercased", () => {
    const { container } = render(<Avatar name="سینا سپاسی" />);
    expect(container.textContent).toBe("س");
    /* the Latin half of a bilingual product: a lowercase initial beside an
       uppercase one reads as a rendering fault, and the call sites disagreed
       about whether to make it */
    const { container: latin } = render(<Avatar name="amir bagheri" />);
    expect(latin.textContent).toBe("A");
  });

  it("does not split a surrogate pair", () => {
    /*
     * `name[0]` takes one CODE UNIT. An emoji or a supplementary-plane letter
     * is two, so slicing one renders the replacement character — and it does
     * so identically for every such person, which is a mark that identifies
     * nobody. `Array.from` iterates code POINTS.
     */
    const { container } = render(<Avatar name="😀 nobody" />);
    expect(container.textContent).toBe("😀");
    expect(container.textContent).not.toContain("�");
  });

  it("falls back to a mark rather than rendering an empty circle", () => {
    /* an empty name is a real state — a person with no display name yet — and
       a blank circle beside a blank name is two nothings and no information */
    const { container } = render(<Avatar name="   " />);
    expect(container.textContent).toBe("?");
  });

  it("shows the photo when there is one, and never both", () => {
    const { container } = render(<Avatar name="سینا" src="data:image/png;base64,AAA" />);
    expect(container.querySelector("img")).not.toBeNull();
    /* the initial must GO: an initial behind a transparent PNG is the two
       halves of the fallback showing at once */
    expect(container.textContent).toBe("");
  });

  it("is hidden from a screen reader, because the name is always beside it", () => {
    /* a reader that announces the initial and then the name says the first
       letter twice — the mark is decoration for an accessible name that
       already exists in the row */
    const { container } = render(<Avatar name="سینا" />);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("has four named sizes, and the ink scales with the circle", () => {
    /* the point of the component: three files held four sizes with nothing
       naming any of them, so a fifth was one edit away */
    const cls = (size: "xs" | "sm" | "md" | "lg") =>
      render(<Avatar name="س" size={size} />).container.firstElementChild!.className;
    expect(cls("xs")).toContain("h-5 w-5");
    expect(cls("sm")).toContain("h-7 w-7");
    expect(cls("md")).toContain("h-9 w-9");
    expect(cls("lg")).toContain("h-12 w-12");
    /* a 10px letter in a 48px circle is what mixing the two by hand produces */
    expect(cls("xs")).toContain("text-[10px]");
    expect(cls("lg")).toContain("text-base");
  });
});
