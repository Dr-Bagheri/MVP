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
 * · AN UNRESOLVED MEMBER IS STILL OFFERED, carrying `personId: null` — but
 *   since 2026-09-16 the surface offers them DISABLED and says why, and
 *   creates NOTHING (user: "when we added the speaker back in transcription
 *   after recording it created a new person on the speakers page; it should
 *   not"). The rung below is what makes that rare: a directory row that
 *   carries the account's name in EITHER script now resolves here, where
 *   before only the admin's link or the server's same-script fold did.
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

/** the two spellings an account may carry, for the name rung */
export interface AccountNames {
  display_name: string;
  display_name_en?: string | null;
}

/**
 * One spelling of a name for comparison: case, Arabic-vs-Persian letter
 * forms (ي/ی, ك/ک, ة/ه), the zero-width joiners and whitespace all folded —
 * the same folds core's router applies before matching an agent's name
 * (2026-09-06), so «سینا سپاسی» and «سينا  سپاسي» are one name.
 */
export function foldName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/[‌‍]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The directory person an account is known to be, or null.
 *
 * Three rungs, in this order, and no fourth: the LINK an admin wrote
 * (`app_user_id`); the server's own folded-name suggestion — filled only when
 * exactly one member matches, and read here rather than re-derived; and the
 * NAME (2026-09-16): a directory row whose folded name equals the account's
 * folded name in either spelling — «سینا سپاسی» beside "Sina Sepasi" whose
 * Latin row is `display_name_en`, or the same Persian name typed with an
 * Arabic yeh. EXACTLY ONE row may match, or the rung answers nothing: two
 * directory rows sharing a name is an ambiguity the picker must not resolve
 * by picking the first (the 2026-09-06 lone-prefix lesson, in a fold).
 */
export function directoryPersonFor(
  memberId: string,
  people: readonly Person[],
  names?: AccountNames,
): Person | null {
  const linked = people.find((p) => p.app_user_id === memberId)
    ?? people.find((p) => p.suggested_app_user_id === memberId);
  if (linked) return linked;
  if (!names) return null;
  const wanted = [foldName(names.display_name), foldName(names.display_name_en)].filter((n) => n !== "");
  if (wanted.length === 0) return null;
  const byName = people.filter((p) => p.app_user_id === null && wanted.includes(foldName(p.display_name)));
  return byName.length === 1 ? byName[0]! : null;
}

export function meetingVoiceCandidates(
  meeting: MeetingPeople,
  people: readonly Person[],
  locale: string,
): VoiceCandidate[] {
  const seen = new Set<string>();
  const out: VoiceCandidate[] = [];

  const add = (memberId: string, names: AccountNames, isHost: boolean, attended: boolean) => {
    /* the host may also sit on their own roster (0202 does not stop it), and
       one person offered twice is a picker that reads as two people */
    if (seen.has(memberId)) return;
    seen.add(memberId);
    const person = directoryPersonFor(memberId, people, names);
    out.push({
      memberId,
      name: person?.display_name.trim() || personName(names, locale),
      personId: person?.id ?? null,
      isHost,
      attended,
    });
  };

  add(
    meeting.created_by,
    { display_name: meeting.host_name ?? "", display_name_en: meeting.host_name_en },
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
  for (const a of roster) add(a.user_id, a, false, a.attended);

  return out;
}
