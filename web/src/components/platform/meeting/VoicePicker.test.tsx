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

  it("asks WHICH directory person an unlearned colleague is, then remembers it and links", async () => {
    /*
     * The step without which this menu is decoration on this deployment: not
     * one account is linked to a directory person, so every candidate
     * arrives with `personId: null` and a picker that could only use
     * resolved ones would refuse every press.
     */
    draw();
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /drbagheri/ }));

    expect(await screen.findByText("voiceWhoTitle:drbagheri")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /voiceWhoPick/ }));
    await userEvent.click(await screen.findByRole("option", { name: "امیررضا باقری" }));
    await userEvent.click(screen.getByRole("button", { name: "voiceWhoSave" }));

    /* the pairing FIRST — it is the durable half, and it is what stops the
       question coming back on every later meeting */
    await waitFor(() => expect(updatePerson).toHaveBeenCalledWith("p-amir", { app_user_id: "u-host" }));
    expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", "p-amir");
  });

  it("adds a person the directory has never held, under the name the host types", async () => {
    draw();
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /drbagheri/ }));
    await userEvent.click(screen.getByRole("button", { name: /voiceWhoPick/ }));
    await userEvent.click(await screen.findByRole("option", { name: "voiceWhoNew" }));

    const box = screen.getByLabelText("voiceWhoName");
    await userEvent.clear(box);
    await userEvent.type(box, "امیررضا");
    await userEvent.click(screen.getByRole("button", { name: "voiceWhoSave" }));

    await waitFor(() => expect(createPerson).toHaveBeenCalledWith("امیررضا", ""));
    expect(linkSpeaker).toHaveBeenCalledWith("c1", "s1", "p-new");
  });

  it("still links when the pairing cannot be saved — and SAYS it was not", async () => {
    /*
     * Writing `app_user_id` is admin work on the directory surface, so a
     * member host gets a refusal here and the link they asked for. A silent
     * swallow would read as the platform forgetting on purpose (M21: a
     * forfeit is said out loud).
     */
    updatePerson.mockRejectedValueOnce(new Error("403"));
    draw();
    await openMenu();
    await userEvent.click(screen.getByRole("option", { name: /drbagheri/ }));
    await userEvent.click(screen.getByRole("button", { name: /voiceWhoPick/ }));
    await userEvent.click(await screen.findByRole("option", { name: "امیررضا باقری" }));
    await userEvent.click(screen.getByRole("button", { name: "voiceWhoSave" }));

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
