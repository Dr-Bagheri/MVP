/**
 * WHAT AN UNLINKED VOICE IS CALLED — on the server, where the summary is
 * written and the action items are sliced out of it.
 *
 * `echo.call_speaker.label` is an INTERNAL string. `upsertSpeakers` builds it
 * as `<the diarizer's own cluster name>·<the part number>` — `S1·1` is the
 * first cluster of the first part — and it is deliberately per-part, because
 * nothing in the pipeline compares voices across parts.
 *
 * web/ stopped rendering that string to a reader on 2026-09-06
 * (`web/src/lib/speakerNaming.ts`). core/ did not, and it is core/ that hands
 * the transcript to the model: the summarize step spelled the roster
 * `coalesce(p.display_name, cs.label)`, so an unlinked voice reached the
 * writer as `S1·1`, came back in the prose as `S1·1`, and was parsed out of
 * the «Owner: …» line into `meeting_item.owner` — a diarizer's cluster name
 * in the field a person reads as "who is doing this", and the field
 * ItemsPanel resolves against the directory when it makes a task.
 *
 * ── THE HANDLE ────────────────────────────────────────────────────────────
 *
 * The ordinal is the speaker's POSITION IN THE LABEL-SORTED ROSTER, which is
 * exactly what `web/src/lib/speakerNaming.ts` renders, because the speakers
 * route returns the roster `order by s.label` and the browser numbers what it
 * was given. The two must agree or "Speaker 2" in the summary is a different
 * voice from "Speaker 2" in the transcript panel — a summary that is wrong in
 * a way nobody can see. Any caller here sorts by label first.
 *
 * The handle is ENGLISH and unlocalized, and that is not an oversight: it is
 * an identifier inside a prompt, the model writes the summary in the
 * meeting's own language (db/0219), and the reader never sees this string in
 * the place a name goes — the screen renders its own localized «گویندهٔ ۱»
 * from the same position. What the model may echo back into the prose is
 * caught below rather than translated.
 *
 * ── WHAT IS NOT A PERSON ──────────────────────────────────────────────────
 *
 * `isSpeakerPlaceholder` is the wall. It covers BOTH spellings a placeholder
 * can arrive in — the raw roster label, and the handle above once a model has
 * copied it into its own output (in English, and in the Persian the screen
 * uses, since a model summarizing a Persian meeting translates the word it
 * was given). Neither is ever a person, so neither may ever be an owner.
 *
 * Deliberately NOT "the owner must be somebody the platform knows": a summary
 * legitimately names a person who has no account and no directory row — an
 * invitee, a customer, a colleague nobody has added yet — and `meeting.
 * invitees` is free text (0145) for exactly that reason. Refusing every
 * unknown name would trade a false owner for a lost one. What is refused is
 * only the product's own machine output, which is never anybody.
 *
 * The Persian is written as escapes rather than literals ON PURPOSE. This
 * regex turns on a hamza (U+0654) and a ZWNJ (U+200C) — two characters that
 * are invisible in a diff, survive every visual check, and that this
 * repository has a written history of losing to an encoding round trip. An
 * escape cannot be silently mangled, and the test asserts the real strings.
 */

/**
 * `<something>·<digits>` — the shape `upsertSpeakers` writes and the only
 * shape `call_speaker.label` ever takes. db/0220 refuses the same shape in
 * `meeting_item.owner`, so this and that constraint are one rule said twice
 * at two altitudes, not two rules.
 */
const ROSTER_LABEL = /^[^\s\u00B7][^\u00B7]*\u00B7\d+$/u;

/**
 * `Speaker 3` / «گویندهٔ ۳» / «گوینده ۳» — the handle below, and what a model
 * hands back after reading it. Persian and Arabic-Indic digits count: a
 * Persian summary writes «۳», not "3".
 */
const ORDINAL_HANDLE =
  /^(?:speaker|\u06AF\u0648\u06CC\u0646\u062F\u0647(?:\u0654|\u200C\u06CC|\s*\u06CC)?)\s*[\d\u06F0-\u06F9\u0660-\u0669]+$/iu;

/** What an unlinked voice is called in the transcript handed to the model. */
export function speakerHandle(position: number): string {
  return `Speaker ${position}`;
}

const tidy = (name: string): string => name.trim().replace(/[.:\u060C,]+$/u, "").trim();

/**
 * The DIARIZER'S OWN STRING — `S1·1`. Narrower than the placeholder test on
 * purpose: this is the one that db/0220's CHECK mirrors, because it is the
 * shape the machine produces and no human ever types, so a database can
 * refuse it without ever refusing a person.
 */
export function isDiarizerLabel(name: string): boolean {
  const s = tidy(name);
  return s !== "" && ROSTER_LABEL.test(s);
}

/**
 * True when this string is the product's own name for a voice rather than a
 * person's name — the label above, or the handle a model copied out of the
 * transcript. Trimmed and stripped of trailing punctuation, because it
 * arrives out of prose.
 */
export function isSpeakerPlaceholder(name: string): boolean {
  const s = tidy(name);
  return s !== "" && (ROSTER_LABEL.test(s) || ORDINAL_HANDLE.test(s));
}

/**
 * The roster as the model should read it: a linked voice by the person's
 * name, an unlinked one by its position. `rows` MUST already be sorted the
 * way the speakers route sorts (by label) — see the note above.
 */
export function nameSpeakers<T extends { id: string; person_name?: string | null }>(
  rows: readonly T[],
): Map<string, string> {
  const out = new Map<string, string>();
  rows.forEach((row, i) => {
    const person = typeof row.person_name === "string" ? row.person_name.trim() : "";
    out.set(row.id, person !== "" ? person : speakerHandle(i + 1));
  });
  return out;
}
