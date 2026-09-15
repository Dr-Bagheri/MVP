/**
 * The one place that decides what an unlinked voice is CALLED and what is
 * never a person's name.
 *
 * These assert the REAL strings on purpose. The module writes its Persian as
 * `\uXXXX` escapes — the pattern turns on a hamza (U+0654) and a ZWNJ
 * (U+200C), both invisible in a diff and both things this repository has lost
 * to an encoding round trip before — so the escapes are the safe spelling and
 * this file is what proves they spell the right characters.
 */
import { describe, expect, it } from "vitest";
import {
  isDiarizerLabel,
  isSpeakerPlaceholder,
  nameSpeakers,
  speakerHandle,
} from "../src/api/speaker-naming.ts";

describe("isDiarizerLabel — the string db/0220's CHECK also refuses", () => {
  it("finds the shape upsertSpeakers writes", () => {
    // `${mlLabel}·${part.idx + 1}` — the producer's own expression
    expect(isDiarizerLabel("S1·1")).toBe(true);
    expect(isDiarizerLabel("S12·3")).toBe(true);
    expect(isDiarizerLabel("spk_2·1")).toBe(true);
    expect(isDiarizerLabel("S1·1.")).toBe(true);   // out of prose, with a stop
  });

  it("NEGATIVE CONTROL: it is not a person, in either script", () => {
    /* a predicate that answered true to everything would satisfy every line
       above and make `meeting_item.owner` unwritable for everybody */
    expect(isDiarizerLabel("Sarah Mitchell")).toBe(false);
    expect(isDiarizerLabel("سینا سپاسی")).toBe(false);
    expect(isDiarizerLabel("")).toBe(false);
    expect(isDiarizerLabel("·1")).toBe(false);      // no cluster name in front
    expect(isDiarizerLabel("S1·")).toBe(false);     // no part number after
    expect(isDiarizerLabel("S1·1·2")).toBe(false);  // not the shape at all
  });

  it("and it is NARROWER than the placeholder rule — «Speaker 1» is somebody's to type", () => {
    /* the database refuses machine output; the ordinal handle is ordinary
       language and is dropped at the extractor instead. If this ever comes
       back true, db/0220's constraint starts refusing a person's own words. */
    expect(isDiarizerLabel("Speaker 1")).toBe(false);
    expect(isDiarizerLabel("گویندهٔ ۱")).toBe(false);
  });
});

describe("isSpeakerPlaceholder — what may never become an action item's owner", () => {
  it("covers the label AND the handle a model copied out of the transcript", () => {
    expect(isSpeakerPlaceholder("S1·1")).toBe(true);
    expect(isSpeakerPlaceholder("Speaker 1")).toBe(true);
    expect(isSpeakerPlaceholder("speaker 12")).toBe(true);
    // the screen's own Persian, hamza and all
    expect(isSpeakerPlaceholder("گویندهٔ ۱")).toBe(true);
    // and the spellings a model reaches for instead
    expect(isSpeakerPlaceholder("گوینده ۲")).toBe(true);
    expect(isSpeakerPlaceholder("گوینده‌ی ۳")).toBe(true);
    expect(isSpeakerPlaceholder("گوینده 2")).toBe(true);
  });

  it("NEGATIVE CONTROL: names, including ones with the word in them", () => {
    expect(isSpeakerPlaceholder("Sarah Mitchell")).toBe(false);
    expect(isSpeakerPlaceholder("سینا سپاسی")).toBe(false);
    expect(isSpeakerPlaceholder("Ali Speaker")).toBe(false);
    expect(isSpeakerPlaceholder("Speaker of the House")).toBe(false);
    expect(isSpeakerPlaceholder("گویندهٔ رادیو")).toBe(false);
    expect(isSpeakerPlaceholder("")).toBe(false);
  });
});

describe("nameSpeakers — a linked voice by its person, an unlinked one by its place", () => {
  const roster = [
    { id: "a", person_name: null },
    { id: "b", person_name: "Sarah Mitchell" },
    { id: "c", person_name: "   " },
  ];

  it("numbers by POSITION in the list it was given, never by anything in the label", () => {
    /*
     * The position is the claim we can make: these are distinct voices.
     * Numbering by the label would say `S1·1` and `S1·2` are one person,
     * which is the attribution nothing here is allowed to invent — the two
     * are different parts and diarization never compared them.
     */
    const named = nameSpeakers(roster);
    expect(named.get("a")).toBe("Speaker 1");
    expect(named.get("b")).toBe("Sarah Mitchell");
    expect(named.get("c")).toBe("Speaker 3");
  });

  it("a BLANK display name is not a name — the handle keeps its position", () => {
    /* a person row with an empty name would otherwise produce «: text» in the
       transcript, which reads as a speaker whose name we lost */
    expect(nameSpeakers([{ id: "c", person_name: "  " }]).get("c")).toBe("Speaker 1");
  });

  it("what it produces is never a placeholder the extractor would file as an owner", () => {
    for (const name of nameSpeakers(roster).values()) {
      expect(isDiarizerLabel(name)).toBe(false);
    }
    // …and the handles it produces ARE caught by the wider rule, which is
    // what makes «Owner: Speaker 1» unable to reach a task board
    expect(isSpeakerPlaceholder(speakerHandle(4))).toBe(true);
  });
});
