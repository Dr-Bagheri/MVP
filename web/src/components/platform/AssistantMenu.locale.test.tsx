import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/api/types";
import en from "../../messages/en.json";
import fa from "../../messages/fa.json";

/**
 * The mixing bug, asserted on the RENDERED menu (user report, with a
 * screenshot: the English UI's Suggestions rows read Persian questions).
 *
 * Why this file exists beside `lib/skillName.test.ts`, which already proves
 * the resolver: the resolver was never broken. The consumer read
 * `skill.starter_questions` straight off the wire and simply never called it —
 * a unit test of the localizer passes in full while the screen the user is
 * looking at renders Persian. The seam between a correct helper and a consumer
 * that opted out is only visible from the component.
 *
 * **Every assertion here has a NEGATIVE half.** `getByText(english)` cannot
 * tell "the English string rendered" from "both strings rendered" — which is
 * precisely the defect being fixed, since the complaint is about MIXING, not
 * about English being absent. So each locale asserts its own copy present AND
 * the other language's copy absent.
 */

/* the locale this render is for; the next-intl stub below reads it, so one
   file can drive both languages against the REAL message catalogues */
let locale: "en" | "fa" = "en";
const catalogue = { en, fa } as unknown as Record<string, Record<string, Record<string, unknown>>>;

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
        /* a miss renders as the key path, never as a plausible string — a stub
           that invents copy would pass this test against a missing catalogue */
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
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={String(href)} {...props}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/assistant",
}));

const filled: { text: string; skillSlug: string }[] = [];
vi.mock("@/lib/assistantBus", async (importOriginal) => ({
  /* the REAL module, with one function replaced — a hand-written stub of a
     module with seven exports is a stub that goes stale the day an eighth
     lands, which is exactly how this one broke when the subject moved */
  ...(await importOriginal<typeof import("@/lib/assistantBus")>()),
  fillComposer: (draft: { text: string; skillSlug: string }) => { filled.push(draft); },
}));

let skills: Skill[] = [];
vi.mock("@/api/client", () => ({
  api: {
    skills: () => Promise.resolve(skills),
    agentSessions: () => Promise.resolve([]),
    me: () => Promise.resolve(null),
    /* the hub's own reads — the suggestions moved onto it (2026-09-02), so
       this file follows them: the seam it guards is "a component renders the
       wire instead of the resolver", and that seam is wherever the rows are */
    models: () => Promise.resolve({ models: [], preferred_model: null }),
    agents: () => Promise.resolve([]),
    workflows: () => Promise.resolve([]),
    assistantTools: () => Promise.resolve([]),
    connectors: () => Promise.resolve([]),
    autonomy: () => Promise.resolve(null),
  },
  BffError: class extends Error {},
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/assistant",
  Link: ({ href, children }: { href: unknown; children: unknown }) =>
    <a href={typeof href === "string" ? href : "#"}>{children as never}</a>,
}));

const { Hub } = await import("./Hub");

/* the SEEDED row, exactly as db/0061 writes it and the wire serves it: a
   system skill whose starter questions are Persian literals. This is the
   fixture that matters — a hand-written English payload could never reproduce
   the bug, because the bug IS the Persian arriving from the server. */
const SEEDED_TASKS = {
  slug: "tasks",
  level: "system",
  name: "استخراج کارها",
  starter_questions: [
    "کارهای این تماس را فهرست کن",
    "چه کارهایی به من سپرده شد؟",
    "مهلت‌های گفته‌شده را جمع کن",
  ],
} as unknown as Skill;

/* an ORG-authored skill, in Persian, that must stay Persian in BOTH locales —
   the control that keeps the fix honest. Without it a blanket "translate every
   suggestion" would pass every other assertion in this file while quietly
   rewriting somebody's own words. */
const AUTHORED = {
  slug: "weekly-recap",
  level: "org",
  name: "جمع‌بندی هفتگی",
  starter_questions: ["جمع‌بندی هفتهٔ گذشته را بنویس"],
} as unknown as Skill;

const EN_FIRST = (en.skills.starters_tasks as string[])[0]!;
const FA_FIRST = (fa.skills.starters_tasks as string[])[0]!;

async function renderMenu(as: "en" | "fa") {
  locale = as;
  render(<Hub />);
  /* anchored on a value that only exists AFTER the skills fetch resolves —
     awaiting "the Persian is gone" would pass instantly against the empty
     pre-fetch menu, which is a green that proves nothing */
  await screen.findByText(as === "en" ? EN_FIRST : FA_FIRST);
}

describe("the hub’s suggestions never mix languages", () => {
  beforeEach(() => {
    skills = [SEEDED_TASKS, AUTHORED];
    filled.length = 0;
  });
  afterEach(cleanup);

  it("en: a shipped skill's starter renders in English, and the seeded Persian is ABSENT", async () => {
    await renderMenu("en");
    expect(screen.getByText(EN_FIRST)).toBeTruthy();
    // the discriminating half: present-and-also-Persian is the reported bug
    expect(screen.queryByText(FA_FIRST)).toBeNull();
  });

  it("fa: the control — the same row renders the Persian, and not the English", async () => {
    await renderMenu("fa");
    expect(screen.getByText(FA_FIRST)).toBeTruthy();
    expect(screen.queryByText(EN_FIRST)).toBeNull();
  });

  it("en: an ORG-authored skill's starter stays exactly as its author wrote it", async () => {
    await renderMenu("en");
    expect(screen.getByText(AUTHORED.starter_questions[0]!)).toBeTruthy();
  });

  it("en: the composer is filled with the words the row showed, not the wire's", async () => {
    /*
     * On the HUB the suggestion IS the composer's own control, so it sets the
     * value directly rather than going through the bus — the bus exists for
     * the case where the row and the box are on different screens, which this
     * no longer is (2026-09-02).
     *
     * The assertion that matters is unchanged and is the whole point of the
     * file: what lands in the box is the string the ROW SHOWED, not the
     * Persian the wire carried.
     */
    await renderMenu("en");
    await act(async () => { fireEvent.click(screen.getByText(EN_FIRST)); });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe(EN_FIRST);
    expect(box.value).not.toContain("تماس");
  });
});
