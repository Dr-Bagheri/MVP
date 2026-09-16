import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Speaker } from "@/api/types";
import type { VoiceCandidate } from "@/lib/voiceCandidates";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    (vals ? `${key}:${Object.values(vals).join(",")}` : key),
  useLocale: () => "fa",
}));

const linkSpeaker = vi.fn();
const updatePerson = vi.fn();
const createPerson = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    linkSpeaker: (...a: unknown[]) => linkSpeaker(...a),
    updatePerson: (...a: unknown[]) => updatePerson(...a),
    createPerson: (...a: unknown[]) => createPerson(...a),
  },
}));

const { VoicePicker } = await import("./VoicePicker");

const speaker = (over: Partial<Speaker> = {}): Speaker => ({
  id: "s1", call_id: "c1", label: "S1·1", person_id: null,
  person_name: null, sample_start_ms: null, ...over,
});

/* the meeting's people: one the platform has learned, one it has not — which
   is the production mix (five directory people, fourteen accounts, zero
   links, measured 2026-09-07) */
const CANDIDATES: VoiceCandidate[] = [
  { memberId: "u-host", name: "drbagheri", personId: null, isHost: true, attended: true },
  { memberId: "u-sina", name: "سینا سپاسی", personId: "p-sina", isHost: false, attended: true },
];

const PEOPLE = [
  { id: "p-sina", display_name: "سینا سپاسی", title: "", app_user_id: "u-sina", suggested_app_user_id: null },
  { id: "p-amir", display_name: "امیررضا باقری", title: "", app_user_id: null, suggested_app_user_id: null },
];

const onLinked = vi.fn();

function draw(over: { speaker?: Speaker; candidates?: VoiceCandidate[]; name?: string } = {}) {
  render(
    <VoicePicker
      callId="c1"
      speaker={over.speaker ?? speaker()}
      name={over.name ?? "گویندهٔ ۱"}
      candidates={over.candidates ?? CANDIDATES}
      people={PEOPLE}
      onLinked={onLinked}
    />,
  );
}

const openMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: /speakerPick/ }));
  return (await screen.findAllByRole("option")).map((o) => o.textContent ?? "");
};

beforeEach(() => {
  linkSpeaker.mockReset(); linkSpeaker.mockResolvedValue(undefined);
  updatePerson.mockReset(); updatePerson.mockResolvedValue(undefined);
  createPerson.mockReset(); createPerson.mockResolvedValue({ id: "p-new" });
  onLinked.mockReset();
});

describe("naming a voice from inside the transcript", () => {
  it("the trigger says what the TRANSCRIPT says, not what the menu calls «not chosen»", () => {
    /*
     * The discriminating case for the inline face. Every other dropdown in
     * the platform reads its label off the chosen option — here that option
     * is «نامشخص», and rendering it would rename a line of the transcript by
     * putting a picker over it.
     */
    draw();
    expect(screen.getByRole("button", { name: /speakerPick/ })).toHaveTextContent("گویندهٔ ۱");
    expect(screen.getByRole("button", { name: /speakerPick/ })).not.toHaveTextContent("unknownPerson");
  });

  it("offers the meeting's own people and NOBODY ELSE from the directory", async () => {
    /*
     * The user's ruling, 2026-09-07: "only from people that have been in the
     * meeting, not all of them". `PEOPLE` holds «امیررضا باقری», who is a
     * real directory person and is not on this meeting — the version this
     * replaced offered all five, ranked.
     */
    draw();
    const offered = await openMenu();
    expect(offered.join(" ")).toContain("سینا سپاسی");
    expect(offered.join(" ")).toContain("drbagheri");
    expect(offered.join(" ")).not.toContain("امیررضا باقری");
  });

  it("links the chosen person to THIS voice", async () => {
    draw({ speaker: speaker({ id: "s2" }) });
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /سینا سپاسی/ }));
    await waitFor(() => expect(linkSpeaker).toHaveBeenCalledWith("c1", "s2", "p-sina"));
    expect(onLinked).toHaveBeenCalled();
  });

  it("«نامشخص» UNLINKS rather than linking to an empty string", async () => {
    draw({ speaker: speaker({ person_id: "p-sina", person_name: "سینا سپاسی" }) });
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /unknownPerson/ }));
    await waitFor(() => expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", null));
  });

  it("offers an unlearned colleague DISABLED, says why, and creates NOTHING (2026-09-16)", async () => {
    /*
     * User directive, 2026-09-16: "when we added the speaker back in
     * transcription after recording it created a new person on the speakers
     * page; it should not." The 2026-09-08 version resolved a candidate with
     * `personId: null` by CREATING a directory row named as the option said
     * — a new person on the speakers page every time. The colleague stays on
     * the list (a colleague who vanishes reads as "the platform does not
     * know they were here"), cannot be pressed, and carries the reason.
     *
     * The discriminating assertions are the two ABSENCES: no create and no
     * link. A version that greys the row and still writes on press passes
     * the presence checks and is the reported defect.
     */
    draw();
    await openMenu();
    const row = screen.getByRole("option", { name: /drbagheri/ });
    /* the option is a native button, so disabled is the ATTRIBUTE */
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent("voiceNotInDirectory");
    await userEvent.click(row);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(createPerson).not.toHaveBeenCalled();
    expect(linkSpeaker).not.toHaveBeenCalled();
    expect(updatePerson).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("links a colleague the resolver placed by NAME to that row, and writes the pairing — never a second row", async () => {
    /*
     * Who a colleague is in the directory is `voiceCandidates`' decision now
     * (the link, the server's suggestion, or a name in either script); this
     * surface links to the row it was handed and remembers the pairing so no
     * later meeting has to match anything. `p-amir` is unpaired in the
     * fixture, which is what makes the `updatePerson` call the assertion —
     * an already-paired row gets none (next test).
     */
    draw({
      candidates: [{ memberId: "u-amir", name: "امیررضا باقری", personId: "p-amir", isHost: true, attended: true }],
    });
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /امیررضا باقری/ }));

    await waitFor(() => expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", "p-amir"));
    expect(createPerson).not.toHaveBeenCalled();
    expect(updatePerson).toHaveBeenCalledWith("p-amir", { app_user_id: "u-amir" });
  });

  it("writes no pairing for a row that is already paired — the control", async () => {
    draw();
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /سینا سپاسی/ }));
    await waitFor(() => expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", "p-sina"));
    expect(updatePerson).not.toHaveBeenCalled();
    expect(createPerson).not.toHaveBeenCalled();
  });

  it("names a guest who has no account at all, from the panel's own field", async () => {
    /*
     * User directive, 2026-09-08: "here add the option to type the unknown
     * not user as well as a speaker." A client or a candidate has no account,
     * so no candidate can ever offer them — and a meeting with a guest in it
     * is the ordinary case, not the exotic one.
     */
    draw();
    await openMenu();
    const box = screen.getByLabelText("voiceGuest");
    /* typed with the spaces a person actually leaves — the row is named by
       what the transcript will read, not by what was in the box */
    await userEvent.type(box, "  خانم رضایی  ");
    await userEvent.click(screen.getByRole("button", { name: "voiceGuestAdd" }));

    await waitFor(() => expect(createPerson).toHaveBeenCalledWith("خانم رضایی", ""));
    expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", "p-new");
    /* a guest is a person, not an account: nothing is paired */
    expect(updatePerson).not.toHaveBeenCalled();
  });

  it("adds a guest on Enter too — the field is where the typing already is", async () => {
    draw();
    await openMenu();
    await userEvent.type(screen.getByLabelText("voiceGuest"), "خانم رضایی{Enter}");
    await waitFor(() => expect(createPerson).toHaveBeenCalledWith("خانم رضایی", ""));
    expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", "p-new");
  });

  it("will not add a guest with no name — by either door", async () => {
    /*
     * The control for the two tests above, and it needs BOTH doors: the
     * button carries the disabled state, and Enter does not — a guard on the
     * button alone leaves the keyboard path putting a nameless row in the
     * directory. (Verify-red found exactly that: a mutation to the trim
     * inside `addGuest` could not fail while this test only pressed the
     * button.)
     */
    draw();
    await openMenu();
    expect(screen.getByRole("button", { name: "voiceGuestAdd" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("voiceGuest"), "   ");
    expect(screen.getByRole("button", { name: "voiceGuestAdd" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("voiceGuest"), "{Enter}");
    expect(createPerson).not.toHaveBeenCalled();
    expect(linkSpeaker).not.toHaveBeenCalled();
  });

  it("still links when the pairing cannot be saved — and SAYS it was not", async () => {
    /*
     * Writing `app_user_id` is admin work on the directory surface, so a
     * member host gets a refusal here and the link they asked for. A silent
     * swallow would read as the platform forgetting on purpose (M21: a
     * forfeit is said out loud).
     */
    updatePerson.mockRejectedValueOnce(new Error("403"));
    /* a name-resolved colleague whose row is not yet paired — the one case
       that writes a pairing at all since 2026-09-16 */
    draw({
      candidates: [{ memberId: "u-amir", name: "امیررضا باقری", personId: "p-amir", isHost: true, attended: true }],
    });
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /امیررضا باقری/ }));

    await waitFor(() => expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", "p-amir"));
    expect(await screen.findByRole("status")).toHaveTextContent("voiceNotRemembered");
  });

  it("a refused link says so and names nobody", async () => {
    linkSpeaker.mockRejectedValueOnce(new Error("refused"));
    draw();
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /سینا سپاسی/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("writeFailed");
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("names the nothing when the meeting has no roster at all", async () => {
    /* a menu holding only the host is not a broken picker; it is a meeting
       nobody was added to, and the way out is a different tab */
    draw({ candidates: [CANDIDATES[0]!] });
    const offered = await openMenu();
    expect(offered.join(" ")).toContain("voiceNoRoster");
  });

  it("keeps the row a matcher chose, so a name it got wrong can be taken back", async () => {
    /* the worker may link somebody who is not on the roster; without their
       row the check has nowhere to sit and the current name is invisible in
       the list it is supposed to be chosen from */
    draw({ speaker: speaker({ person_id: "p-amir", person_name: "امیررضا باقری" }), name: "امیررضا باقری" });
    const offered = await openMenu();
    expect(offered.join(" ")).toContain("امیررضا باقری");
  });
});
