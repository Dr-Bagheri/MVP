/**
 * Name transliteration (user directive, 2026-08-16) and the resolver that
 * scopes it. The discriminating cases here are the ones a wrong wiring gets
 * wrong SILENTLY:
 *
 *  - a chosen `display_name_en` must always beat a derived spelling — a
 *    transliterator that runs anyway rewrites a name someone picked;
 *  - a Persian-script name in the FA locale must come back BYTE-identical —
 *    round-tripping it through the letter maps would corrupt exactly the
 *    default path (Persian-first hides the bug, FE1's locale corollary);
 *  - vowel-less skeletons: «حمید» letter-mapped is "Hmid", so only the
 *    dictionary rung produces "Hamid" — the test pins the rung, not just
 *    "some output exists".
 */
import { describe, expect, it } from "vitest";
import { latinToPersian, persianToLatin } from "./transliterate";
import { personName } from "./format";

describe("persianToLatin", () => {
  it("renders the user's own examples", () => {
    expect(persianToLatin("امیر")).toBe("Amir");
    expect(persianToLatin("سارا محمدی")).toBe("Sara Mohammadi");
  });

  it("knows the vowels a letter map cannot see", () => {
    expect(persianToLatin("حمید")).toBe("Hamid");
    expect(persianToLatin("نگار")).toBe("Negar");
  });

  it("handles the family-name suffixes", () => {
    expect(persianToLatin("توکلی")).toBe("Tavakoli");
    expect(persianToLatin("رضایی")).toBe("Rezaei");
    expect(persianToLatin("باقری")).toBe("Bagheri");
  });

  it("segments compounds", () => {
    expect(persianToLatin("امیررضا")).toBe("Amirreza");
  });

  it("degrades to letters for a name no list has met, and says something", () => {
    const out = persianToLatin("زرتشت");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/^[A-Z][a-z]*$/);
  });
});

describe("latinToPersian", () => {
  it("reverses the user's example", () => {
    expect(latinToPersian("Amir")).toBe("امیر");
    expect(latinToPersian("Sara Mohammadi")).toBe("سارا محمدی");
  });

  it("rebuilds suffixed and compound names", () => {
    expect(latinToPersian("Bagheri")).toBe("باقری");
    expect(latinToPersian("Amirreza")).toBe("امیررضا");
  });
});

describe("personName scopes the transliteration", () => {
  it("a chosen Latin name beats a derived one in EN", () => {
    expect(
      personName({ display_name: "امیر", display_name_en: "Amir R." }, "en"),
    ).toBe("Amir R.");
  });

  it("no Latin name in EN → the Persian name transliterates", () => {
    expect(personName({ display_name: "امیر", display_name_en: null }, "en")).toBe("Amir");
  });

  it("a Persian-script name in FA is returned byte-identical, never round-tripped", () => {
    const name = "سارا محمدی";
    expect(personName({ display_name: name, display_name_en: "Sara" }, "fa")).toBe(name);
  });

  it("a Latin-only name in FA renders in Persian script", () => {
    expect(personName({ display_name: "Amir", display_name_en: null }, "fa")).toBe("امیر");
  });

  it("a Latin-only name in EN passes through untouched", () => {
    expect(personName({ display_name: "Amir", display_name_en: null }, "en")).toBe("Amir");
  });
});
