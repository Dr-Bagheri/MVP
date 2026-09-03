/**
 * `@roya` in a message means Roya answers it.
 *
 * USER DIRECTIVE, 2026-09-03: "the whole platform should be their room so they
 * can come to any assistant conversation and they answer inline in the
 * assistant thread."
 *
 * The composer's `@` button used to write the character and nothing more — a
 * control that read as wired and did nothing, which is the exact defect this
 * repo has now shipped twice. This is the half that makes it true: the handle
 * is pulled out of the message and travels as `agent`, which core resolves
 * under the caller's own identity (it re-reads the persona from the database
 * rather than trusting anything the browser sends).
 *
 * Three decisions worth the words:
 *
 *   · **The known handles are required.** A mention is only a mention if
 *     somebody answers to it, so this takes the roster and matches against it.
 *     Without that, `@lunch` in "let's discuss @lunch" would be routed to an
 *     agent that does not exist and the ask would come back 400 — an error
 *     about a word the person did not think was a command.
 *
 *   · **The text is left alone.** The mention stays in the question the model
 *     receives. Stripping it would be tidier and would lose information: "what
 *     do you think, @ava?" reads differently to its answerer than "what do you
 *     think?", and the agent being addressed is exactly who should see that it
 *     was addressed.
 *
 *   · **First mention wins, and a second one is not an error.** Two agents
 *     cannot answer one turn — the run has one persona — so the alternative to
 *     picking one is refusing the message, and refusing a message because it
 *     named two colleagues is a worse product than answering as the first. The
 *     caller is told which, so a surface can say so if it wants to.
 */

/** A handle is what db/0065's constraint allows: lowercase, digits, hyphens. */
const MENTION = /@([a-z0-9][a-z0-9-]{0,62})/gi;

export interface AgentMention {
  /** the handle to route to — always one of `known` */
  handle: string;
  /** every other known handle the message named, in the order they appear */
  alsoMentioned: string[];
}

export function mentionedAgent(
  text: string,
  known: readonly string[],
): AgentMention | null {
  if (known.length === 0) return null;
  /* handles are stored lowercase; a person typing `@Roya` at the start of a
     sentence means the same thing, and a case-sensitive match would fail in
     the one place people capitalise by reflex */
  const roster = new Map(known.map((handle) => [handle.toLowerCase(), handle]));
  const found: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const handle = roster.get((match[1] ?? "").toLowerCase());
    if (handle !== undefined && !found.includes(handle)) found.push(handle);
  }
  const first = found[0];
  if (first === undefined) return null;
  return { handle: first, alsoMentioned: found.slice(1) };
}
