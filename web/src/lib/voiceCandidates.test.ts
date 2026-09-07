import { describe, expect, it } from "vitest";
import { meetingFixture } from "@/test/fixtures";
import type { Person } from "@/api/types";
import { directoryPersonFor, meetingVoiceCandidates } from "./voiceCandidates";

/**
 * WHO A VOICE MAY BE NAMED AS — the arithmetic across two tables.
 *
 * The fixtures here are the production shape, read at owner altitude on
 * 2026-09-07 before the module was written: a directory spelled in Persian,
 * accounts spelled in Latin, and no `app_user_id` or folded-name suggestion
 * joining them. A test built on tidy already-linked rows would have passed
 * against the version of this feature that offers nobody.
 */
const person = (over: Partial<Person> & { id: string; display_name: string }): Person => ({
  title: "", app_user_id: null, suggested_app_user_id: null, ...over,
});

const attendee = (id: string, name: string, attended = false) => ({
  user_id: id, display_name: name, display_name_en: null, username: null, attended,
});

describe("the meeting's own people", () => {
  it("puts the HOST first and offers them even when nobody else was added", () => {
    /*
     * The case every recording on this deployment is: one person, their own
     * meeting, no roster. A rule that only listed `attendees` would hand the
     * host an empty menu on the record they are looking at — which is the
     * failure the whole picker exists to end, arriving from the other side.
     */
    const out = meetingVoiceCandidates(
      meetingFixture({ created_by: "u-host", host_name: "دکتر باقری" }), [], "fa",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ memberId: "u-host", name: "دکتر باقری", isHost: true, personId: null });
  });

  it("names a candidate by the DIRECTORY, because that is what the transcript will say", () => {
    /*
     * The label is a promise about what the press does. Labelling the option
     * with the account's name ("Sina Sepasi") and then rendering «سینا
     * سپاسی» on the line reads as the product having chosen somebody else.
     */
    const people = [person({ id: "p-sina", display_name: "سینا سپاسی", app_user_id: "u-sina" })];
    const out = meetingVoiceCandidates(
      meetingFixture({ created_by: "u-host", attendees: [attendee("u-sina", "Sina Sepasi")] }),
      people, "fa",
    );
    expect(out[1]).toMatchObject({ memberId: "u-sina", name: "سینا سپاسی", personId: "p-sina" });
  });

  it("resolves through the server's own suggestion when no admin has linked the pair", () => {
    const people = [person({ id: "p-x", display_name: "بهناز بهجتی", suggested_app_user_id: "u-b" })];
    const out = meetingVoiceCandidates(
      meetingFixture({ created_by: "u-host", attendees: [attendee("u-b", "Behnaaz")] }), people, "fa",
    );
    expect(out[1]!.personId).toBe("p-x");
  });

  it("prefers the LINK over the suggestion when they disagree", () => {
    /* an admin's answer outranks a name match, or a folded collision could
       quietly override the one fact a human stated */
    const people = [
      person({ id: "p-guess", display_name: "همنام", suggested_app_user_id: "u-b" }),
      person({ id: "p-said", display_name: "بهناز بهجتی", app_user_id: "u-b" }),
    ];
    const out = meetingVoiceCandidates(
      meetingFixture({ created_by: "u-host", attendees: [attendee("u-b", "Behnaaz")] }), people, "fa",
    );
    expect(out[1]!.personId).toBe("p-said");
  });

  it("still offers a member the directory has never heard of, carrying no person", () => {
    /*
     * THE PRODUCTION CASE, and the discriminating one: fourteen accounts,
     * five directory people, zero links. Dropping the unresolved half is the
     * version of this feature that renders an empty menu and reads as "the
     * platform does not know these people".
     */
    const out = meetingVoiceCandidates(
      meetingFixture({ created_by: "u-host", attendees: [attendee("u-new", "Shahla Hosseini")] }),
      [person({ id: "p-other", display_name: "کس دیگر" })], "fa",
    );
    expect(out.map((c) => c.memberId)).toEqual(["u-host", "u-new"]);
    expect(out[1]).toMatchObject({ name: "Shahla Hosseini", personId: null });
  });

  it("lists the host once when they are also on their own roster", () => {
    const out = meetingVoiceCandidates(
      meetingFixture({ created_by: "u-host", host_name: "میزبان", attendees: [attendee("u-host", "میزبان")] }),
      [], "fa",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.isHost).toBe(true);
  });

  it("puts those the meeting recorded as PRESENT before the rest of the roster", () => {
    const out = meetingVoiceCandidates(
      meetingFixture({
        created_by: "u-host",
        attendees: [attendee("u-a", "آبان"), attendee("u-b", "بهرام", true)],
      }),
      [], "fa",
    );
    /* the stamp orders and never filters: db/0202 marks attendance in the
       affirmative only, so «no stamp» is silence, not absence */
    expect(out.map((c) => c.memberId)).toEqual(["u-host", "u-b", "u-a"]);
  });

  it("never claims a pairing from a null column", () => {
    /* `app_user_id` is null on every row in production; a lookup comparing
       null to an id would match the FIRST person for every member */
    expect(directoryPersonFor("u-1", [person({ id: "p", display_name: "کسی" })])).toBeNull();
  });
});
