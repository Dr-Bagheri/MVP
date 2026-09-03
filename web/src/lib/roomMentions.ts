/**
 * `@ava` inside a room's message, split out so it can be rendered as a chip
 * carrying that agent's face (db/0164).
 *
 * ── Why this mirrors the producer's regex and not a looser one ────────────
 *
 * core/src/api/rooms.ts's `handoffTarget` decides who ACTUALLY takes the next
 * turn, and it matches `@([A-Za-z0-9][A-Za-z0-9_-]{0,63})`. If this file used
 * a wider pattern the screen would draw a chip for something that handed work
 * to nobody — a rendering that claims a mechanism fired when it did not,
 * which is the "reads as satisfied" failure one layer up from the code.
 * A NARROWER one is just as wrong in the other direction: a real hand-off
 * rendered as plain text.
 *
 * ── Why only a handle IN THE ROSTER becomes a chip ────────────────────────
 *
 * The same reason the producer gives: a name is not authority. An agent can
 * write "@finance" into its answer, and if nobody invited @finance the word
 * reaches nobody — so it must not be drawn as a colleague who was addressed.
 * The roster is the room's own membership, which only a person can write.
 *
 * Note the ONE deliberate difference from the producer, and it is not a
 * second belief about the wire: `handoffTarget` reads the FINAL LINE only,
 * because that is where a hand-off is a hand-off. This marks up mentions
 * wherever they appear, because a chip is about legibility ("this word names
 * a colleague") rather than about who speaks next. Drawing the chip only on
 * the last line would leave the same token rendered two ways in one message.
 */
const MENTION = /@([A-Za-z0-9][A-Za-z0-9_-]{0,63})/g;

export type MentionPart =
  | { kind: "text"; text: string }
  /** `handle` is the ROSTER's spelling, not the message's — a message may
      write `@AVA` and the chip must name the agent as the room does */
  | { kind: "mention"; handle: string };

/**
 * Split a message body into text runs and roster mentions, in order.
 *
 * Always returns at least one part for a non-empty body, so a caller can
 * render the result without a special case for "no mentions".
 */
export function splitMentions(body: string, roster: readonly string[]): MentionPart[] {
  const byLower = new Map(roster.map((handle) => [handle.toLowerCase(), handle] as const));
  const parts: MentionPart[] = [];
  let at = 0;
  for (const match of body.matchAll(MENTION)) {
    const start = match.index ?? 0;
    const found = byLower.get(String(match[1]).toLowerCase());
    /* an invented handle stays TEXT — it reached nobody, and a chip would
       say otherwise */
    if (found === undefined) continue;
    if (start > at) parts.push({ kind: "text", text: body.slice(at, start) });
    parts.push({ kind: "mention", handle: found });
    at = start + match[0].length;
  }
  if (at < body.length) parts.push({ kind: "text", text: body.slice(at) });
  return parts;
}
