import { describe, expect, it } from "vitest";
import { nextMeetingTitle } from "./meetingTitle";

describe("nextMeetingTitle", () => {
  it("starts at 1 with no prior meetings", () => {
    expect(nextMeetingTitle([], "en")).toBe("Meeting 1");
    expect(nextMeetingTitle([{ title: "kickoff" }], "fa")).toBe("جلسه 1");
  });

  it("continues from the HIGHEST, not the count — renames and deletes don't collide", () => {
    const rows = [{ title: "Meeting 5" }, { title: "Meeting 2" }, { title: null }];
    expect(nextMeetingTitle(rows, "en")).toBe("Meeting 6");
  });

  it("both languages share one series — switching UI never restarts it", () => {
    const rows = [{ title: "جلسه 3" }, { title: "Meeting 1" }];
    expect(nextMeetingTitle(rows, "fa")).toBe("جلسه 4");
    expect(nextMeetingTitle(rows, "en")).toBe("Meeting 4");
  });

  it("only EXACT auto-names count — 'Meeting notes' is a person's title", () => {
    expect(nextMeetingTitle([{ title: "Meeting notes" }, { title: "my meeting 7" }], "en"))
      .toBe("Meeting 1");
  });
});
