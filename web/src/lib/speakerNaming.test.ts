import { describe, expect, it } from "vitest";
import { speakerNaming } from "./speakerNaming";

/**
 * A VOICE IS NEVER SHOWN THE DIARIZER'S OWN STRING (2026-09-06).
 *
 * `person_name ?? label` was the shape in both places that render a
 * transcript, so an unlinked voice reached the reader as «S1·1» — and on the
 * call page an unknown one reached them as a raw uuid.
 */
describe("what a voice is called", () => {
  const roster = [
    { id: "s-1", label: "S1·1", person_name: null },
    { id: "s-2", label: "S2·1", person_name: "سینا سپاسی" },
    { id: "s-3", label: "S1·2", person_name: null },
  ];

  it("names the person when there is one", () => {
    expect(speakerNaming("s-2", roster)).toEqual({ kind: "person", name: "سینا سپاسی" });
  });

  it("numbers an unlinked voice by its place in the roster — never by the label", () => {
    /*
     * THE LOAD-BEARING CASE, and the reason the ordinal is a position.
     *
     * `s-1` and `s-3` are both `S1` — the diarizer's first cluster in part 1
     * and in part 2 — and they are NOT known to be the same person, because
     * diarization runs per part. A version that parsed the digit out of the
     * label would call both of them "speaker 1", which is an attribution
     * nothing here is allowed to make. Positions say only what is true:
     * three distinct voices, three handles.
     */
    expect(speakerNaming("s-1", roster)).toEqual({ kind: "ordinal", n: 1 });
    expect(speakerNaming("s-3", roster)).toEqual({ kind: "ordinal", n: 3 });
  });

  it("distinguishes the two nothings: no speaker at all, and one this call has not got", () => {
    expect(speakerNaming(null, roster)).toEqual({ kind: "unattributed" });
    /* the call page used to fall through to the id itself — a database key
       rendered where a person's name goes */
    expect(speakerNaming("s-404", roster)).toEqual({ kind: "unattributed" });
  });

  it("treats a blank person name as no name, rather than rendering an empty label", () => {
    /* a linked person whose name is whitespace is the state where "there is
       a person_name" and "there is a name to show" come apart */
    expect(speakerNaming("s-9", [{ id: "s-9", label: "S9·1", person_name: "   " }]))
      .toEqual({ kind: "ordinal", n: 1 });
  });
});
