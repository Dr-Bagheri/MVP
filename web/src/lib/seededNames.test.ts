import { describe, expect, it, vi } from "vitest";
import fa from "../messages/fa.json";
import en from "../messages/en.json";

let locale: "fa" | "en" = "en";
/* `useLocale` too, from 2026-09-08. This file's mock replaces next-intl for
   EVERY component the test renders, and since messages became toasts the
   harness mounts the platform's stack alongside whatever is under test — so
   a mock missing a hook the stack calls fails this suite with an error about
   a component it has no opinion about. */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => {
    const table = (locale === "fa" ? fa : en) as unknown as Record<string, Record<string, string>>;
    return table[ns]?.[key] ?? `${ns}.${key}`;
  },
  useLocale: () => locale,
}));

const { useSeededName } = await import("./seededNames");

/**
 * The board writes its four columns into the database in Persian on an
 * organisation's first visit, so an English reader saw «بک‌لاگ» above their
 * cards — and nothing was malfunctioning: the product had written Persian
 * into a table and read it back.
 */
describe("seeded column names", () => {
  it("translate while they are still what we shipped", () => {
    locale = "en";
    const name = useSeededName();
    expect(name("بک‌لاگ")).toBe("Backlog");
    expect(name("انجام‌شده")).toBe("Done");
  });

  it("CONTROL: a renamed column keeps its own word, in every language", () => {
    /*
     * The half that makes this safe rather than merely present. Without it,
     * "seeded names translate" quietly becomes "overwrite whatever is
     * stored", and somebody's rename disappears the next time they switch
     * language — the same failure the workflow catalogue is guarded against.
     */
    locale = "en";
    const name = useSeededName();
    expect(name("ستون فروش")).toBe("ستون فروش");
    expect(name("Sprint 4")).toBe("Sprint 4");
  });

  it("in Persian the seeded name is unchanged — it is already the catalogue's", () => {
    locale = "fa";
    const name = useSeededName();
    expect(name("بک‌لاگ")).toBe("بک‌لاگ");
  });

  /**
   * THE OTHER PRODUCER, AND THE DIRECTION NOBODY LOOKS AT (2026-09-09).
   *
   * Two things seed a board: core's `DEFAULT_COLUMNS`, in Persian, on an
   * organisation's first visit; and the demo console's English language pack
   * (`demo-seed/content.en.ts`), which writes "Backlog / To do / In progress
   * / Done". The map knew only the first, so an English-seeded board could
   * not be read in Persian — the exact defect this file exists for with the
   * languages swapped, on the side a Persian-first team is structurally least
   * likely to check.
   */
  it("an ENGLISH-seeded board reads in Persian too", () => {
    locale = "fa";
    const name = useSeededName();
    expect(name("Backlog")).toBe("بک‌لاگ");
    expect(name("In progress")).toBe("در حال انجام");
  });

  it("and on the English screen that board is left exactly as seeded", () => {
    locale = "en";
    const name = useSeededName();
    expect(name("Backlog")).toBe("Backlog");
    expect(name("To do")).toBe("To do");
  });

  it("CONTROL: the English keys are the SEEDED words, not any English word", () => {
    /* without this, "map the English too" drifts into translating whatever
       looks like a stage — and a column somebody named "Blocked", or typed in
       a different case, is theirs and stays theirs */
    locale = "fa";
    const name = useSeededName();
    expect(name("Blocked")).toBe("Blocked");
    expect(name("backlog")).toBe("backlog");
    expect(name("Doing")).toBe("Doing");
  });
});
