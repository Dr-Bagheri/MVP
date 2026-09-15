import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeAll } from "vitest";
import { SelectMenu } from "./rowActions";

/**
 * THE MIC MENU HAS A WIDTH CEILING (review F17).
 *
 * The panel is `w-auto` with only a floor
 * (`min-w-[max(var(--radix-popover-trigger-width),15rem)]`). A shrink-to-fit
 * box takes everything it is offered and its width is decided by its longest
 * unwrapped line. For a bare option list that is invisible — the labels are
 * short. The mic menu is not a bare option list: `panelFooter` puts
 * `MicLevelFooter` inside it, and its `noiseHint` is a 165-character sentence
 * with nothing to wrap against. The sentence set the width; the picker
 * inherited it. `collisionPadding` shifts a box that is too wide; it does not
 * narrow one.
 *
 * ── WHY THIS TEST COMPILES CSS INSTEAD OF READING `className` ──────────────
 *
 * Because the defect this guards is a CSS-LAYER one, and the markup is right
 * in the broken version. `max-w-[min(20rem,calc(100vw - 1rem))]` — the same
 * rule written the way the CSS reads, with real spaces — **emits nothing at
 * all**: a class name cannot carry a space, so Tailwind's extractor stops at
 * the first one. That version reads as a fix, greps as a fix, and would pass
 * any `className.includes("max-w-")` assertion while the panel stretches
 * exactly as before. Measured: the natural spelling emits 0 matching rules,
 * the underscore spelling emits 1.
 *
 * So the assertion is on the EMITTED STYLESHEET and on the RENDERED NODE.
 *
 * ── WHAT THIS STILL DOES NOT PROVE, SAID PLAINLY ───────────────────────────
 *
 * That the rendered box sits inside the viewport. jsdom does not lay out, and
 * the narrow-viewport half is not merely unmeasured but UNREACHABLE: jsdom
 * resolves `100vw` from a fixed internal 1024px and ignores `window.resizeTo`,
 * so `min(20rem, calc(100vw - 1rem))` answers `320px` at every width. **A
 * browser measurement at 1280 and 375, in `fa` and `en`, is still owed.** Do
 * not read a green here as that measurement.
 */

const CEILING = "min(20rem, calc(100vw - 1rem))";
let css = "";

beforeAll(() => {
  /* the app's REAL config and entry, not a fixture — the question is what
     ships, and a fixture would answer a different one */
  const out = join(mkdtempSync(join(tmpdir(), "twcss-")), "app.css");
  execFileSync(
    "npx",
    ["tailwindcss", "-c", "tailwind.config.ts", "-i", "src/app/globals.css", "-o", out],
    { cwd: process.cwd(), stdio: "ignore", shell: process.platform === "win32" },
  );
  css = readFileSync(out, "utf8");
}, 120_000);

describe("the select panel's width rule", () => {
  it("compiled something at all", () => {
    /* the vacuum guard: an empty stylesheet makes every assertion below pass
       for a reason that has nothing to do with the panel */
    expect(css.length, "compiled stylesheet is non-empty").toBeGreaterThan(1000);
  });

  it("emits the CEILING — this is the half the class list cannot see", () => {
    expect(css).toContain(`max-width: ${CEILING}`);
  });

  it("still emits the FLOOR, which the ceiling must not have replaced", () => {
    /* CSS resolves min-width over max-width, so both survive together and the
       old promise — never narrower than the trigger — is intact */
    expect(css).toContain("max(var(--radix-popover-trigger-width), 15rem)");
  });

  it("NEGATIVE CONTROL: a value nobody wrote emits nothing", () => {
    /* without this, `toContain` on a stylesheet that happens to contain
       everything would pass for free */
    expect(css).not.toContain("max-width: min(37rem, calc(100vw - 3rem))");
  });

  it("the rendered panel carries the ceiling, not just the source", async () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const user = userEvent.setup();
    render(
      <SelectMenu
        ariaLabel="mic"
        value="a"
        options={[{ value: "a", label: "A" }]}
        onChange={() => {}}
        variant="tile"
        /* the 165-character hint is the whole point: this is the content that
           was setting the panel's width */
        panelFooter={<span>{"x".repeat(165)}</span>}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^mic/ }));
    /* found by class SUBSTRING rather than a CSS selector: the class name is
       full of characters a selector has to escape, and a mis-escaped selector
       silently matches nothing — which would read as "the panel did not
       render" rather than as a broken query. */
    const panel = [...document.querySelectorAll<HTMLElement>("*")]
      .find((el) => typeof el.className === "string" && el.className.includes("max-w-[min(20rem"));
    expect(panel, "the open panel carries the ceiling class").toBeTruthy();
    /*
     * THE ASSERTION IS "IT RESOLVES", NOT A LITERAL PIXEL COUNT.
     *
     * jsdom does resolve the `min()` — but to 294px here, not the 320px
     * (20rem at a 16px root) that was predicted before running it. The
     * difference comes from jsdom's own viewport metrics, which are not the
     * app's and are not worth pinning: a hard-coded number would fail the day
     * the harness changed its width, for a reason with nothing to do with
     * this rule.
     *
     * What discriminates is the thing the class list cannot see: the natural
     * spelling with real spaces puts the SAME class in the markup and
     * computes to `none`, because Tailwind emitted no rule for it.
     */
    const resolved = getComputedStyle(panel as HTMLElement).maxWidth;
    expect(resolved, "the ceiling resolves — `none` means Tailwind emitted nothing").not.toBe("none");
    expect(resolved).toMatch(/^\d+(\.\d+)?px$/);
    /* and it is a CEILING at or under the 20rem token step, never wider */
    expect(Number.parseFloat(resolved)).toBeLessThanOrEqual(320);
  });
});
