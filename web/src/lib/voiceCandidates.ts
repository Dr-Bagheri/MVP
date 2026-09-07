import type { MeetingRecord, Person } from "@/api/types";
import { personName } from "@/lib/format";

/**
 * WHO A VOICE ON THIS RECORD COULD BE — the meeting's own people, and only
 * them.
 *
 * User directive, 2026-09-07: "the speaker name must come at the
 * transcription and only from people that have been in the meeting, not all
 * of them … so you can open the speaker and choose one of the people that
 * attended in case the enrolment is fail."
 *
 * ── THE CHAIN THIS CROSSES, AND WHY IT IS A MODULE ────────────────────────
 *
 * A meeting's people are ACCOUNTS (`app_user`, db/0202's roster) and a voice
 * is linked to a DIRECTORY PERSON (`echo.person`, whose row carries the
 * voiceprint). Those are two tables and nothing in the product had ever
 * joined them for a reader.
 *
 * Read at owner altitude on production, 2026-09-07, before any of this was
 * written: five directory people, fourteen accounts, **zero `app_user_id`
 * links and zero folded-name suggestions** — because the directory is spelled
 * in Persian («سینا سپاسی») and the accounts in Latin ("Sina Sepasi"), and
 * `suggested_app_user_id` is an exact fold, which cannot cross a
 * transliteration. So the ranking that shipped the day before — the meeting's
 * people first, everybody else after — resolved to nobody: every candidate
 * fell into "everybody else", which is precisely the list the user is asking
 * to be rid of.
 *
 * That is why this is a module with its own tests rather than three lines
 * inside a component: it is arithmetic over two tables, it decides who a
 * person may be named as, and none of it is visible from the rendered DOM.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *
 * · THE HOST IS ALWAYS A CANDIDATE. They are not on the roster — nobody
 *   invites themselves (0145's own note) — and they are the one person the
 *   record proves was in the room, because they own it and they pressed
 *   start. Leaving them out would have made every solo recording, which is
 *   every recording on this deployment, a picker with no answer in it.
 * · THE LABEL IS WHAT THE TRANSCRIPT WILL SAY. A resolved candidate is shown
 *   by their DIRECTORY name, not their account name: pick «سینا سپاسی» and
 *   the transcript reads «سینا سپاسی». Labelling the option "Sina Sepasi"
 *   and then rendering the other spelling is a small lie about what the
 *   press did.
 * · AN UNRESOLVED MEMBER IS STILL OFFERED, carrying `personId: null`. The
 *   surface asks WHICH directory person they are and remembers the answer;
 *   dropping them would hide exactly the people the chain has not learned
 *   yet, which today is all fourteen.
 */
export interface VoiceCandidate {
  /** the platform account — what makes this person one of the meeting's */
  memberId: string;
  /** what to call them: the directory's name when known, else the account's */
  name: string;
  /** the row a link is written to, or null while the platform has not learned it */
  personId: string | null;
  /** the meeting's host, listed first and never absent */
  isHost: boolean;
  /** db/0202 stamped them present. Affirmative only: a missing stamp is
      silence — somebody who dialled in from a phone was still in the room —
      so this orders the list and never filters it. */
  attended: boolean;
}

type MeetingPeople = Pick<
  MeetingRecord, "created_by" | "host_name" | "host_name_en" | "attendees"
>;

/**
 * The directory person an account is known to be, or null.
 *
 * Two rungs, in this order, and no third: the LINK an admin wrote
 * (`app_user_id`), then the server's own folded-name suggestion — which is
 * filled only when exactly one member matches, and is read here rather than
 * re-derived, because a second spelling of "this person is probably that
 * member" is how two surfaces come to disagree about the same pair.
 */
export function directoryPersonFor(
  memberId: string,
  people: readonly Person[],
): Person | null {
  return people.find((p) => p.app_user_id === memberId)
    ?? people.find((p) => p.suggested_app_user_id === memberId)
    ?? null;
}

export function meetingVoiceCandidates(
  meeting: MeetingPeople,
  people: readonly Person[],
  locale: string,
): VoiceCandidate[] {
  const seen = new Set<string>();
  const out: VoiceCandidate[] = [];

  const add = (memberId: string, accountName: string, isHost: boolean, attended: boolean) => {
    /* the host may also sit on their own roster (0202 does not stop it), and
       one person offered twice is a picker that reads as two people */
    if (seen.has(memberId)) return;
    seen.add(memberId);
    const person = directoryPersonFor(memberId, people);
    out.push({
      memberId,
      name: person?.display_name.trim() || accountName,
      personId: person?.id ?? null,
      isHost,
      attended,
    });
  };

  add(
    meeting.created_by,
    personName({ display_name: meeting.host_name ?? "", display_name_en: meeting.host_name_en }, locale),
    true,
    true,
  );

  /* those the meeting recorded as present first, then the rest of the
     roster; alphabetical inside each, because a list whose order changes
     between two readings of one record is a list nobody learns */
  const roster = [...meeting.attendees].sort((a, b) => {
    if (a.attended !== b.attended) return a.attended ? -1 : 1;
    return personName(a, locale).localeCompare(personName(b, locale), locale);
  });
  for (const a of roster) add(a.user_id, personName(a, locale), false, a.attended);

  return out;
}
