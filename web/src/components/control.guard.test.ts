import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE CONTROL, ONE SHAPE.
 *
 * User directive, 2026-09-02: "the look of the platform is like 10 different
 * developers made it — one is small, one is big, one has one shape for button,
 * the other has the other one."
 *
 * That was measurable, and the measurement is why this file exists: 47
 * controls had hand-rolled their own geometry in ELEVEN shapes — h-10
 * rounded-xl, h-8 rounded-lg, h-9 rounded-xl, h-11 rounded-xl, h-7 rounded-md
 * — against 109 using `.btn`. Nobody was careless: `.btn` offered exactly ONE
 * size, so any screen wanting a compact control had to invent one. The sizes
 * exist now (`.btn-sm`, `.btn-icon`, measured off the reference), so inventing
 * a twelfth is a choice, and this is what makes it a visible one.
 *
 * ── HOW THIS CHECK LEARNED TO SEE (2026-09-03) ───────────────────────────
 *
 * For its first day this guard looked for three utilities that co-occur: a
 * fixed height AND a corner AND a centred box. It reported ten stragglers.
 * There were about a hundred and thirty. Two spellings were invisible to it —
 * `grid place-items-center` (the same control written the other way, eighty of
 * them) and a template-literal className (the form every control with an
 * active state uses, thirty more) — and widening it to those exposed four MORE
 * shapes it still could not see: a pressable element with a height and a
 * corner but no centring word at all, the logical corners `rounded-s-lg` /
 * `rounded-e-lg`, a bare `rounded`, and a corner delegated to the dot inside
 * the button.
 *
 * The three-utility rule was never the rule. It was a PROXY for it, chosen
 * because `h-8` alone is spacing and `rounded-lg` alone is a card, and a
 * checker that fires on either is the false-positive factory that gets muted
 * inside a week. But the proxy had the failure every proxy has: it confirmed
 * what it was chosen for and missed the property it stood in for.
 *
 * THE RULE ITSELF IS SIMPLER, and three conversion agents arrived at it
 * independently: **a control is an element a person can press.** So the corpus
 * is pressable elements — `<button>`, `<a>`, `<Link>`, `<summary>`, and
 * anything carrying `onClick` or `role="button"` — and on one of those, a
 * hand-drawn height AND corner IS the finding, with no third signal needed.
 *
 * It is also why the worklist got SHORTER rather than longer. The old rule
 * fired on avatars, icon wells, colour swatches and video tiles — 85 of them,
 * every one a real match and not one of them a control — and each had to be
 * carried as an entry explaining that it was not a defect. An avatar is never
 * pressable, so the question no longer arises: the list below is work, not
 * exceptions.
 */
const SRC = join(process.cwd(), "src");

/**
 * The pressable elements that still draw their own box. A WORKLIST with a
 * number beside each entry, and the assertion fails in BOTH directions: more
 * than recorded is a regression, FEWER is a stale entry quietly making the
 * guard smaller than it looks. An allow-list nobody has to shrink is a backlog
 * nobody can see.
 */
const REMAINING: Record<string, number> = {
  /* FIVE ENTRIES LEFT THIS LIST ON 2026-09-03, and they were never five
     defects — they were one missing token. Nine `role="switch"` toggles were
     hand-drawn across the product in two track sizes, with two knob colours
     and two ideas of what "on" looks like (`bg-accent` on six, `bg-success`
     on the seventh — success means "this is healthy", not "this is on"). The
     theme shipped `.btn`, `.btn-sm`, `.btn-icon`, `.input` and no switch, so
     every screen that needed one drew it: the same shape as the finding that
     started this whole pass, one control down. components/Switch.tsx is the
     token; the entries went with the hand-drawing. */
  // a day CELL of the month grid, not a control with a label in it. The grid
  // sets the width — seven tracks in a 288px panel — where `.btn-icon` pins 28
  // and `.btn-sm` puts 13px either side of a two-digit number; and `.btn`
  // carries `font-semibold`, which is how this grid says which day is CHOSEN,
  // flattened across all forty-two at once. (The presets and the month arrows
  // in the same panel DID convert.)
  "components/DateTimeFields.tsx": 1,
  // a listbox OPTION is a menu ROW: start-aligned, with a leading colour dot.
  // `.btn` centres its contents and wears a button's padding, and a column of
  // those stops reading as a list to choose from. The platform's menu-row idiom
  // lives in rowActions (`ENTRY_CLASS`); that the two panels do not yet spell it
  // identically is a real finding and a bigger change than a class swap.
  "components/Select.tsx": 1,
  // the record transport: 40px round satellites around a 64px record button,
  // and two of the five wear that shape from rowActions (SelectMenu
  // variant="round"), so converting only the three here would leave four
  // circles beside one 11px-cornered rectangle — the symptom, in one row
  "components/echo/Recorder.tsx": 3,
  /* THE ACCOUNT AVATAR LEFT THIS LIST ON 2026-09-03, and the entry was wrong
     about the product while it sat here. It said the mark was "drawn
     identically in IconRail (the same person, the same shell)"; it was not —
     the menu's wore `bg-surface-2` with `text-fg` and a `border-border-strong`
     ring, the rail's foot wore `bg-accent-soft` with `text-accent` and no
     border, and both were on screen at the same time showing the same person.
     The entry's reasoning was right and its premise was not: `.btn-icon` was
     never the answer here, because the missing token was an AVATAR, not a
     button. components/Avatar.tsx is that token; the button now keeps the hit
     area, the aria and the press, and draws no circle at all, so this check
     stops seeing it — correctly, since a mark that is not pressable was never
     its business. */
  // the card's 16px TICK BOX — see the note below, which covers all five
  // copies of it. The board's other entry left on 2026-09-03: the column's tone
  // dot was a 10px pressable drawing its own circle, and it is now the same
  // `btn btn-icon` well as the swatches in the menu it opens, with the 10px dot
  // moved inside it — the picture unchanged, the target the theme's.
  "components/platform/TaskBoard.tsx": 1,
  // one each, and both the SAME 16px tick box — not a button, and not a shape
  // this file is asking anyone to change: TaskBoard, TaskViews and TaskDetail
  // draw it identically, so it is the platform agreeing with itself. `.btn-icon`
  // would put a 28px square beside a 14px line of text.
  "components/platform/meeting/ItemsPanel.tsx": 1,
  "components/platform/meeting/MiniTasks.tsx": 1,
  // a day CELL of the month grid, not a control with a label in it: `w-full` is
  // the grid's own seven-track width, `.btn-icon` would pin 28px and `.btn-sm`
  // would add 13px of padding either side of a two-digit number — and the grid
  // says which day is CHOSEN and which is TODAY with `font-bold` against the
  // rest, which `.btn`'s own `font-semibold` would half close on 42 cells.
  "components/platform/tasks/JalaliPicker.tsx": 1,
  // the checklist's tick box and the list row's, the same 16px one as above
  "components/platform/tasks/TaskDetail.tsx": 1,
  "components/platform/tasks/TaskViews.tsx": 1,
  // THREE, and it was recorded as two — the third is not new work, it is work
  // this check could not see. `openingTags` reads a tag for 1400 characters and
  // gives up, and the round transport trigger carried ~700 characters of prose
  // INSIDE its opening tag saying "the control guard counts this one": the
  // scanner stopped part-way through the className template, found no closing
  // backtick, and therefore no class attribute at all. The comment claiming it
  // was counted is what stopped it being counted. Moved out of the tag on
  // 2026-09-03; the number went up because the file got honest, not worse.
  // The three, all kept with the geometry as the reason:
  //  · the 40px ROUND transport trigger — a circle among circles (Recorder's
  //    five, and the dashboard's mini transport); one 11px-cornered rectangle
  //    in that row is the complaint itself.
  //  · the call-bar TILE — a clamp()ed height that tracks the viewport and a
  //    caption underneath; `.btn` is 38px at every width.
  //  · the option ✕ — 24px and `opacity-0` until hover. `.btn btn-icon`
  //    composes `.tap`, and a 44px hit area on an invisible DELETE would
  //    swallow the row beneath it.
  "components/rowActions.tsx": 3,
};

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments stripped, newlines KEPT so nothing downstream miscounts a line.
 *
 * STRING-AWARE, and it has to be (2026-09-03). The regex version stripped a
 * block comment wherever its opener appeared, INCLUDING inside a string — and
 * `accept="audio/*,video/mp4,video/webm"` in MeetingPage.tsx contains one. The
 * stripper opened a comment inside that attribute and blanked everything down
 * to the next closer several hundred lines below, taking the tag's own `>` with
 * it. The scanner then ran off the end of the file looking for that `>`.
 *
 * Nothing went red. The guard simply scanned a corrupted copy of that file and
 * reported on what it could still see — which is the naive-text-transform
 * family exactly, the same shape as an encoding sweep that skips its own
 * dotfiles. The fix is the same too: know what you are inside of before you
 * decide what a character means.
 */
function codeOnly(text: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (quote !== null) {
      if (ch === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
      if (ch === quote) quote = null;
      out += ch; i += 1; continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; out += ch; i += 1; continue; }
    if (ch === "/" && next === "*") {
      // blanked, newlines kept, so every line number downstream still holds
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop; continue;
    }
    if (ch === "/" && next === "/") {
      const nl = text.indexOf("\n", i);
      const stop = nl === -1 ? text.length : nl;
      out += " ".repeat(stop - i);
      i = stop; continue;
    }
    out += ch; i += 1;
  }
  return out;
}

/**
 * Every opening tag in a file, as `[tagName, theTagsText]`.
 *
 * Hand-written rather than regex'd in one shot because a JSX tag contains
 * braces, nested quotes and template literals, and a naive `<[^>]*>` stops at
 * the first `>` inside `{a > b}` — which would cut the className off exactly
 * the controls that have a conditional state. This tracks quote and brace
 * depth and stops at the `>` that actually closes the tag.
 */
/**
 * The scan window, and the record of what it could not see whole.
 *
 * The cap bounds a scan over the whole component tree; hitting it is a fact
 * about the INSTRUMENT, and a tag returned short reads exactly like a tag with
 * no geometry on it. That is not a hypothetical — see the test below.
 */
const TAG_SCAN_LIMIT = 20_000;
const truncatedTags: string[] = [];

function openingTags(code: string): [name: string, tag: string][] {
  const out: [string, string][] = [];
  for (const m of code.matchAll(/<([A-Za-z][A-Za-z0-9]*)\b/g)) {
    let i = m.index! + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    const buf: string[] = [];
    while (i < code.length && buf.length < TAG_SCAN_LIMIT) {
      const ch = code[i]!;
      if (quote !== null) {
        if (ch === quote && code[i - 1] !== "\\") quote = null;
        buf.push(ch); i += 1; continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; buf.push(ch); i += 1; continue; }
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
      buf.push(ch); i += 1;
    }
    if (buf.length >= TAG_SCAN_LIMIT) truncatedTags.push(m[1]!);
    out.push([m[1]!, buf.join("")]);
  }
  return out;
}

/** The class strings on a tag: both `className="…"` and the template form. */
function classAttributes(tag: string): string[] {
  const out: string[] = [];
  for (const m of tag.matchAll(/className=(["'])([\s\S]*?)\1/g)) out.push(m[2]!);
  for (const m of tag.matchAll(/className=\{`([^`]*?)`/g)) {
    /* the interpolations are kept, not blanked: `${on ? "rounded-full" : ""}`
       puts a real corner on a real element, and blanking it would let any
       geometry hide behind a ternary — the same hole one level in */
    out.push(m[1]!.replace(/\$\{/g, " ").replace(/[}"']/g, " "));
  }
  return out;
}

const PRESSABLE_TAGS = new Set(["button", "a", "Link", "summary"]);

function isPressable(name: string, tag: string): boolean {
  return PRESSABLE_TAGS.has(name) || tag.includes("onClick") || tag.includes('role="button"');
}

/** A FIXED height. `min-h-`/`max-h-` are what a flexible box uses to STAY
    flexible, and an early version of this check fired on `min-h-0` — reporting
    a card the moment it was made more flexible rather than less. */
const FIXED_HEIGHT = /(?<![\w-])h-(?:\d+(?:\.\d+)?|\[[^\]]+\])(?![\w-])/;
/** Any corner, including the logical (`rounded-s-lg`) and bare (`rounded`)
    forms the old size-suffix pattern walked straight past. */
const CORNER = /\brounded(?:-[a-z]+)?(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?\b/;

function pressableCount(code: string): number {
  let n = 0;
  for (const [name, tag] of openingTags(code)) if (isPressable(name, tag)) n += 1;
  return n;
}

/**
 * R4 — THE THEME'S OWN DOOR (user ruling 2026-09-05, "go with a": three
 * control sizes, no fourth).
 *
 * The check above catches a control drawn WITHOUT the theme. This one catches
 * the twelfth shape coming back THROUGH it: `btn-primary h-9 min-h-0 px-3
 * text-xs`, `btn-secondary h-10`, `btn h-[34px]` — twenty static sites and
 * the measured task panels had re-sized a themed control by hand, in five
 * heights (28 / 32 / 36 / 40 / auto). `min-h-0` is the tell: it exists only
 * to defeat `.btn`'s own minimum, and where it was missing the hand height
 * silently lost to that minimum and rendered at 38 anyway (the panel chips:
 * written 34, measured 42). Either way the family had a fourth size on the
 * page, which is the complaint this file exists for.
 *
 * So: on a pressable element wearing `btn`, a fixed height, a min-height
 * override or a text size is the finding. Width is not (a footer button may
 * be `w-full`), and `h-full` is not (stretching to a row is not picking a
 * size). Sizes are `btn` / `btn-sm` / `btn-icon`, and nothing else.
 */
const RESIZED_THEME_CONTROL =
  /(?<![\w-])(?:min-h-(?:0|\d[\w.]*|\[[^\]]+\])|h-(?:\d+(?:\.\d+)?|\[[^\]]+\]|auto)|text-(?:xs|sm|base|lg|xl|\d?xl|\[[^\]]+\]))(?![\w-])/;

function resizedThemeControls(code: string): string[] {
  const out: string[] = [];
  for (const [name, tag] of openingTags(code)) {
    if (!isPressable(name, tag)) continue;
    for (const cls of classAttributes(tag)) {
      if (!/\bbtn\b|\bbtn-/.test(cls)) continue;
      const hit = cls.match(RESIZED_THEME_CONTROL);
      if (hit) out.push(`${name}: ${hit[0]} in "${cls.trim().replace(/\s+/g, " ")}"`);
    }
  }
  return out;
}

function handRolled(code: string): number {
  let n = 0;
  for (const [name, tag] of openingTags(code)) {
    if (!isPressable(name, tag)) continue;
    for (const cls of classAttributes(tag)) {
      if (/\bbtn\b|\bbtn-/.test(cls)) continue;
      if (!FIXED_HEIGHT.test(cls)) continue;
      if (!CORNER.test(cls)) continue;
      n += 1;
    }
  }
  return n;
}

describe("controls share one shape", () => {
  it("has something to check — the product is mostly pressable elements using .btn", () => {
    /* the vacuum guard, both directions: a scanner that found no tags, or a
       tree with no `.btn` in it, would make every assertion below pass by
       having no subject */
    let users = 0;
    let pressables = 0;
    for (const file of sources(SRC)) {
      const code = codeOnly(readFileSync(file, "utf8"));
      if (/\bbtn(?:-\w+)?\b/.test(code)) users += 1;
      pressables += pressableCount(code);
    }
    expect(users).toBeGreaterThan(20);
    expect(pressables).toBeGreaterThan(300);
  });

  it("can answer NO — every shape that used to hide from this check now counts", () => {
    /*
     * THE CONTROL, and the reason this guard is worth anything after
     * 2026-09-03. Each string below is a shape that shipped and was invisible
     * to some earlier version of this file. "No hits" reads identically
     * whether a tree is clean or a pattern is blind, so the pattern is run
     * against what it must catch AND against what it must never claim.
     */
    const caught = {
      flexQuoted: '<button className="tap flex h-9 w-9 items-center justify-center rounded-xl" />',
      /* invisible until the grid spelling was added — eighty of these */
      grid: '<button className="tap grid h-9 w-9 place-items-center rounded-xl" />',
      /* invisible until template classNames were read — thirty of these */
      template: '<button className={`tap flex h-9 items-center rounded-xl ${on ? "bg-accent" : ""}`} />',
      /* the corner hidden in a ternary: blanking interpolations would miss it */
      cornerInBranch: '<button className={`grid h-9 place-items-center ${on ? "rounded-full" : "rounded-md"}`} />',
      /* NO centring word at all — the shape the three-utility rule could never
         see, and the one the conversion agents kept finding by reading */
      noCentring: '<button className="tap h-9 rounded-xl px-3" />',
      /* the LOGICAL corner, which the size-suffix pattern walked past */
      logicalCorner: '<button className="tap h-8 rounded-s-lg px-2" />',
      /* a bare `rounded`, no size */
      bareCorner: '<button className="tap h-6 w-6 rounded" />',
      /* an arbitrary height */
      arbitraryHeight: '<button className="h-[38px] rounded-xl" />',
      /* a div that behaves as a button */
      divButton: '<div onClick={go} className="h-9 rounded-lg" />',
      /* and a link drawn as a control */
      link: '<Link href="/x" className="h-9 rounded-xl px-3" />',
    };
    for (const [name, code] of Object.entries(caught)) {
      expect(handRolled(code), `${name} must count as hand-rolled`).toBe(1);
    }

    const ignored = {
      /* the theme's own controls */
      themed: '<button className="btn btn-icon border border-border" />',
      themedTemplate: '<button className={`btn btn-sm ${on ? "bg-accent" : ""}`} />',
      /* AN AVATAR — the reason this guard is scoped to pressable elements at
         all. It is the same three utilities the old rule fired on, and it is
         not a control; 85 entries like it used to sit in the worklist saying
         so, one at a time. */
      avatar: '<span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft" />',
      iconWell: '<div className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2" />',
      /* a flexible pressable row: min-h- means the OPPOSITE of a drawn height */
      flexible: '<button className="flex min-h-0 items-center rounded-xl" />',
      /* spacing alone, and a corner alone, on a real button */
      heightOnly: '<button className="h-9 px-3" />',
      cornerOnly: '<button className="rounded-xl px-3" />',
      /* an unstyled text link is not a hand-rolled control */
      textLink: '<a href="/x" className="text-sm text-accent underline" />',
    };
    for (const [name, code] of Object.entries(ignored)) {
      expect(handRolled(code), `${name} must NOT count`).toBe(0);
    }
  });

  it("saw WHOLE tags — a truncated one is not a clean one", () => {
    /*
     * The instrument's own honesty check, and it exists because this guard
     * lied once (2026-09-03).
     *
     * `openingTags` bounds each tag at TAG_SCAN_LIMIT characters. A tag that
     * hits the cap is returned WITHOUT its className — which reads exactly
     * like a tag that has no geometry on it. A comment written between the
     * attributes of Select.tsx's option row pushed that tag past the window,
     * and the guard reported the file as no longer hand-rolling anything. The
     * obvious response was to lower the recorded count, which would have baked
     * the blindness in permanently.
     *
     * It runs after the scans above, so `truncatedTags` holds whatever this
     * run could not see whole.
     */
    expect(truncatedTags, "tags too long to scan — the verdict above excluded them")
      .toEqual([]);
  });

  it("reads a tag whose attributes contain a comparison, rather than stopping at it", () => {
    /* the scanner's own control: a naive `<[^>]*>` ends the tag at the `>` in
       `{a > b}` and never reaches the className, which would silently exempt
       exactly the conditional controls this check exists for */
    expect(handRolled('<button disabled={count > 3} className="h-9 rounded-xl" />')).toBe(1);
  });

  it("no file hand-rolls MORE button geometry than its recorded count", { timeout: 30_000 }, () => {
    const wrong: string[] = [];
    for (const file of sources(SRC)) {
      if (file.split(/[\\/]/).includes("ui")) continue; // shadcn source owns its own variants
      const rel = relative(SRC, file).split("\\").join("/");
      const found = handRolled(codeOnly(readFileSync(file, "utf8")));
      const allowed = REMAINING[rel] ?? 0;
      if (found > allowed) wrong.push(`${rel}: ${found} hand-rolled, ${allowed} recorded`);
      if (found < allowed) wrong.push(`${rel}: ${found} hand-rolled but ${allowed} recorded — lower the number`);
    }
    expect(
      wrong,
      "use .btn / .btn-sm / .btn-icon, or update the worklist:\n" + wrong.join("\n"),
    ).toEqual([]);
  });

  it("R4: a themed control keeps the theme's size — and the check can answer NO", () => {
    /*
     * Both directions again, because "no hits" reads identically whether the
     * tree is clean or the pattern is blind. The caught set is what shipped:
     * the `min-h-0` override, the hand height that silently LOST to `.btn`'s
     * minimum, a size pushed through a text utility, the template form, and a
     * Link drawn as a button.
     */
    const caught = {
      minHZero: '<button className="btn-primary h-9 min-h-0 px-3 text-xs" />',
      heightLostToMinimum: '<button className="btn h-[34px] rounded-[9px]" />',
      autoHeight: '<button className="btn-secondary h-auto min-h-0" />',
      textSize: '<button className="btn text-sm" />',
      template: '<button className={`btn h-[32px] flex-1 ${on ? "bg-surface" : ""}`} />',
      link: '<Link href="/x" className="btn-primary h-10 px-4" />',
    };
    for (const [name, code] of Object.entries(caught)) {
      expect(resizedThemeControls(code), `${name} must count`).toHaveLength(1);
    }

    const ignored = {
      regular: '<button className="btn" />',
      compact: '<button className={`btn btn-sm ${on ? "bg-accent text-on-accent" : ""}`} />',
      icon: '<button className="btn btn-icon border border-border" />',
      /* width is not a size: a footer button may fill its row */
      fullWidth: '<button className="btn-danger w-full" />',
      /* stretching to a row is not picking a size */
      stretch: '<button className="btn h-full" />',
      /* a badge INSIDE a control sizes its own digits; the control does not */
      childBadge: '<button className="btn btn-sm"><span className="text-[10px]">3</span></button>',
      /* drawn without the theme at all — the other check's business, not this one's */
      notThemed: '<button className="h-9 rounded-xl px-3" />',
    };
    for (const [name, code] of Object.entries(ignored)) {
      expect(resizedThemeControls(code), `${name} must NOT count`).toHaveLength(0);
    }
  });

  it("R4: no themed control in the tree re-sizes itself", () => {
    /*
     * No worklist here, deliberately. The other check carries one because a
     * day cell or a round transport genuinely has geometry the family lacks;
     * a control that ALREADY wears `btn` has no such argument — it chose the
     * family and then overrode it. Twenty sites did on 2026-09-05 and every one
     * converted to `btn`, `btn-sm` or `btn-icon` without losing a thing.
     */
    const wrong: string[] = [];
    for (const file of sources(SRC)) {
      if (file.split(/[\\/]/).includes("ui")) continue; // shadcn source owns its own variants
      const rel = relative(SRC, file).split("\\").join("/");
      for (const hit of resizedThemeControls(codeOnly(readFileSync(file, "utf8")))) {
        wrong.push(`${rel}: ${hit}`);
      }
    }
    expect(
      wrong,
      "three sizes — .btn / .btn-sm / .btn-icon. A height, min-height or text size beside `btn` is a fourth:\n"
        + wrong.join("\n"),
    ).toEqual([]);
  });
});
