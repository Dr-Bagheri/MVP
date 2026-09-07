import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture } from "@/test/fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${Object.values(vals).join(",")}` : key,
  useLocale: () => "fa",
}));

const getSpeakers = vi.fn();
const directory = vi.fn();
const linkSpeaker = vi.fn(async (_callId: string, _speakerId: string, _personId: string | null) => undefined);
vi.mock("@/api/client", () => ({
  api: {
    getSpeakers: (...a: unknown[]) => getSpeakers(...a),
    directory: () => directory(),
    linkSpeaker: (c: string, s: string, p: string | null) => linkSpeaker(c, s, p),
  },
}));

const { MeetingSpeakers } = await import("./Speakers");

/**
 * THE PICKER THE MATCHER'S SILENCE NEEDS (user directive, 2026-09-07).
 *
 * Two properties, and the ranking is the one that would rot quietly.
 */
const MEETING = meetingFixture({
  call_id: "c1",
  created_by: "u-host",
  attendees: [{
    user_id: "u-sina", display_name: "سینا سپاسی", display_name_en: null,
    username: "sina", attended: true,
  }],
});

const speaker = (id: string, personId: string | null = null) => ({
  id, call_id: "c1", label: `S1·${id}`, person_id: personId,
  person_name: null, sample_start_ms: null,
});

/**
 * The directory as production actually holds it: `app_user_id` NULL on every
 * row (read at owner altitude 2026-09-07 — five people, twelve members, zero
 * links), and the server's own folded-name suggestion carrying the pairing.
 */
const person = (id: string, name: string, suggested: string | null) => ({
  id, display_name: name, title: "", app_user_id: null,
  suggested_app_user_id: suggested,
});

beforeEach(() => {
  getSpeakers.mockReset();
  directory.mockReset();
  linkSpeaker.mockReset();
  linkSpeaker.mockResolvedValue(undefined);
  getSpeakers.mockResolvedValue([speaker("s1"), speaker("s2")]);
  directory.mockResolvedValue([
    person("p-zzz", "یک نفر دیگر", null),
    person("p-sina", "سینا سپاسی", "u-sina"),
    person("p-host", "میزبان", "u-host"),
  ]);
});

describe("the host names a voice from the people who were in the room", () => {
  it("offers the meeting's own people FIRST and marks them — through the SUGGESTION, which is the only link production has", async () => {
    /*
     * THE DISCRIMINATING CASE. A ranking written against `person.app_user_id`
     * passes every "the picker renders" assertion and offers nothing at all on
     * the real deployment, where that column is null on every row — the
     * failure would read as "the platform does not know these people" rather
     * than as a bug. So the fixture gives the pairing ONLY through
     * `suggested_app_user_id`, and the assertion is on the ORDER.
     */
    render(<MeetingSpeakers callId="c1" meeting={MEETING} isHost locale="fa" />);
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBe(2));

    await userEvent.click(screen.getAllByRole("combobox")[0]!);
    const offered = (await screen.findAllByRole("option")).map((o) => o.textContent ?? "");

    /* «not chosen», then the two who were here, then everybody else */
    expect(offered[0]).toContain("unknownPerson");
    expect(offered[1]).toContain("speakerInMeeting");
    expect(offered[2]).toContain("speakerInMeeting");
    expect(offered.slice(1, 3).join(" ")).toContain("سینا سپاسی");
    expect(offered.slice(1, 3).join(" ")).toContain("میزبان");
    /* and the stranger is offered too — the roster is a RANKING, not a wall:
       a voice on the recording may be somebody who never opened the page */
    expect(offered[3]).toContain("یک نفر دیگر");
    expect(offered[3]).not.toContain("speakerInMeeting");
  });

  it("a pick reaches the server as a link on THAT voice", async () => {
    getSpeakers.mockResolvedValueOnce([speaker("s1"), speaker("s2")]);
    render(<MeetingSpeakers callId="c1" meeting={MEETING} isHost locale="fa" />);
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBe(2));

    /* the SECOND voice, so a component that always writes the first fails */
    await userEvent.click(screen.getAllByRole("combobox")[1]!);
    await userEvent.click(await screen.findByRole("option", { name: /سینا سپاسی/ }));

    await waitFor(() => expect(linkSpeaker).toHaveBeenCalledTimes(1));
    expect(linkSpeaker).toHaveBeenCalledWith("c1", "s2", "p-sina");
  });

  it("…and choosing «not chosen» UNLINKS rather than linking to an empty string", async () => {
    getSpeakers.mockResolvedValue([speaker("s1", "p-sina"), speaker("s2")]);
    render(<MeetingSpeakers callId="c1" meeting={MEETING} isHost locale="fa" />);
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBe(2));

    await userEvent.click(screen.getAllByRole("combobox")[0]!);
    await userEvent.click(await screen.findByRole("option", { name: /unknownPerson/ }));

    await waitFor(() => expect(linkSpeaker).toHaveBeenCalledTimes(1));
    expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", null);
  });

  it("a colleague is offered no picker at all, and told whose the naming is", async () => {
    /*
     * db/0093: only the call's OWNER may move `person_id`. Without this the
     * panel would hand every reader a control the server answers with a 404
     * wearing "no such speaker" — the shape this page has already refused
     * twice (the end button, the whiteboard).
     */
    render(<MeetingSpeakers callId="c1" meeting={MEETING} isHost={false} locale="fa" />);
    await screen.findByText("speakersTitle");

    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.getByText("speakersHostOnly")).toBeInTheDocument();
  });

  it("a refused link says so and leaves the record unchanged", async () => {
    linkSpeaker.mockRejectedValueOnce(new Error("refused"));
    render(<MeetingSpeakers callId="c1" meeting={MEETING} isHost locale="fa" />);
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBe(2));

    await userEvent.click(screen.getAllByRole("combobox")[0]!);
    await userEvent.click(await screen.findByRole("option", { name: /سینا سپاسی/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("writeFailed");
    /* the re-read never ran, so nothing on screen claims the link landed */
    expect(getSpeakers).toHaveBeenCalledTimes(1);
  });

  it("a record with no voices renders NOTHING — an empty panel is a promise of a control", async () => {
    getSpeakers.mockResolvedValue([]);
    const { container } = render(
      <MeetingSpeakers callId="c1" meeting={MEETING} isHost locale="fa" />,
    );
    await waitFor(() => expect(directory).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector("[data-meeting-speakers]")).toBeNull());
  });
});
