import { describe, expect, it, vi } from "vitest";
import fa from "../messages/fa.json";
import en from "../messages/en.json";

let locale: "fa" | "en" = "en";
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => {
    const table = (locale === "fa" ? fa : en) as unknown as Record<string, Record<string, string>>;
    return table[ns]?.[key] ?? `${ns}.${key}`;
  },
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
});
