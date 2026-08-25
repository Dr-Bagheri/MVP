import { faDisplay } from "@/lib/faDisplay";

/**
 * WHO IS SPEAKING — a suggestion, never an answer (user directive,
 * 2026-08-25: "auto-suggest from the transcript").
 *
 * The transcript already contains the evidence a human uses when they link
 * a speaker by hand: people say each other's names. Two signals, both cheap
 * and both explainable to the person who has to accept or reject them:
 *
 *   LABEL   — the label itself carries a name ("Ali", "علی"). Soniox and
 *             our own renames both put real names here. Strong.
 *   HANDOFF — the turn immediately BEFORE this speaker started says a
 *             directory name ("چی فکر می‌کنی، علی؟" → the next voice is
 *             probably Ali). Weak on its own, decisive when repeated.
 *
 * What this deliberately does NOT do:
 *
 *  - it never matches a SUBSTRING. The repo has burned on this exact class
 *    once already («دی» matching inside «محمدی», a person's name): a short
 *    Persian name inside a longer word is a false-positive factory. Every
 *    comparison here is token-to-token after splitting on whitespace and
 *    punctuation, so a name matches a WORD or it does not match.
 *  - it never suggests when the runner-up is just as likely. A suggestion
 *    that is right half the time trains people to accept it without
 *    reading, which is worse than no suggestion at all.
 *  - it never suggests a person already linked to another speaker in the
 *    same call — one body, one voice.
 *  - it never saves. The panel pre-fills; a human presses the button.
 */

export interface SuggestSegment {
  speaker_id: string | null;
  text: string;
  start_ms: number;
}

export interface SuggestSpeaker {
  id: string;
  label: string;
  person_id: string | null;
}

export interface SuggestPerson {
  id: string;
  display_name: string;
}

/** score below which nothing is offered — one handoff mention is a coincidence */
const MIN_SCORE = 2;
const LABEL_WEIGHT = 3;
const HANDOFF_WEIGHT = 1;
/** how far back into the previous turn we look for a name, in characters */
const HANDOFF_TAIL = 120;

/** tokens a name is allowed to be recognized by — anything shorter is noise */
const MIN_TOKEN = 3;

/** split on everything that is not a letter or a digit, in any script */
function tokens(text: string): string[] {
  return faDisplay(text)
    .replace(/‌/g, " ") // ZWNJ joins words for a reader, not for a matcher
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN);
}

/**
 * A person is recognized by any of their name's own tokens that no OTHER
 * person in the directory shares — a shared family name identifies nobody,
 * and offering it would be the confident half of a coin flip.
 */
function distinctiveTokens(people: SuggestPerson[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const person of people) {
    for (const token of new Set(tokens(person.display_name))) {
      owners.set(token, [...(owners.get(token) ?? []), person.id]);
    }
  }
  const byPerson = new Map<string, string[]>();
  for (const [token, ids] of owners) {
    if (ids.length !== 1) continue; // shared → identifies nobody
    const id = ids[0]!;
    byPerson.set(id, [...(byPerson.get(id) ?? []), token]);
  }
  return byPerson;
}

/**
 * Returns speaker id → suggested person id, for the speakers that have no
 * link yet. A speaker missing from the map is the honest answer "we have
 * nothing to offer here" — which is a different thing from an empty
 * suggestion, and renders differently.
 */
export function suggestSpeakerPeople(
  segments: SuggestSegment[],
  speakers: SuggestSpeaker[],
  people: SuggestPerson[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (people.length === 0) return out;

  const nameTokens = distinctiveTokens(people);
  /** already spoken for — a person linked elsewhere in this call is not free */
  const taken = new Set(
    speakers.map((s) => s.person_id).filter((id): id is string => id !== null));

  /** person id → score, per speaker */
  const scores = new Map<string, Map<string, number>>();
  const bump = (speakerId: string, personId: string, by: number) => {
    const row = scores.get(speakerId) ?? new Map<string, number>();
    row.set(personId, (row.get(personId) ?? 0) + by);
    scores.set(speakerId, row);
  };

  const unlinked = speakers.filter((s) => s.person_id === null);
  if (unlinked.length === 0) return out;

  // 1. the label itself
  for (const speaker of unlinked) {
    const said = new Set(tokens(speaker.label));
    for (const [personId, names] of nameTokens) {
      if (taken.has(personId)) continue;
      if (names.some((token) => said.has(token))) bump(speaker.id, personId, LABEL_WEIGHT);
    }
  }

  // 2. the handoff — a name in the tail of the PREVIOUS speaker's turn
  const ordered = [...segments].sort((a, b) => a.start_ms - b.start_ms);
  for (let i = 1; i < ordered.length; i += 1) {
    const here = ordered[i]!;
    const before = ordered[i - 1]!;
    if (here.speaker_id === null || before.speaker_id === here.speaker_id) continue;
    if (!unlinked.some((s) => s.id === here.speaker_id)) continue;
    const said = new Set(tokens(before.text.slice(-HANDOFF_TAIL)));
    for (const [personId, names] of nameTokens) {
      if (taken.has(personId)) continue;
      if (names.some((token) => said.has(token))) {
        bump(here.speaker_id, personId, HANDOFF_WEIGHT);
      }
    }
  }

  // 3. decide — only where the winner is ALONE at the top
  for (const [speakerId, row] of scores) {
    const ranked = [...row.entries()].sort((a, b) => b[1] - a[1]);
    const best = ranked[0];
    if (!best || best[1] < MIN_SCORE) continue;
    if (ranked[1] && ranked[1][1] === best[1]) continue; // a tie suggests nothing
    out.set(speakerId, best[0]);
  }
  return out;
}
