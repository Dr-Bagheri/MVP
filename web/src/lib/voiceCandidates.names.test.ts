import { describe, expect, it } from "vitest";
import { meetingFixture } from "@/test/fixtures";
import type { Person } from "@/api/types";
import { directoryPersonFor, foldName, meetingVoiceCandidates } from "./voiceCandidates";

/**
 * THE NAME RUNG (2026-09-16), and why it exists: the picker used to CREATE a
 * directory row for any colleague the link and the server's same-script
 * suggestion had not placed — which on a directory spelled in Persian beside
 * accounts spelled in Latin was most colleagues, and every one of them
 * became a new person on the speakers page. The rung places a colleague
 * through the name in EITHER spelling, so the creation the user objected to
 * has nothing left to do in the ordinary case.
 *
 * The CONTROLS are the half that matter: a name that matches two rows places
 * nobody (the first-match trap, 2026-09-06), and a row already paired with
 * a different account is not up for grabs by name.
 */
const person = (over: Partial<Person> & { id: string; display_name: string }): Person => ({
  title: "", app_user_id: null, suggested_app_user_id: null, ...over,
});

describe("folding a name", () => {
  it("makes one spelling of case, Arabic letter forms, joiners and spaces", () => {
    expect(foldName("سينا  سپاسي")).toBe(foldName("سینا سپاسی"));
    expect(foldName("محمد‌رضا")).toBe(foldName("محمدرضا"));
    expect(foldName("Sina Sepasi")).toBe("sina sepasi");
    expect(foldName(null)).toBe("");
  });
});

describe("the name rung", () => {
  it("places an account through its LATIN spelling against a Persian directory — no row is created", () => {
    /* the production shape: «سینا سپاسی» in the directory, "Sina Sepasi"
       on the account, and the account's own Persian name on `display_name` */
    const people = [person({ id: "p-sina", display_name: "سینا سپاسی" })];
    const hit = directoryPersonFor("u-sina", people, { display_name: "سینا سپاسی", display_name_en: "Sina Sepasi" });
    expect(hit?.id).toBe("p-sina");
  });

  it("places through the Persian name when the account's Latin name is the odd one", () => {
    const people = [person({ id: "p-b", display_name: "بهناز بهجتی" })];
    expect(directoryPersonFor("u-b", people, { display_name: "Behnaaz", display_name_en: "بهناز بهجتی" })?.id).toBe("p-b");
    /* and across the Arabic-yeh spelling of the same name */
    expect(directoryPersonFor("u-b", people, { display_name: "بهناز بهجتي" })?.id).toBe("p-b");
  });

  it("places NOBODY when two directory rows share the name — the ambiguity control", () => {
    const people = [
      person({ id: "p-1", display_name: "سینا سپاسی" }),
      person({ id: "p-2", display_name: "سینا سپاسی" }),
    ];
    expect(directoryPersonFor("u-sina", people, { display_name: "Sina Sepasi", display_name_en: "سینا سپاسی" })).toBeNull();
  });

  it("never claims a row already paired with ANOTHER account, whatever its name says", () => {
    const people = [person({ id: "p-taken", display_name: "سینا سپاسی", app_user_id: "u-other" })];
    expect(directoryPersonFor("u-sina", people, { display_name: "سینا سپاسی" })).toBeNull();
  });

  it("is the THIRD rung: the link and the suggestion still come first", () => {
    const people = [
      person({ id: "p-linked", display_name: "کسی دیگر", app_user_id: "u-sina" }),
      person({ id: "p-named", display_name: "سینا سپاسی" }),
    ];
    expect(directoryPersonFor("u-sina", people, { display_name: "سینا سپاسی" })?.id).toBe("p-linked");
  });

  it("answers nothing without names to compare — the old two-rung call is unchanged", () => {
    const people = [person({ id: "p-sina", display_name: "سینا سپاسی" })];
    expect(directoryPersonFor("u-sina", people)).toBeNull();
  });

  it("reaches the candidates a picker is handed, host and roster alike", () => {
    const people = [
      person({ id: "p-host", display_name: "دکتر باقری" }),
      person({ id: "p-sina", display_name: "سینا سپاسی" }),
    ];
    const out = meetingVoiceCandidates(
      meetingFixture({
        created_by: "u-host", host_name: "Dr Bagheri", host_name_en: "دکتر باقری",
        attendees: [{ user_id: "u-sina", display_name: "Sina Sepasi", display_name_en: "سینا سپاسی", username: "sina", attended: true }],
      }),
      people, "fa",
    );
    expect(out.map((c) => [c.memberId, c.personId, c.name])).toEqual([
      ["u-host", "p-host", "دکتر باقری"],
      ["u-sina", "p-sina", "سینا سپاسی"],
    ]);
  });
});
