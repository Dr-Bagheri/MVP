import type { Identity } from "./types.ts";

/**
 * WHO ANSWERS THIS TURN.
 *
 * ── THE RULE, AS THE USER DREW IT (directive, 2026-09-04) ──────────────────
 *
 *     handler → echo | roya | ava          and          echo → roya | ava
 *
 * "The default response must come from Echo if I didn't ask for any agent. If
 * asked for an agent to do it, the handler should not give it to Echo to give
 * it to the agent — the agent comes up by itself."
 *
 * So this file answers one question: DID THE PERSON ASK FOR SOMEBODY. If they
 * did, that agent takes the whole turn. If they did not, Echo answers. There
 * is no third case, and — this is the point — no inference.
 *
 * ── WHAT WAS HERE BEFORE, AND WHY IT WENT ─────────────────────────────────
 *
 * A cheap classifier read the message and guessed which specialist it was
 * about, with hysteresis so a follow-up stayed with the incumbent. It was
 * built for the earlier directive ("take a message to a neutral ground and see
 * which of them gets called first") and it produced exactly the bug that
 * retired it: the user wrote «می‌خوام ببینم که اکو دسترسی داره…» — Echo, by
 * name, in the first six words — and Roya answered, because the message was
 * ABOUT tasks and Roya owns tasks. The classifier was working as designed and
 * the design was wrong: it weighed the topic against the name and the topic
 * won.
 *
 * A router that can override a name is a router that will, and the failure is
 * invisible to the person — they see a colleague they did not ask for, giving
 * an answer they cannot attribute. Topic-routing also cost a model call before
 * any visible token, on every single turn, to reach a decision the person had
 * usually already made.
 *
 * Specialists are still reachable, by both arrows of the diagram: name one and
 * they take the turn; name nobody and Echo answers and may hand a piece to
 * Ava or Roya with its own tools. What is gone is the third path, where
 * something guessed on the person's behalf.
 */

/** `echo` is the platform assistant; the rest are agent handles. */
export type Responder = string;
export const ECHO: Responder = "echo";

/** How the decision was reached — logged, and answerable from the audit. */
export type RouteRule =
  /** the person named an agent, or a surface did */
  | "mention"
  /** this thread has a run waiting for an answer; it owns the turn */
  | "resume"
  /** nobody was named: the generalist answers, which is the product's default */
  | "default";

export interface RouteDecision {
  agent: Responder;
  rule: RouteRule;
  /** kept on the shape so the audit's columns did not have to change; always
      null now that nothing scores a guess */
  confidence: number | null;
  incumbent: Responder | null;
  switched: boolean;
}

export interface RosterEntry {
  handle: Responder;
  /** every way a person might write this agent's name, both scripts */
  names: readonly string[];
}

/**
 * The shipped three, spelled the ways people actually type them.
 *
 * Persian has no capitals and several of these have more than one common
 * spelling — «رؤیا» carries a hamza that many keyboards do not produce, so
 * «رویا» is what gets typed. A name the product answers to must include the
 * spellings the product will be called by, or "I asked for Roya" becomes
 * "nobody was named" and Echo answers instead, which is this file's bug in
 * the other direction.
 */
const SHIPPED_NAMES: Readonly<Record<string, readonly string[]>> = {
  echo: ["echo", "اکو", "اِکو"],
  roya: ["roya", "رؤیا", "رویا"],
  ava: ["ava", "آوا", "اوا"],
};

/** the names an agent answers to: its handle, its stored name, its aliases */
export function namesFor(handle: string, storedName?: string | undefined): string[] {
  const names = new Set<string>([handle]);
  for (const alias of SHIPPED_NAMES[handle] ?? []) names.add(alias);
  const stored = (storedName ?? "").trim();
  /* a one- or two-letter name would match inside half the words in a sentence;
     the roster is not worth a false positive on «تا» or «به» */
  if (stored.length >= 3) names.add(stored.toLowerCase());
  return [...names];
}

/** characters that make a match part of a longer word rather than a name */
const BOUNDED = (name: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "iu");

/**
 * The agent this message asks for, or null.
 *
 * Bounded matching, and the boundary is the whole difference between a name
 * and a substring: «آوا» sits inside «آواز» (a song) and «اکو» inside
 * «اکوسیستم», and this repo has already shipped one substring matcher that
 * found «دی» inside a person's surname and reported a date. A lookbehind and
 * a lookahead for "any letter or digit" is what makes this a word rather than
 * a sequence of characters — Persian has no case and no word boundary that
 * `\b` understands, so `\b` would have been the wrong tool.
 *
 * An `@handle` is matched by the same pass: `@` is not a letter, so it sits
 * outside the boundary and the handle inside it.
 *
 * The FIRST name in the message wins when two are present. "Ask Roya, or Ava
 * if she is busy" names Roya first and Roya is who the person addressed;
 * picking the last would answer the aside.
 */
export function nameIn(question: string, roster: readonly RosterEntry[]): Responder | null {
  let best: { handle: Responder; at: number } | null = null;
  for (const entry of roster) {
    for (const name of entry.names) {
      const found = BOUNDED(name).exec(question);
      if (found === null) continue;
      if (best === null || found.index < best.at) best = { handle: entry.handle, at: found.index };
    }
  }
  return best?.handle ?? null;
}

/**
 * The decision.
 *
 * Pure and tiny, which is the point: the failure this replaces could only be
 * reproduced by calling a model, and this one can be reproduced by calling a
 * function.
 */
export function decide(
  named: Responder | null,
  incumbent: Responder | null,
  known: ReadonlySet<Responder>,
): RouteDecision {
  if (named !== null && known.has(named)) {
    return { agent: named, rule: "mention", confidence: null, incumbent, switched: named !== incumbent };
  }
  /*
   * NOBODY WAS NAMED, so Echo answers — including when a specialist answered
   * the previous turn. That is the directive read literally, and literally is
   * what it needs to be: an incumbent that keeps the turn is a second rule
   * about who speaks, and two rules is how somebody ends up unable to predict
   * which colleague replies. Echo has the thread in front of it either way.
   */
  return { agent: ECHO, rule: "default", confidence: null, incumbent, switched: incumbent !== null && incumbent !== ECHO };
}

/** The roster this identity may address — Echo plus every visible agent. */
export function rosterFor(
  agents: readonly { handle: string; name?: string | undefined }[],
): RosterEntry[] {
  const seen = new Set<string>([ECHO]);
  const roster: RosterEntry[] = [{ handle: ECHO, names: namesFor(ECHO) }];
  for (const agent of agents) {
    if (seen.has(agent.handle)) continue;
    seen.add(agent.handle);
    roster.push({ handle: agent.handle, names: namesFor(agent.handle, agent.name) });
  }
  return roster;
}

/** unused by the decision; kept because the api's log line reads it */
export type { Identity };
