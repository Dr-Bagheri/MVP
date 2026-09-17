import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { meetingFixture } from "@/test/fixtures";
import type { MeetingAttendee } from "@/api/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars === undefined ? key : `${key}:${Object.values(vars).join(",")}`,
  useLocale: () => "fa",
}));

const { AttendeesRail } = await import("./AttendeesRail");

/**
 * WHO IS IN THE MEETING, beside the words (user directive, 2026-09-16: "the
 * attendances is not a bad idea — how are there and how many").
 *
 * The rule about WHO is `meetingPeople`'s and is asserted there. What belongs
 * here is what this panel may CLAIM about them:
 *
 *  1. the count is of the people we WATCHED ARRIVE, not of the roster —
 *     otherwise the headline number says four about a room holding one;
 *  2. «در جلسه» is affirmative only. Nobody is ever marked absent, because a
 *     colleague on a phone that never opened this page is exactly as absent
 *     from our evidence as somebody who stayed away (db/0202);
 *  3. a face is shown wherever the org roster holds one, and a guest — who
 *     has no row at all — keeps their initial.
 */
const member = (over: Partial<MeetingAttendee> = {}): MeetingAttendee => ({
  user_id: "u-2", display_name: "بهناز", display_name_en: null,
  username: "behnaaz", attended: false, ...over,
});

const room = () => meetingFixture({
  created_by: "u-1",
  host_name: "سینا",
  attendees: [
    member({ user_id: "u-2", display_name: "بهناز", attended: true }),
    member({ user_id: "u-3", display_name: "شهلا", attended: false }),
  ],
  invitees: ["مهمان بیرونی"],
});

const rail = (photos = new Map<string, string>()) =>
  render(<AttendeesRail meeting={room()} photos={photos} locale="fa" />);

describe("the people rail", () => {
  it("counts the people who are IN THE ROOM, not everyone on the roster", () => {
    rail();
    /* four people are listed; two of them are here — the host by construction
       and one colleague by their own stamp */
    expect(screen.getByRole("region", { name: "fieldAttendees" })).toBeTruthy();
    expect(screen.getByText("peopleInRoom:۲")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("marks «در جلسه» in the affirmative ONLY — nobody is ever called absent", () => {
    rail();
    const rows = screen.getAllByRole("listitem");
    const named = (name: string) => rows.find((row) => within(row).queryByText(name) !== null)!;

    /*
     * WHICH rows, not how many. The first version of this counted two marked
     * and two unmarked, which is equally true of a panel that marks exactly
     * the people it has no evidence for — the assertion could not fail for
     * its own reason, and the verify-red said so by coming back green.
     */
    expect(within(named("سینا")).getByText("attendedMark")).toBeTruthy();
    expect(within(named("بهناز")).getByText("attendedMark")).toBeTruthy();
    /* and the two we hold nothing about carry NO chip: no word, no tone,
       nothing that reads as a claim about where they were */
    expect(within(named("شهلا")).queryByText("attendedMark")).toBeNull();
    expect(within(named("مهمان بیرونی")).queryByText("attendedMark")).toBeNull();
    for (const row of [named("شهلا"), named("مهمان بیرونی")]) {
      expect(row.textContent).not.toMatch(/غایب|absent/);
    }
  });

  it("says which row is the host and which is a guest, and nothing under a colleague", () => {
    rail();
    const rows = screen.getAllByRole("listitem");
    const host = rows.find((row) => within(row).queryByText("سینا") !== null)!;
    expect(within(host).getByText("memberHost")).toBeTruthy();
    const guest = rows.find((row) => within(row).queryByText("مهمان بیرونی") !== null)!;
    expect(within(guest).getByText("guestMember")).toBeTruthy();
    /* a member is the ordinary case and gets no second line — a word under
       every name is noise in a 240px column */
    const colleague = rows.find((row) => within(row).queryByText("بهناز") !== null)!;
    expect(within(colleague).queryByText("memberHost")).toBeNull();
    expect(within(colleague).queryByText("guestMember")).toBeNull();
  });

  it("shows the face the org roster holds, and leaves a guest their initial", () => {
    const { container } = rail(new Map([["u-2", "data:image/png;base64,AAA"]]));
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute("src")).toBe("data:image/png;base64,AAA");
    /* the guest's key is `invitee:…`, which the photo map cannot answer —
       four people, one picture, three initials */
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("names nobody as the speaker — the live lane hears a voice, not a person", () => {
    rail();
    const panel = screen.getByRole("region", { name: "fieldAttendees" });
    /* the review tab's picker is where a voice is given a person; a name
       attached to a voice HERE would be the one attribution this product
       refuses to invent */
    expect(panel.textContent).not.toMatch(/گویند|speaker|در حال صحبت/i);
  });

  it("caps its own height so the stacked words cannot be starved", () => {
    rail();
    const panel = screen.getByRole("region", { name: "fieldAttendees" });
    /*
     * A CLASS assertion, deliberately, and the weakest kind — jsdom lays
     * nothing out, so the evidence for this one is a measured browser:
     * `.tile` carries `height: 100%`, which below `lg` gave the roster all
     * 534px of the stage and left the transcript 29. What this pins is that
     * nobody deletes the cap as decoration; the comment beside it carries
     * the numbers.
     */
    expect(panel.className).toContain("max-h-56");
    expect(panel.className).toContain("lg:max-h-none");
  });

  it("a meeting nobody was added to still says who is in the room", () => {
    render(
      <AttendeesRail
        meeting={meetingFixture({ created_by: "u-1", host_name: "سینا", attendees: [], invitees: [] })}
        photos={new Map()}
        locale="fa"
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("peopleInRoom:۱")).toBeTruthy();
  });
});
