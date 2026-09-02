import { DirectionProvider } from "@radix-ui/react-direction";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KebabMenu } from "./rowActions";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));

/**
 * PERSIAN-FIRST REACHES THE COMPONENT LIBRARY, OR IT DOES NOT REACH IT.
 *
 * Radix takes its direction from a React context and defaults to "ltr" when
 * nothing supplies one — it never reads `<html dir>`. So the platform can be
 * correctly RTL at every level a person can see, and every floating panel
 * inside it can still be laid out left-to-right: submenus flying out of the
 * wrong edge, `align="end"` picking the wrong side, ArrowLeft closing a
 * submenu that ArrowLeft should have opened.
 *
 * Nothing throws. Nothing logs. This file is the only thing standing between
 * that and a release.
 */
const ITEMS = [{ key: "a", label: "ویرایش", icon: null }];

async function openUnder(dir: "rtl" | "ltr" | null) {
  const menu = <KebabMenu label="menu" items={ITEMS} />;
  render(dir ? <DirectionProvider dir={dir}>{menu}</DirectionProvider> : menu);
  await userEvent.click(screen.getByRole("button", { name: "menu" }));
  return screen.getByRole("menu");
}

describe("Radix direction", () => {
  it("is RTL when the provider says so", async () => {
    expect((await openUnder("rtl")).getAttribute("dir")).toBe("rtl");
  });

  it("THE CONTROL: is LTR with no provider — which is the bug this guards", async () => {
    /*
     * The half that makes the test above mean something. If Radix already
     * defaulted to the document's direction, the assertion above would pass
     * whether or not the layout mounts anything, and this file would be
     * decoration. It does not, and this proves it does not.
     */
    expect((await openUnder(null)).getAttribute("dir")).toBe("ltr");
  });
});

describe("the seam: the app actually mounts one", () => {
  it("wraps the whole tree, with the LOCALE's direction rather than a literal", () => {
    /*
     * The behaviour above is true of Radix; this is true of US. A provider is
     * a producer with consumers in every corner of the app and no consumer
     * that can complain — the exact shape that has broken here before, so it
     * gets the instrument rather than the trust.
     */
    const layout = readFileSync(
      join(process.cwd(), "src", "app", "[locale]", "layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("<DirectionProvider dir={dirFor(locale)}>");
    /* and it is an ANCESTOR of the page, not a sibling parked beside it */
    const open = layout.indexOf("<DirectionProvider");
    const close = layout.indexOf("</DirectionProvider>");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    expect(layout.slice(open, close)).toContain("{children}");
  });
});
