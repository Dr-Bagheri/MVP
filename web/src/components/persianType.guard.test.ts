import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * NO LETTER-SPACING, NO UPPERCASE, ON COPY A PERSIAN READER SEES.
 *
 * Persian is a joined script: `letter-spacing` pushes the letters of a word
 * apart at the joins, so a tracked label does not read as "wide", it reads as
 * BROKEN — and `text-transform: uppercase` does nothing at all to it while
 * shouting on the English half of the same bilingual product.
 *
 * The repo already knew this. globals.css says it in prose — "NO tracking:
 * letter-spacing breaks joined Persian script" — and SectionMenu.tsx repeats
 * it at its group labels. Then `.table-head`, seventeen lines BELOW that
 * sentence, shipped `uppercase tracking-wide` onto every table header in the
 * product, and eight more sites hand-spelled the same small-caps line. A rule
 * in prose protects only whoever is currently remembering it (rule 13).
 *
 * The scaffold's own role for these labels is `text-group-label` (11px,
 * "group labels, table headers" — constants.ts), which is what they all wear
 * now.
 *
 * SCOPE: the class strings a component writes. This cannot see a computed
 * style, so it is a source check by construction — but the failure it guards
 * is a source-level habit (someone types the small-caps idiom out of Latin
 * muscle memory), which is the level where it can be stopped.
 */
const SRC = join(process.cwd(), "src");

/** `tracking-wide|wider|widest` and `uppercase`, as whole Tailwind classes. */
const OFFENDING = /(?<![\w-])(?:tracking-(?:wide|wider|widest)|uppercase)(?![\w-])/;

/**
 * Deliberate exceptions, each with the reason it is not a Persian problem.
 *
 * An entry here is a decision. The answer to a false positive is a named
 * entry, never a loosened pattern — and an entry for a file that no longer
 * exists reads as coverage while being a hole, so the last test checks that
 * every one of these still names a real file.
 */
const ALLOWED: Record<string, string> = {
  /*
   * The front page's section labels, and the entry is narrower than it looks:
   * the uppercase-and-tracking pair lives in the LATIN branch of a locale
   * gate, and the Persian branch takes the platform's `text-group-label`
   * role instead. The guard fired on the first version, which applied both to
   * every label regardless of language — correctly, and it was not a lint
   * nit: a Persian reader would have seen a word pulled apart into letters.
   * What is allowed here is a device that only ever reaches Latin text.
   */
  "components/site/MarketingSite.tsx":
    "the section labels' mono caps are the LATIN branch of a locale gate — " +
    "Persian takes text-group-label, which is built for joined script",
  "components/ui/dropdown-menu.tsx":
    "the shortcut hint (⌘K, Ctrl+E) — a Latin key glyph, never translated copy, " +
    "and the tracking is what keeps two key names from reading as one word",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => file.slice(SRC.length + 1).replace(/\\/g, "/");

/** Every offending line in the tree, comments stripped. */
function offenders(): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const key = rel(file);
    if (key in ALLOWED) continue;
    /* comments stripped: this file NAMES the classes it forbids, and a guard
       that reads its own prose as code is the name-matching-itself trap the
       stacking guard already fell into once */
    const text = readFileSync(file, "utf8")
      /* a stripped comment keeps its NEWLINES: replacing a block comment with
         a single space collapses the file and every line number after it is
         reported wrong — a red that names the wrong line sends the next
         reader to innocent code */
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/^\s*\/\/.*$/gm, " ");
    text.split(/\r?\n/).forEach((line, i) => {
      if (OFFENDING.test(line)) hits.push(`${key}:${i + 1}`);
    });
  }
  return hits;
}

describe("Persian-first typography", () => {
  it("has a corpus to check", () => {
    /* the vacuum guard: a walk that found nothing, or an extension filter that
       matched nothing, would make the assertion below pass by having no subject */
    expect(walk(SRC).length).toBeGreaterThan(200);
  });

  it("spells no label with uppercase or letter-spacing", () => {
    const hits = offenders();
    expect(
      hits,
      "letter-spacing breaks joined Persian script and uppercase shouts in English; " +
      "use the scaffold's `text-group-label` role (11px, group labels and table " +
      `headers). If a site is genuinely Latin-only, add it to ALLOWED with the reason: ${hits.join(", ")}`,
    ).toEqual([]);
  });

  it("can answer NO — the pattern matches the idiom it forbids", () => {
    /*
     * The negative control. "No hits" also holds when the regex is wrong, the
     * walk is empty, or the strip ate the file — so the same pattern is run
     * against the exact strings that shipped, and against ones it must NOT
     * claim. Without this the check cannot tell a clean tree from a broken
     * parser.
     */
    expect(OFFENDING.test('className="text-xs font-semibold uppercase tracking-wide text-fg-subtle"')).toBe(true);
    expect(OFFENDING.test("@apply text-start text-xs font-semibold uppercase tracking-wide text-fg-muted;")).toBe(true);
    expect(OFFENDING.test('className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"')).toBe(true);
    /* and the near-misses it must leave alone: `tracking-tight` is negative
       letter-spacing on a Latin display line, `tracking-normal` is the reset,
       and a word merely CONTAINING "uppercase" is not the class */
    expect(OFFENDING.test('className="tracking-tight"')).toBe(false);
    expect(OFFENDING.test('className="tracking-normal"')).toBe(false);
    expect(OFFENDING.test("const toUppercase = (s: string) => s;")).toBe(false);
  });

  it("names a real file in every exception", () => {
    /* an allow-list entry for a deleted file reads as coverage and is a hole */
    for (const [file, why] of Object.entries(ALLOWED)) {
      expect(why.length, `${file} needs a reason`).toBeGreaterThan(20);
      expect(() => statSync(join(SRC, file)), `${file} is listed but does not exist`).not.toThrow();
    }
  });
});
