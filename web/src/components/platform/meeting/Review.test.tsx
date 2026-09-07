import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture } from "@/test/fixtures";
import type { Speaker, TranscriptSegment } from "@/api/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    (vals ? `${key}:${Object.values(vals).join(",")}` : key),
  useLocale: () => "fa",
}));

const getTranscript = vi.fn();
const getSpeakers = vi.fn();
const directory = vi.fn();
const linkSpeaker = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    getTranscript: (...a: unknown[]) => getTranscript(...a),
    getSpeakers: (...a: unknown[]) => getSpeakers(...a),
    directory: () => directory(),
    linkSpeaker: (...a: unknown[]) => linkSpeaker(...a),
  },
}));

const { TranscriptPanel } = await import("./Review");

const MEETING = meetingFixture({
  call_id: "c1", created_by: "u-host", host_name: "میزبان",
  attendees: [{
    user_id: "u-sina", display_name: "سینا سپاسی", display_name_en: null,
    username: "sina", attended: true,
  }],
});

const seg = (id: string, speakerId: string | null): TranscriptSegment => ({
  id, seq: 1, part_id: null, start_ms: 3000, end_ms: 5000, speaker_id: speakerId,
  channel: null, text: `متن ${id}`, words: [], edited: false, language: "fa",
});

const speaker = (over: Partial<Speaker> = {}): Speaker => ({
  id: "s1", call_id: "c1", label: "S1·1", person_id: null, person_name: null,
  sample_start_ms: null, ...over,
});

beforeEach(() => {
  getTranscript.mockReset();
  getSpeakers.mockReset();
  directory.mockReset();
  linkSpeaker.mockReset();
  /* the same voice on two turns: the case a picker in a panel above could
     not show, and the one that makes a re-read worth asserting */
  getTranscript.mockResolvedValue([seg("t1", "s1"), seg("t2", "s1")]);
  getSpeakers.mockResolvedValue([speaker()]);
  directory.mockResolvedValue([
    { id: "p-sina", display_name: "سینا سپاسی", title: "", app_user_id: "u-sina", suggested_app_user_id: null },
  ]);
  linkSpeaker.mockResolvedValue(undefined);
});

const draw = (isHost: boolean) => render(
  <TranscriptPanel callId="c1" meeting={MEETING} isHost={isHost} onSeek={vi.fn()} locale="fa" />,
);

describe("the transcript names its voices", () => {
  it("gives the HOST the picker on the name itself", async () => {
    draw(true);
    const names = await screen.findAllByRole("button", { name: /speakerPick/ });
    expect(names).toHaveLength(2);
    expect(names[0]).toHaveTextContent("speakerNamed:۱");
  });

  it("gives a colleague the NAME AS TEXT — db/0093 on the screen, not a control that refuses", async () => {
    /*
     * The wall is the database's: only the call's owner may move a voice's
     * link, and a meeting's record belongs to its host (0202). Offering a
     * menu that the server answers with a refusal is the shape this page has
     * already declined twice (the end button, the whiteboard).
     */
    draw(false);
    expect((await screen.findAllByText("speakerNamed:۱")).length).toBe(2);
    expect(screen.queryAllByRole("button", { name: /speakerPick/ })).toHaveLength(0);
    /* and it does not ask for the directory it has no use for */
    expect(directory).not.toHaveBeenCalled();
  });

  it("one press renames EVERY turn that voice took", async () => {
    /*
     * The reason the control moved into the transcript rather than staying a
     * panel above it. The re-read is what makes the second turn change too —
     * a version that updated only the row it was pressed on would leave the
     * conversation half-named and read as a partial save.
     */
    draw(true);
    const names = await screen.findAllByRole("button", { name: /speakerPick/ });
    await userEvent.click(names[1]!);
    getSpeakers.mockResolvedValue([speaker({ person_id: "p-sina", person_name: "سینا سپاسی" })]);
    await userEvent.click(await screen.findByRole("option", { name: /سینا سپاسی/ }));

    await waitFor(() => expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", "p-sina"));
    await waitFor(() => expect(screen.getAllByText("سینا سپاسی")).toHaveLength(2));
  });
});
