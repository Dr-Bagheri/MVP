import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/api/client", () => ({ api: {} }));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/en",
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ children }: { children: unknown }) => children,
}));

import { DOCK_HEADER_BUTTON } from "./PresenceDock";

/**
 * **The dock header's controls are laid out by ONE rule.**
 *
 * User report, 2026-08-29: "put the speaker icon in orb AI in center
 * vertically also". The cause was not a margin. A `<button>` is
 * `inline-block` and `.icon` is `inline-grid`, so a lone icon inside a
 * button is INLINE CONTENT — it sits on the text baseline with the line
 * box's descender space beneath it, and rides high inside its own 28px
 * square. Three of the four header controls were written that way; the
 * ears button had `inline-flex items-center justify-center` and was
 * centred, which is what made the speaker read as misaligned against a
 * sibling rather than as a header that was uniformly off.
 *
 * **Why this is a source guard and not a render assertion.** jsdom
 * performs no layout — every `getBoundingClientRect` is zeros — so the
 * property that actually broke (where the glyph sits inside its box) is
 * unmeasurable in this runtime. Asserting the visible symptom is a
 * browser's job. What CAN be mechanized here is the thing that made the
 * symptom possible in the first place: four buttons, four hand-written
 * class strings, one of which drifted. So this is the `rhythm.guard`
 * shape — the named rule may be the only spelling, and the literal the
 * copies were made of may not come back.
 *
 * Two properties keep it from passing vacuously:
 *
 *  - it must FIND all four controls by their aria-labels, and says so as a
 *    failure if it does not (a header this checker cannot locate is an
 *    unknown result, never a pass);
 *  - the same extractor is run over a synthetic source with one
 *    hand-written button, and is required to REJECT it. A check that only
 *    ever asks "is the rule present?" cannot tell a working guard from one
 *    that says yes to everything.
 */

const SOURCE = join(process.cwd(), "src", "components", "platform", "PresenceDock.tsx");

/**
 * The four controls in the panel header, named by the aria-label each one
 * renders. Deliberately the ACCESSIBLE name rather than a position or an
 * icon name: it is the one attribute that identifies a control without
 * describing how it looks, so this list does not have to be re-derived
 * every time the header is restyled.
 */
const HEADER_CONTROLS = ["silentLabel", "earsLabel", "newConversation", "close"] as const;

/**
 * The opening `<button …>` tag that owns a given `aria-label={t("…")}`.
 *
 * Walks back from the label to the nearest preceding `<button`, which is
 * that button's own tag as long as buttons are not nested — they are not,
 * and cannot be: a button inside a button is invalid HTML.
 *
 * Returns `null` when the label is not in the source at all. The caller
 * treats that as a failed identification rather than a satisfied rule.
 */
function buttonTagFor(source: string, label: string): string | null {
  const at = source.indexOf(`aria-label={t("${label}")}`);
  if (at === -1) return null;
  const open = source.lastIndexOf("<button", at);
  if (open === -1) return null;
  return source.slice(open, at);
}

describe("the assistant dock's header controls", () => {
  const source = readFileSync(SOURCE, "utf8");

  it("finds all four controls — the header this test is about is really there", () => {
    /*
     * The identification, asserted before anything is concluded from it.
     * If the header is renamed or rebuilt, this fails as "I could not find
     * my subject" instead of reporting a clean pass over nothing.
     */
    const missing = HEADER_CONTROLS.filter((label) => buttonTagFor(source, label) === null);
    expect(missing, "header controls this checker could not locate").toEqual([]);
  });

  it("lays every one of them out with the shared rule, not a hand-written copy", () => {
    for (const label of HEADER_CONTROLS) {
      const tag = buttonTagFor(source, label);
      expect(tag, label).not.toBeNull();
      expect(tag, `${label} composes DOCK_HEADER_BUTTON`).toContain("DOCK_HEADER_BUTTON");
    }
  });

  it("centres the glyph in the box — the property the report was about", () => {
    /*
     * The constant's own content, asserted once and in one place. `h-7 w-7`
     * alone was the broken version: a box of the right size whose contents
     * still sat on the baseline. The centring is `inline-flex` +
     * `items-center`, and it is the half that was missing.
     */
    expect(DOCK_HEADER_BUTTON).toContain("inline-flex");
    expect(DOCK_HEADER_BUTTON).toContain("items-center");
    expect(DOCK_HEADER_BUTTON).toContain("justify-center");
    expect(DOCK_HEADER_BUTTON).toContain("h-7");
    expect(DOCK_HEADER_BUTTON).toContain("w-7");
  });

  it("keeps the hand-written box literal out of every className in the file", () => {
    /*
     * The literal the three broken copies were made of. Its return in a
     * `className` means a fifth control was written by hand — which is how
     * the fourth one drifted.
     *
     * Scoped to `className=` on purpose, and the first draft was NOT: a bare
     * search for the literal came back red on `DOCK_HEADER_BUTTON`'s own
     * definition — the constant this rule exists to concentrate the literal
     * INTO. That is the name-matched-itself shape, a substring that cannot
     * tell a use from the declaration it lives in, so the pattern now
     * matches the form a real use has to take.
     */
    const handWritten = source.match(/className=[{`"][^`"]*h-7 w-7/g) ?? [];
    expect(handWritten, "`h-7 w-7` written into a className").toEqual([]);
  });

  it("REJECTS a header control written by hand — the control that makes the rest mean something", () => {
    /*
     * The negative control, run through the same extractor. Without it,
     * "every button carries the constant" is indistinguishable from an
     * extractor that returns something containing the constant no matter
     * what it is handed.
     */
    const synthetic = `
      <button
        type="button"
        className="tap h-7 w-7 rounded-md text-fg-muted"
        aria-label={t("close")}
      >`;
    const tag = buttonTagFor(synthetic, "close");
    expect(tag).not.toBeNull();
    expect(tag).not.toContain("DOCK_HEADER_BUTTON");
  });
});
