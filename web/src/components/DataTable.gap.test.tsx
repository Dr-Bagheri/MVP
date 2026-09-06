import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";

/**
 * THE FIRST ROW SITS AT THE GAP (user, 2026-09-06: "gap in the images, fix
 * it"). Every table page measured 30px from its toolbar to the first row
 * against the board's 13: `border-spacing` paints a band above the first
 * row, and a headless table also carries its sr-only header row — 1px, with
 * a band on either side — inside the layout. The two rules in globals.css
 * take that back; this checks the class reaches the table and the rules say
 * what the measurement asked for, since a stylesheet is the one place a
 * reviewer cannot see a number fail.
 */
const CSS = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
const rule = (selector: string): string => {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `${selector} is declared`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("}", at));
};

const columns = [{ key: "name", header: "Name", cell: (row: { name: string }) => row.name }];

describe("a table's first row and the gap above it", () => {
  it("a headless table wears `table-headless`; a table with a header does not", () => {
    const headless = render(<DataTable rows={[{ name: "a" }]} columns={columns} rowKey={(r) => r.name} hideHeader />);
    expect(headless.container.querySelector("table")!.className).toMatch(/\btable-headless\b/);
    headless.unmount();
    const headed = render(<DataTable rows={[{ name: "a" }]} columns={columns} rowKey={(r) => r.name} />);
    expect(headed.container.querySelector("table")!.className).not.toMatch(/table-headless/);
  });

  it("the stylesheet takes back one band above a headed table and two bands plus the hidden row above a headless one", () => {
    expect(rule(".table-cards")).toMatch(/margin-top:\s*calc\(-1 \* var\(--table-row-gap, 8px\)\)/);
    expect(rule(".table-cards.table-headless")).toMatch(/margin-top:\s*calc\(-2 \* var\(--table-row-gap, 8px\) - 1px\)/);
  });
});
