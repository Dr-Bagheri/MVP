import { describe, expect, it } from "vitest";
import { suggestSpeakerPeople, type SuggestSegment } from "./speakerSuggest";

const PEOPLE = [
  { id: "p-ali", display_name: "علی محمدی" },
  { id: "p-sara", display_name: "سارا محمدی" },
  { id: "p-reza", display_name: "رضا کریمی" },
];

function seg(speaker: string | null, text: string, at: number): SuggestSegment {
  return { speaker_id: speaker, text, start_ms: at };
}

describe("suggesting people for unlinked speakers", () => {
  it("takes a name out of the speaker's own label", () => {
    const out = suggestSpeakerPeople(
      [],
      [{ id: "s1", label: "علی", person_id: null }],
      PEOPLE,
    );
    expect(out.get("s1")).toBe("p-ali");
  });

  it("reads the handoff: the previous turn names the next voice", () => {
    const out = suggestSpeakerPeople(
      [
        seg("s1", "نظرت چیه رضا؟", 0),
        seg("s2", "به نظر من خوبه", 4000),
        seg("s1", "ممنون رضا", 9000),
        seg("s2", "خواهش می‌کنم", 12000),
      ],
      [
        { id: "s1", label: "گویندهٔ ۱", person_id: null },
        { id: "s2", label: "گویندهٔ ۲", person_id: null },
      ],
      PEOPLE,
    );
    expect(out.get("s2")).toBe("p-reza");
    // s1 was never named by anyone — no suggestion, not a blank one
    expect(out.has("s1")).toBe(false);
  });

  it("one mention is a coincidence — it does not reach the bar", () => {
    const out = suggestSpeakerPeople(
      [seg("s1", "رضا کجاست؟", 0), seg("s2", "نمی‌دانم", 3000)],
      [{ id: "s2", label: "گویندهٔ ۲", person_id: null }],
      PEOPLE,
    );
    expect(out.size).toBe(0);
  });

  it("never matches a name INSIDE another word", () => {
    /**
     * «رضا» sits inside «رضایی» — a real name inside a real family name,
     * and the class this repo has already burned on once («دی» matching
     * inside «محمدی»). A substring matcher suggests Reza three times over
     * from a conversation that never mentions him.
     *
     * The first version of this test used «دی» itself and passed for the
     * WRONG reason — a two-letter name never becomes a token at all, so the
     * length filter answered before the boundary rule was ever asked. It is
     * kept in mind here: the name in this fixture is long enough to be a
     * token, so only the boundary rule can save it.
     */
    const out = suggestSpeakerPeople(
      [
        seg("s1", "رضایی گفت", 0), seg("s2", "بله", 3000),
        seg("s1", "نظر رضایی", 6000), seg("s2", "درست است", 9000),
        seg("s1", "رضایی", 12000), seg("s2", "بله", 15000),
      ],
      [{ id: "s2", label: "گویندهٔ ۲", person_id: null }],
      [{ id: "p-reza", display_name: "رضا" }],
    );
    expect(out.size).toBe(0);
  });

  it("a shared family name identifies nobody", () => {
    // «محمدی» belongs to two people — it must not decide either way
    const out = suggestSpeakerPeople(
      [seg("s1", "محمدی نظرت چیه", 0), seg("s2", "خوبه", 3000),
       seg("s1", "محمدی؟", 6000), seg("s2", "بله", 9000)],
      [{ id: "s2", label: "گویندهٔ ۲", person_id: null }],
      PEOPLE,
    );
    expect(out.size).toBe(0);
  });

  it("does not offer a person already linked to another speaker", () => {
    const out = suggestSpeakerPeople(
      [seg("s1", "علی؟", 0), seg("s2", "بله", 3000), seg("s1", "علی جان", 6000),
       seg("s2", "بله", 9000)],
      [
        { id: "s1", label: "گویندهٔ ۱", person_id: "p-ali" },
        { id: "s2", label: "گویندهٔ ۲", person_id: null },
      ],
      PEOPLE,
    );
    expect(out.size).toBe(0);
  });

  it("leaves an already-linked speaker alone", () => {
    const out = suggestSpeakerPeople(
      [],
      [{ id: "s1", label: "علی", person_id: "p-sara" }],
      PEOPLE,
    );
    expect(out.size).toBe(0);
  });

  it("a tie decides nothing", () => {
    const out = suggestSpeakerPeople(
      [],
      [{ id: "s1", label: "علی رضا", person_id: null }],
      // both names sit in the label with equal weight
      [{ id: "p-ali", display_name: "علی" }, { id: "p-reza", display_name: "رضا" }],
    );
    expect(out.size).toBe(0);
  });

  it("an empty directory suggests nothing", () => {
    expect(
      suggestSpeakerPeople([seg("s1", "سلام", 0)], [{ id: "s1", label: "x", person_id: null }], []).size,
    ).toBe(0);
  });
});
