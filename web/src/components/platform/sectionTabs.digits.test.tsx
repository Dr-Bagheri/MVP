import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionTabs } from "./sectionTabs";

/** a count on a Persian tab read `12` beside «۱۲» everywhere else (2026-09-06) */
describe("SectionTabs counts read in the page's digits", () => {
  it("renders ۱۲, never 12, on the Persian screen", () => {
    render(
      <SectionTabs
        label="نما"
        tabs={[{ key: "a", label: "همه", count: 12 }, { key: "b", label: "باز" }]}
        active="a"
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("۱۲")).toBeTruthy();
    expect(screen.queryByText("12")).toBeNull();
  });
});
