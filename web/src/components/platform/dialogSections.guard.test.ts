import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DIALOG_BODY, PANEL_SECTIONS, RAIL_SECTIONS } from "./tasks/panelStyle";

/**
 * SECTIONS ARE DIVIDED, in every pop-up (user directive, 2026-09-05: "add
 * divider between different sections in all pop-up windows — they all seem
 * connected … give the structure").
 *
 * The rule lives in panelStyle as three container classes; this file is what
 * makes it a rule rather than a habit. Every file that renders an `<Overlay`
 * either reads `DIALOG_BODY` for its body or is listed here WITH THE REASON it
 * needs no divider — one block, nothing to divide. The detail frame reads the
 * other two. An entry for a file that stops rendering an Overlay fails too:
 * an allow-list entry for a deleted subject reads as coverage and is a hole.
 */
const ONE_BLOCK: Record<string, string> = {
  "meeting/InviteDialog.tsx": "a search box over a list, then two sections that already draw their own hairlines",
  "InvitePeople.tsx": "one list of colleagues over one footer",
  "ProjectDetail.tsx": "its dialog is the members list alone; the detail itself is DetailPanel, which divides",
};

const ROOT = join(__dirname);

/**
 * THE USE, NOT THE NAME. The first version asked `text.includes("DIALOG_BODY")`
 * and stayed green when a dialog's body was put back to `space-y-3` — the
 * IMPORT line still carried the name, so the name matched itself (the corpus
 * trap CLAUDE.md records under rule 13½). A body is divided only where the
 * constant is written INTO a className.
 */
const usesDividedBody = (text: string): boolean => /className=\{(?:`[^`]*\$\{)?DIALOG_BODY\b/.test(text);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

describe("dialog sections", () => {
  const files = walk(ROOT).map((full) => ({
    rel: relative(ROOT, full).replace(/\\/g, "/"),
    text: readFileSync(full, "utf8"),
  }));
  const dialogs = files.filter((f) => f.text.includes("<Overlay") && !f.rel.startsWith("Overlay.tsx"));

  it("had dialogs to check", () => {
    expect(dialogs.length).toBeGreaterThan(5);
  });

  it("every dialog body is the divided body, or is one block with its reason on record", () => {
    const offenders = dialogs
      .filter((f) => !usesDividedBody(f.text) && !(f.rel in ONE_BLOCK))
      .map((f) => f.rel);
    expect(offenders, "a pop-up whose sections are not divided").toEqual([]);
  });

  it("every one-block entry still names a dialog", () => {
    for (const rel of Object.keys(ONE_BLOCK)) {
      const file = files.find((f) => f.rel === rel);
      expect(file, `${rel} is listed and does not exist`).toBeDefined();
      expect(file!.text.includes("<Overlay"), `${rel} no longer renders a dialog — retire its entry`).toBe(true);
      expect(usesDividedBody(file!.text), `${rel} divides its body now — retire its entry`).toBe(false);
    }
  });

  it("the detail frame divides its body and its rail", () => {
    const frame = files.find((f) => f.rel === "DetailPanel.tsx")!;
    expect(frame.text).toContain("PANEL_SECTIONS");
    expect(frame.text).toContain("RAIL_SECTIONS");
  });

  it("the three containers draw a hairline between children — the control", () => {
    for (const cls of [DIALOG_BODY, PANEL_SECTIONS, RAIL_SECTIONS]) {
      expect(cls).toContain("divide-y");
      expect(cls, "a divider with no air around it is an underline on the section above").toMatch(/\[&>\*\]:py-/);
    }
  });
});
