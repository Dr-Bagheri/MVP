import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import fa from "../messages/fa.json";
import { useTranslations } from "next-intl";
import { useSkillName, useSkillStarters } from "./skillName";

/**
 * The shipped-content line, asserted from both sides (user report,
 * 2026-08-18: the English hub suggested Persian questions): SYSTEM skills'
 * names AND starter questions localize; authored skills render as authored.
 *
 * The catalogue side of these assertions reads the REAL fa.json — the same
 * file production serves — so a starters key someone renames goes red here,
 * not silently back to the wire's words.
 */

const wire = (level: string, slug: string) => ({
  level,
  slug,
  name: "AS AUTHORED",
  starter_questions: ["AS AUTHORED Q1", "AS AUTHORED Q2"],
});

describe("useSkillStarters — the shipped-content line", () => {
  it("a system skill's starters come from the catalogue, not the wire", () => {
    const { result } = renderHook(() => useSkillStarters());
    const starters = result.current(wire("system", "tasks"));
    expect(starters).toEqual((fa as { skills: { starters_tasks: string[] } }).skills.starters_tasks);
    // and the wire's words did NOT leak through — the discriminating half
    expect(starters).not.toContain("AS AUTHORED Q1");
  });

  it("an ORG-authored skill's starters render exactly as authored", () => {
    const { result } = renderHook(() => useSkillStarters());
    expect(result.current(wire("org", "tasks"))).toEqual(["AS AUTHORED Q1", "AS AUTHORED Q2"]);
  });

  it("a system skill WITHOUT a catalogue entry falls back to the wire — visible and untranslated beats broken", () => {
    const { result } = renderHook(() => useSkillStarters());
    // summarizer is in the known-slug map but ships no starters_* key
    expect(result.current(wire("system", "summarizer"))).toEqual([
      "AS AUTHORED Q1",
      "AS AUTHORED Q2",
    ]);
  });
});

describe("useSkillName — same line, names", () => {
  it("system names localize; authored names never do", () => {
    const { result } = renderHook(() => useSkillName());
    expect(result.current(wire("system", "tasks"))).toBe(
      (fa as { skills: { system_tasks: string } }).skills.system_tasks,
    );
    expect(result.current(wire("user", "tasks"))).toBe("AS AUTHORED");
  });
});

/**
 * THE CONSOLE CHANNEL — the half no other assertion in this file can reach
 * (review F15).
 *
 * `SYSTEM_SKILL_KEYS` declares five slugs; `messages/*.json` carries three
 * `starters_*` entries, because `summarizer` and `translator` deliberately
 * ship no starter questions. The guard asked about one list and the next line
 * read from the other, so every render of the assistant menu emitted
 * `MISSING_MESSAGE: Could not resolve skills.starters_summarizer` — in both
 * locales.
 *
 * Nothing caught it because the RETURN VALUE is correct in both the working
 * and the broken version: the old code reached the fallback through a `catch`
 * that can never fire (use-intl's `raw` reports and returns the key path
 * rather than throwing), and the type check one line down caught the string.
 * Right answer, reached by accident, with two errors on the console.
 *
 * So these assert the channel, and the third one asserts the INSTRUMENT.
 */
describe("useSkillStarters — the console stays clean", () => {
  const missingMessages = (fn: () => void): string[] => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      seen.push(args.map(String).join(" "));
    });
    try {
      fn();
    } finally {
      spy.mockRestore();
    }
    return seen.filter((line) => line.includes("MISSING_MESSAGE"));
  };

  it("resolves a system skill that ships NO starters without reporting a missing message", () => {
    const errors = missingMessages(() => {
      const { result } = renderHook(() => useSkillStarters());
      result.current(wire("system", "summarizer"));
      result.current(wire("system", "translator"));
    });
    expect(errors, "the two console lines the user reported").toEqual([]);
  });

  it("NEGATIVE CONTROL: a slug that HAS starters is still read from the catalogue", () => {
    /* without this, a resolver that stopped localizing entirely — returning
       the wire's words for everything and touching no catalogue — satisfies
       the assertion above perfectly */
    const { result } = renderHook(() => useSkillStarters());
    expect(result.current(wire("system", "tasks"))).toEqual(
      (fa as { skills: { starters_tasks: string[] } }).skills.starters_tasks,
    );
  });

  it("CONTROL ON THE INSTRUMENT: this harness does report a genuinely missing key", () => {
    /* "no missing messages" is indistinguishable from "this fake never emits
       one" — which was true of this file until F15. Ask for a key that exists
       in no catalogue and require exactly one report. */
    const errors = missingMessages(() => {
      // reach the fake through the same door the component uses, for a key
      // nothing declares in either catalogue
      const { result } = renderHook(() => useTranslations("skills"));
      result.current.raw("starters_a_slug_nobody_ships");
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("starters_a_slug_nobody_ships");
  });
});
