import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import fa from "../messages/fa.json";
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
