import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A HIT AREA IS AN ABSOLUTE. A CONTROL'S HEIGHT IS A PROPORTION.
 *
 * This product's root font-size is FLUID by design — it clamps so that 16px
 * lands at 1440 — which means every `rem` in the stylesheet is a proportion of
 * the viewport, and every `px` is a physical measurement. Both are correct;
 * which one a rule wants depends entirely on what the rule is about, and
 * getting it backwards is invisible at the one width where the two agree.
 *
 * Both mistakes were live on 2026-09-03, and both were found by measuring in a
 * browser rather than by reading anything:
 *
 *   · `.btn` and `.btn-icon` took their height from rem tokens while `.btn-sm`
 *     and `.input` were written as literal px. At 1440 all four measured
 *     exactly right — 38 / 34 / 28 / 40 — so every check anyone had run said
 *     the family was correct. At 1280 the gap between a button and a COMPACT
 *     button had closed from 4px to 2.8, and narrower still it inverts: the
 *     small control becomes the taller one. On a 1280 laptop, which is most
 *     laptops.
 *
 *   · `.tap::after` — the platform's 44px hit target — was `h-11 w-11`, i.e.
 *     2.75REM. At 375, the only width where the ruling actually applies, the
 *     root is 14 and the hit area computed to 38.5px. So the 44px rule, stated
 *     in three separate comments, had been breached on every button on every
 *     phone since the fluid root landed. Nothing disagreed except the computed
 *     value.
 *
 * So this check is about UNITS, not sizes: the size lives in
 * scaffold/constants.ts and this asserts each rule is spelled in the unit its
 * meaning requires. It is a source check by construction — a stylesheet has no
 * computed value until a browser has one — but the choice it guards is made in
 * source, which is where it can be stopped.
 */
const CSS = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/** One CSS rule's body, by selector. */
function body(selector: string): string {
  const i = CSS.indexOf(`${selector} {`);
  expect(i, `${selector} must exist in globals.css`).toBeGreaterThan(-1);
  const end = CSS.indexOf("\n  }", i);
  return CSS.slice(i, end)
    /* comments stripped: this file's own prose names the classes and units it
       is about, and a checker that reads prose as code manufactures the false
       positives that get it muted */
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Tailwind spacing classes are rem (`h-11` = 2.75rem); `h-[44px]` is not. */
const REM_SIZED = /(?<![\w-])[hw]-\d+(?:\.\d+)?(?![\w[-])/;
const PX_SIZED = /(?<![\w-])(?:min-)?[hw]-\[\d+px\]/;

describe("units say what a rule is about", () => {
  it("has the rules to check", () => {
    /* the vacuum guard: a renamed selector would make every assertion below
       pass against an empty string */
    for (const sel of [".tap::after", ".input", ".btn", ".btn-sm", ".btn-icon"]) {
      expect(body(sel).length, `${sel} body`).toBeGreaterThan(20);
    }
  });

  it("spells the 44px hit area in PHYSICAL pixels — a finger does not scale with the type", () => {
    const tap = body(".tap::after");
    expect(tap, "the hit area must be px").toMatch(PX_SIZED);
    expect(
      REM_SIZED.test(tap),
      "`h-11 w-11` is 2.75REM: at 375 the fluid root is 14 and this computes to 38.5px, " +
      "which breaches the 44 ruling on every button on every phone. Use h-[44px] w-[44px].",
    ).toBe(false);
  });

  it("keeps the field's touch floor absolute too", () => {
    /* the same rule one control over: `min-h-field` (rem) is right for the
       md-and-up height, and the BELOW-md floor is the ruling, so it is px */
    expect(body(".input")).toMatch(/min-h-\[44px\]/);
  });

  it("sizes the control family from the tokens, so the four hold their proportions", () => {
    /*
     * The other direction. These heights ARE proportions — the family should
     * shrink together with the type ramp — so a literal px here is the
     * inversion bug: at 1280 a px `.btn-sm` sat 2.8px under a rem `.btn`, and
     * below that it overtook it.
     */
    expect(body(".btn")).toMatch(/min-h-control\b/);
    expect(body(".btn-sm")).toMatch(/h-control-sm\b/);
    expect(body(".btn-icon")).toMatch(/h-control-icon\b/);
    for (const sel of [".btn-sm", ".btn-icon"]) {
      expect(
        PX_SIZED.test(body(sel)),
        `${sel} must take its height from the token, not a px literal — the family ` +
        "scales with the root font-size and a pinned member inverts against the rest",
      ).toBe(false);
    }
  });

  /**
   * EVERY SIZE TOKEN A CONTROL NAMES MUST EXIST (2026-09-06).
   *
   * `.btn-icon-sm` was written as `h-control-sm min-h-control-sm
   * w-control-sm` — and the width scale had only `menu`, `rail` and
   * `control-icon`, so Tailwind emitted NO width at all. The class was
   * present, the intent was readable, a reviewer would have seen a square,
   * and the button would have rendered 34 tall and as wide as its glyph. It
   * is the `text-on-accent` bug and the shadcn `*-foreground` bug in a third
   * costume: the artifact reads as satisfied and only the computed value
   * disagrees.
   *
   * A stylesheet has no computed value here, but the CONFIG does have the
   * list — so the check is a cross-read against the producer rather than a
   * hand-kept list of legal names (13½: derive the coverage from the
   * producer).
   */
  it("names only size tokens the config actually declares", () => {
    const config = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
    /** the keys inside one `extend` group, e.g. width: { … } */
    const scale = (group: string): Set<string> => {
      const at = config.indexOf(`      ${group}: {`);
      expect(at, `tailwind.config.ts has no ${group} scale — the parser is stale`).toBeGreaterThan(-1);
      const body = config.slice(at, config.indexOf("\n      },", at));
      return new Set([...body.matchAll(/^\s*"?([a-z][\w-]*)"?:/gm)].map((m) => m[1]!));
    };
    const scales = { w: scale("width"), h: scale("height"), "min-h": scale("minHeight") };
    /* the sizes Tailwind ships with are legal too: `h-5`, `w-px`, `h-full` */
    const BUILT_IN = /^(\d+(\.\d+)?|px|full|auto|screen|dvh|fit|min|max|\[.*\])$/;

    const unknown: string[] = [];
    for (const sel of [".btn", ".btn-sm", ".btn-icon", ".btn-icon-sm", ".input", ".input-sm"]) {
      const rule = body(sel);
      for (const m of rule.matchAll(/(?:^|\s)(w|h|min-h)-([\w[\]().%-]+)/g)) {
        const [prefix, name] = [m[1]! as "w" | "h" | "min-h", m[2]!];
        if (BUILT_IN.test(name)) continue;
        if (!scales[prefix].has(name)) unknown.push(`${sel}: ${prefix}-${name}`);
      }
    }
    expect(
      unknown,
      "these utilities name a token the config does not declare, so Tailwind emits NOTHING for them",
    ).toEqual([]);
  });

  it("can answer NO — the patterns tell the two units apart", () => {
    /*
     * The negative control, run against the exact strings that shipped. "No
     * rem found" reads identically whether the rule is correct or the regex
     * never matches anything.
     */
    expect(REM_SIZED.test("@apply absolute h-11 w-11 -translate-x-1/2;")).toBe(true);
    expect(REM_SIZED.test("@apply absolute h-[44px] w-[44px];")).toBe(false);
    expect(PX_SIZED.test("@apply h-[34px] min-h-[34px] rounded-[8px];")).toBe(true);
    expect(PX_SIZED.test("@apply h-control-sm min-h-control-sm;")).toBe(false);
    /* and the near-miss it must not claim: a token name containing a digit is
       not a rem size */
    expect(REM_SIZED.test("@apply h-control-sm w-control-icon;")).toBe(false);
  });
});
