/**
 * WHAT A VOICE IS CALLED.
 *
 * User directive, 2026-09-06: "when someone [is] added to the meeting and
 * attended to it the speakers already can be recognized based on their
 * session or login or anything else, so it should not say s1 or s2 or else,
 * because the platform already knows — use the knowledge."
 *
 * Two halves, and only one of them is a naming problem.
 *
 * ── The half this module is ───────────────────────────────────────────────
 *
 * `call_speaker.label` is an INTERNAL string: `S1·1` is the diarizer's first
 * cluster in the first part of the recording. It was reaching the screen as a
 * fallback in two places — the meeting's transcript panel and the call page —
 * both spelled `person_name ?? label`, so an unlinked voice was shown to a
 * reader as machine output. The product already had the right shape and it
 * had never travelled: the Recorder says «گویندهٔ ۱».
 *
 * The ordinal here is the speaker's POSITION IN THE ROSTER, not a number
 * parsed out of the label, and that is deliberate. Diarization runs per part,
 * so `S1·1` and `S1·2` are two rows, and rendering both as "speaker 1" would
 * be a claim that the same person spoke in both parts — which is exactly the
 * kind of attribution nothing here is allowed to invent. A position claims
 * only what is true: these are distinct voices, and this is a readable handle
 * for each.
 *
 * ── The half this module is NOT ───────────────────────────────────────────
 *
 * Turning a voice into a PERSON is linking, and linking is a decision. db/0202
 * now records who was actually in the room (`attended_at`), which is the
 * knowledge the directive is pointing at — and it belongs in the picker that
 * offers candidates, ranked, to a human. It does not belong here: a roster
 * that is too long is a chore, and a roster that is wrong is a misquote.
 */

export interface NamedSpeaker {
  id: string;
  label: string;
  person_name?: string | null;
}

export type SpeakerNaming =
  /** linked to a person: their name, and the only case that names anybody */
  | { kind: "person"; name: string }
  /** an unlinked voice, by its place in this call's roster (1-based) */
  | { kind: "ordinal"; n: number }
  /** the segment carries no speaker at all, or names one this call has not got */
  | { kind: "unattributed" };

export function speakerNaming(
  speakerId: string | null | undefined,
  speakers: readonly NamedSpeaker[],
): SpeakerNaming {
  if (speakerId === null || speakerId === undefined) return { kind: "unattributed" };
  const at = speakers.findIndex((s) => s.id === speakerId);
  /*
   * A speaker id the roster does not hold is UNATTRIBUTED, not "speaker 0"
   * and not the id itself. The call page used to fall through to the raw
   * uuid — a database key, rendered to a reader, in the place a name goes.
   */
  if (at < 0) return { kind: "unattributed" };
  const person = speakers[at]!.person_name;
  if (typeof person === "string" && person.trim() !== "") {
    return { kind: "person", name: person };
  }
  return { kind: "ordinal", n: at + 1 };
}
