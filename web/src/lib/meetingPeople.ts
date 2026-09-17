import { personName } from "@/lib/format";
import type { MeetingRecord } from "@/api/types";

/** one person on a meeting, however the row happens to hold them */
export interface MeetingPerson {
  /** an account's `user_id`, or `invitee:<name>` for somebody without one —
      the key the org roster's photo map answers to, and a guest misses it */
  key: string;
  /** resolved for the reading locale, once, here */
  name: string;
  kind: "host" | "member" | "guest";
  /** they were IN THE ROOM — never the inverse claim: a guest has no signal
      at all, and absence here is silence rather than «did not come» (0202) */
  attended: boolean;
}

/**
 * WHO WAS THERE, as one list of people rather than three shapes.
 *
 * `attendees` are the members (db/0202) with names resolved from user
 * management; `invitees` are the people with no account, who are a string and
 * can never be more than one. Every surface draws them the same way because a
 * reader is asking "who is in this meeting", not "which table are they in".
 *
 * THE HOST IS ONE OF THEM, and this is the third place that has had to learn
 * it: the minutes counted nobody for a meeting somebody ran alone (user
 * report, 2026-09-02, "the attendees still does not count me"), the document
 * then missed the members when the roster moved to accounts (2026-09-07), and
 * the meetings list has been drawing every meeting MINUS the person who ran
 * it ever since — because nobody invites themselves, so `created_by` appears
 * in neither column. Three readings of one question is the drift this
 * codebase keeps finding, so there is one now and every surface calls it.
 *
 * They are `attended` by construction rather than by 0202's stamp: the take
 * runs in the host's own browser and it is their press that starts it, which
 * is the one attendance fact that needs no evidence.
 *
 * It lives in `lib/` rather than beside the list it was written for so that a
 * panel on the meeting stage can ask the question without importing the
 * meetings screen — and so the rule can be tested without rendering anything.
 *
 * The ones who actually TURNED UP come first, so a held meeting's stack shows
 * the people who were in the room — and `sort` is stable, which is what keeps
 * the host at the head of them.
 */
export function meetingPeople(m: MeetingRecord, locale: string): MeetingPerson[] {
  const hostName = personName(
    { display_name: m.host_name ?? "", display_name_en: m.host_name_en },
    locale,
  );
  /* a TOMBSTONED author leaves the meeting standing with no name to show
     (core resolves `host_name` through a LEFT join for exactly that), and a
     row drawn for them would be a mark with an empty initial */
  const host: MeetingPerson[] = m.host_name === null
    ? []
    : [{ key: m.created_by, name: hostName, kind: "host", attended: true }];
  const members = m.attendees
    /* by ID, not by name: two colleagues may share a display name, and the
       host added to their own meeting must not be drawn twice */
    .filter((a) => a.user_id !== m.created_by)
    .map((a): MeetingPerson => ({
      key: a.user_id, name: personName(a, locale), kind: "member", attended: a.attended,
    }));
  const guests = m.invitees
    /* a guest has no id to compare, so the NAME is all there is */
    .filter((name) => name !== hostName)
    .map((name): MeetingPerson => ({
      key: `invitee:${name}`, name, kind: "guest", attended: false,
    }));
  return [...host, ...members, ...guests].sort((a, b) => Number(b.attended) - Number(a.attended));
}
