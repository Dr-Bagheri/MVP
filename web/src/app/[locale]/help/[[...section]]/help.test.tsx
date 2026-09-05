import { Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import fa from "../../../../messages/fa.json";
import { HELP_SECTIONS } from "../sections";

/**
 * Every help section in the menu renders ITS OWN page — asserted with a
 * positive ID per section and a negative control.
 *
 * Why this file exists: the guide's step keys are COMPUTED
 * (`s.${slug}.step${n}`), so `keys.test.ts` deliberately never sees them —
 * a section added to `HELP_SECTIONS` with no catalogue entries would render
 * raw key paths in production while every existing check stayed green. The
 * coverage list is imported from the producer (`../sections`), not
 * hand-enumerated here, so a new section is covered the moment it exists.
 *
 * The POSITIVE ID is each section's own step text, which exists on no other
 * page. Asserting presence alone cannot distinguish "this section rendered"
 * from "every section's copy is in every document" (the en-sweep lesson), so
 * each render also asks for ANOTHER section's step — a question it must
 * answer NO to.
 */

/* the locale this render is for; the next-intl stub reads the REAL
   catalogues, so a missing key renders as its key path and fails getByText */
let locale: "en" | "fa" = "fa";
const catalogue = { en, fa } as unknown as Record<
  string,
  Record<string, Record<string, unknown>>
>;

vi.mock("next-intl", () => {
  const table = (namespace: string) => catalogue[locale]?.[namespace] ?? {};
  const walk = (root: Record<string, unknown>, key: string): unknown =>
    key.split(".").reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      root,
    );
  return {
    useTranslations: (namespace: string) => {
      const t = (key: string) => {
        const value = walk(table(namespace), key);
        return typeof value === "string" ? value : `${namespace}.${key}`;
      };
      t.raw = (key: string): unknown => {
        const value = walk(table(namespace), key);
        if (value === undefined) throw new Error(`missing message: ${namespace}.${key}`);
        return value;
      };
      return t;
    },
    useLocale: () => locale,
  };
});

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/help",
}));

/* the shell is another surface with its own reads; this page is the subject */
vi.mock("@/components/platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: HelpPage } = await import("./page");

/** step text straight from the catalogue — the producer's copy, not a guess */
function step(loc: "fa" | "en", slug: string, n: number): string {
  const s = (catalogue[loc]!.help as Record<string, Record<string, Record<string, string>>>).s ?? {};
  const value = s[slug]?.[`step${n}`];
  if (typeof value !== "string") throw new Error(`missing ${loc} help.s.${slug}.step${n}`);
  return value;
}

async function open(section?: string[]) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <HelpPage params={Promise.resolve({ section })} />
      </Suspense>,
    );
  });
}

afterEach(cleanup);

describe("every section in the menu renders its own page", () => {
  it("has sections to check at all", () => {
    // if the producer's list shrank to nothing, the loops below pass empty
    expect(HELP_SECTIONS.length).toBeGreaterThanOrEqual(8);
  });

  for (const [i, section] of HELP_SECTIONS.entries()) {
    const other = HELP_SECTIONS[(i + 1) % HELP_SECTIONS.length]!;
    it(`${section.slug}: its own steps render; ${other.slug}'s do not`, async () => {
      locale = "fa";
      await open(section.slug === "overview" ? undefined : [section.slug]);
      // positive ID: first and last step — unique to this section
      expect(screen.getByText(step("fa", section.slug, 1))).toBeTruthy();
      expect(screen.getByText(step("fa", section.slug, section.steps))).toBeTruthy();
      // NEGATIVE CONTROL: a marker that must fail — this is what separates
      // "this page rendered" from "every marker matches everywhere"
      expect(screen.queryByText(step("fa", other.slug, 1))).toBeNull();
    });
  }

  it("lists every section in the side menu, linked to its address", async () => {
    locale = "fa";
    await open();
    for (const section of HELP_SECTIONS) {
      const href = section.slug === "overview" ? "/help" : `/help/${section.slug}`;
      const links = Array.from(document.querySelectorAll(`a[href="${href}"]`));
      expect(links.length, `menu link for ${section.slug}`).toBeGreaterThan(0);
    }
  });

  it("falls back to the overview for an unknown slug", async () => {
    locale = "fa";
    await open(["no-such-section"]);
    expect(screen.getByText(step("fa", "overview", 1))).toBeTruthy();
  });
});

describe("both catalogues carry every step the page will ask for", () => {
  /*
   * keys.test.ts skips computed keys by design; this walk is the coverage it
   * cannot provide. Persian-first means the fa side is the one everyone sees
   * while writing — the en side is the one that rots (locale corollary).
   */
  for (const loc of ["fa", "en"] as const) {
    it(`${loc}: section and every stepN exist — and no orphans`, () => {
      const help = catalogue[loc]!.help as Record<string, Record<string, unknown>>;
      const slugs = HELP_SECTIONS.map((s) => s.slug);
      // titles: exactly the producer's set, nothing stale (no `desc` — R21,
      // a guide section is its name and its steps, with no sentence between)
      expect(Object.keys(help.section!).sort()).toEqual([...slugs].sort());
      expect(help.desc, "help.desc must not come back").toBeUndefined();
      // steps: every declared step exists, and no undeclared step lingers —
      // an orphaned step key is copy nobody will ever see wearing the look
      // of coverage
      const s = help.s as Record<string, Record<string, string>>;
      expect(Object.keys(s).sort()).toEqual([...slugs].sort());
      for (const section of HELP_SECTIONS) {
        const keys = Object.keys(s[section.slug]!).sort();
        const wanted = Array.from({ length: section.steps }, (_, i) => `step${i + 1}`).sort();
        expect(keys, `help.s.${section.slug} (${loc})`).toEqual(wanted);
        for (const key of wanted) {
          expect(s[section.slug]![key]!.length, `${loc} ${section.slug}.${key}`).toBeGreaterThan(10);
        }
      }
    });
  }

  it("keeps each locale in its own script — no mixed-language steps", () => {
    const arabicScript = /[؀-ۿ]/;
    for (const section of HELP_SECTIONS) {
      for (let n = 1; n <= section.steps; n++) {
        // fa copy must actually be Persian (Latin brand names may appear)
        expect(arabicScript.test(step("fa", section.slug, n)),
          `fa ${section.slug}.step${n} contains no Persian`).toBe(true);
        // en copy must carry no Persian at all
        expect(arabicScript.test(step("en", section.slug, n)),
          `en ${section.slug}.step${n} contains Persian`).toBe(false);
      }
    }
  });
});
