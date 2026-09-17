import { describe, expect, it } from "vitest";
import { meetingFixture } from "@/test/fixtures";
import { meetingPeople } from "./meetingPeople";
import type { MeetingAttendee } from "@/api/types";

/**
 * WHO IS IN A MEETING — the one rule, asserted where it lives.
 *
 * It had no test of its own until the people rail was built on it, which is
 * how the host could go missing from every stack in the meetings list for a
 * fortnight without a red: the only thing reading this was a search box, and
 * a name that is absent from a haystack fails no assertion.
 */
const member = (over: Partial<MeetingAttendee> = {}): MeetingAttendee => ({
  user_id: "u-2", display_name: "بهناز", display_name_en: "Behnaaz",
  username: "behnaaz", attended: false, ...over,
});

describe("the meeting's people", () => {
  it("counts the HOST, who is in neither column because nobody invites themselves", () => {
    const people = meetingPeople(
      meetingFixture({ created_by: "u-1", host_name: "سینا", attendees: [], invitees: [] }),
      "fa",
    );
    expect(people).toEqual([
      { key: "u-1", name: "سینا", kind: "host", attended: true },
    ]);
  });

  it("puts the people who were IN THE ROOM first, the host at their head", () => {
    const people = meetingPeople(
      meetingFixture({
        created_by: "u-1",
        host_name: "سینا",
        attendees: [
          member({ user_id: "u-2", display_name: "بهناز", attended: false }),
          member({ user_id: "u-3", display_name: "شهلا", attended: true }),
        ],
        invitees: ["مهمان بیرونی"],
      }),
      "fa",
    );
    expect(people.map((p) => p.name)).toEqual(["سینا", "شهلا", "بهناز", "مهمان بیرونی"]);
    expect(people.map((p) => p.kind)).toEqual(["host", "member", "member", "guest"]);
  });

  it("draws the host ONCE when they are also on their own roster — by id, not by name", () => {
    const people = meetingPeople(
      meetingFixture({
        created_by: "u-1",
        host_name: "سینا",
        /* the same person, added to their own meeting */
        attendees: [member({ user_id: "u-1", display_name: "سینا", attended: true })],
      }),
      "fa",
    );
    expect(people).toHaveLength(1);
    expect(people[0]!.kind).toBe("host");
  });

  it("keeps a COLLEAGUE who merely shares the host's display name", () => {
    /* the id is what makes them a different person, and a name-based dedupe
       would delete them from the meeting they attended */
    const people = meetingPeople(
      meetingFixture({
        created_by: "u-1",
        host_name: "سینا",
        attendees: [member({ user_id: "u-9", display_name: "سینا", attended: true })],
      }),
      "fa",
    );
    expect(people).toHaveLength(2);
    expect(people.map((p) => p.key)).toEqual(["u-1", "u-9"]);
  });

  it("a guest is never marked attended — absence of a stamp is silence, not «did not come»", () => {
    const people = meetingPeople(
      meetingFixture({ created_by: "u-1", host_name: "سینا", invitees: ["کسی از بیرون"] }),
      "fa",
    );
    const guest = people.find((p) => p.kind === "guest");
    expect(guest?.attended).toBe(false);
    /* and the key misses the roster's photo map on purpose: there is no row
       to read a picture from, so the mark stays an initial */
    expect(guest?.key).toBe("invitee:کسی از بیرون");
  });

  it("a TOMBSTONED author leaves a meeting with no host row rather than a nameless mark", () => {
    const people = meetingPeople(
      meetingFixture({ created_by: "u-1", host_name: null, host_name_en: null, attendees: [member()] }),
      "fa",
    );
    expect(people.every((p) => p.kind !== "host")).toBe(true);
    expect(people).toHaveLength(1);
  });

  it("resolves every name for the READING locale, the host included", () => {
    const people = meetingPeople(
      meetingFixture({
        created_by: "u-1", host_name: "سینا سپاسی", host_name_en: "Sina Sepasi",
        attendees: [member({ display_name: "بهناز", display_name_en: "Behnaaz" })],
      }),
      "en",
    );
    expect(people.map((p) => p.name)).toEqual(["Sina Sepasi", "Behnaaz"]);
  });

  it("drops a guest typed with the host's own name — the one dedupe a string can carry", () => {
    const people = meetingPeople(
      meetingFixture({ created_by: "u-1", host_name: "سینا", invitees: ["سینا"] }),
      "fa",
    );
    expect(people).toHaveLength(1);
    expect(people[0]!.kind).toBe("host");
  });
});
