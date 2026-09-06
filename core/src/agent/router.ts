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
 *
 * ── THE FLOOR (user directive, 2026-09-06) ────────────────────────────────
 *
 * "When I ask for Roya or Ava they are supposed to keep talking back until I
 * say someone else's name. If I say 'Roya come here' and in the next message
 * don't mention her name, she should not just leave — like humans do: the
 * person who was called joins, says hello, and answers until you address
 * somebody else." And, ruled the same day: two names in one message → BOTH
 * answer; the floor is released only by a name or the × on the screen.
 *
 * So the thread has a FLOOR — the set of colleagues who hold it — and the
 * rule stays free of inference, which is what retired the classifier:
 *
 *   · a message that NAMES somebody sets the floor to exactly those named,
 *     in the order they appear — one name, one holder; two names, two
 *     holders, and each answers in turn;
 *   · a message that names nobody goes to whoever holds the floor;
 *   · naming Echo («اکو», @echo) hands the floor back — Echo is the
 *     default, and a floor of exactly [echo] is stored as nothing, so "Echo
 *     holds it" and "nobody was ever called" are one state rather than two
 *     spellings of one;
 *   · the × on the composer releases it the same way, through the same
 *     column, so the screen and the server never disagree about who is in
 *     the room.
 *
 * The 2026-09-04 reading ("nobody named means Echo, even after a specialist
 * answered") is therefore REVERSED for the case it was about — a follow-up
 * after a called colleague — and unchanged for the case that drove it: a
 * name always beats an incumbent, and nothing but a name or the × moves the
 * floor. The bug that retired the classifier (a topic outvoting a name)
 * cannot come back through this door, because this door reads no topic.
 */

/** `echo` is the platform assistant; the rest are agent handles. */
export type Responder = string;
export const ECHO: Responder = "echo";

/** How the decision was reached — logged, and answerable from the audit. */
export type RouteRule =
  /** the person named an agent, or a surface did */
  | "mention"
  /** nobody was named and somebody was called earlier: the floor answers */
  | "floor"
  /** this thread has a run waiting for an answer; it owns the turn */
  | "resume"
  /** nobody was named: the generalist answers, which is the product's default */
  | "default";

export interface RouteDecision {
  /**
   * A READ FAILED on the way here (the floor or the roster), so this decision
   * was made on a blank where a fact should be. The answer still goes out —
   * a hiccup must not stop a question — but nothing may be WRITTEN from it:
   * a floor computed from "nobody holds it" would be persisted as "nobody
   * holds it", and Roya would be dismissed by a database timeout.
   */
  unreliable?: boolean;
  /** the FIRST responder — the one whose answer streams; the audit's column */
  agent: Responder;
  /** everybody who answers this turn, in order; `agent` is `responders[0]` */
  responders: Responder[];
  /** who holds the floor AFTER this turn; [] = Echo, the default */
  floor: Responder[];
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
 * ONE SPELLING BEFORE MATCHING (2026-09-06). Arabic keyboards write «اكو»
 * with kaf U+0643 and «رويا» with yeh U+064A; Persian ones write ک and ی.
 * The names above are spelled the Persian way, and a raw match let a person
 * on an Arabic layout call nobody — Roya kept the floor, «اكو» could not hand
 * it back. NFC first (a hamza can arrive composed or as a mark), then the
 * four letters that have two code points for one shape, then the ZWNJ that
 * some editors leave inside a name. Applied to the question AND the names,
 * so the fold cannot disagree with itself.
 */
export function foldName(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u064A\u0649]/g, "\u06CC")   // ي / ى → ی
    .replace(/\u0643/g, "\u06A9")            // ك → ک
    .replace(/\u0629/g, "\u0647")            // ة → ه
    .replace(/\u200C/g, "")                   // ZWNJ
    .toLowerCase();
}

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
  return namesIn(question, roster)[0] ?? null;
}

/**
 * EVERY agent this message names, in the order they first appear.
 *
 * `nameIn` kept the first because one run had one persona; the floor answers
 * with every named colleague in turn (user, 2026-09-06: "when two names are
 * said in one message, both answer"), so the order is the order of address —
 * "Roya and Ava, look at this" gets Roya first and Ava after her.
 */
export function namesIn(question: string, roster: readonly RosterEntry[]): Responder[] {
  const folded = foldName(question);
  const hits: { handle: Responder; at: number }[] = [];
  for (const entry of roster) {
    let at: number | null = null;
    for (const name of entry.names) {
      const found = BOUNDED(foldName(name)).exec(folded);
      if (found !== null && (at === null || found.index < at)) at = found.index;
    }
    if (at !== null) hits.push({ handle: entry.handle, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((hit) => hit.handle);
}

/**
 * The decision.
 *
 * Pure and tiny, which is the point: the failure this replaces could only be
 * reproduced by calling a model, and this one can be reproduced by calling a
 * function.
 */
export function decide(
  named: readonly Responder[],
  floor: readonly Responder[],
  incumbent: Responder | null,
  known: ReadonlySet<Responder>,
): RouteDecision {
  const called = named.filter((handle) => known.has(handle));
  const base = { confidence: null as number | null, incumbent };
  if (called.length > 0) {
    /* a floor of exactly [echo] is the default and is stored as nothing —
       otherwise "Echo holds the floor" and "nobody was called" would be two
       rows meaning one thing, and the chip would announce Echo as a guest in
       its own thread */
    const next = called.length === 1 && called[0] === ECHO ? [] : called;
    return {
      ...base, agent: called[0]!, responders: called, floor: next,
      rule: "mention", switched: called[0] !== incumbent,
    };
  }
  const holders = floor.filter((handle) => known.has(handle));
  if (holders.length > 0) {
    return {
      ...base, agent: holders[0]!, responders: holders, floor: holders,
      rule: "floor", switched: holders[0] !== incumbent,
    };
  }
  /* nobody named, nobody holding: the generalist, which is the product's
     default and the thing the person did not have to ask for */
  return {
    ...base, agent: ECHO, responders: [ECHO], floor: [],
    rule: "default", switched: incumbent !== null && incumbent !== ECHO,
  };
}

/** The roster this identity may address — Echo plus every visible agent. */
/**
 * WHO ANSWERS IN A ROOM (0184; the reply rule and the hop cap, 2026-09-05).
 *
 * Four rules, and every one of them is invisible from a chair:
 *
 *  · a written name wins over the message being answered, because somebody
 *    who presses reply on Roya and then names Ava is addressing Ava;
 *  · ANSWERING AN AGENT IS NAMING IT, so a reply with no handle still
 *    reaches the agent it answers ("it does not always need to put @
 *    yourself");
 *  · an agent never answers itself — its own sentence carries its own name
 *    often enough that without this the first hand-off is a self-call;
 *  · and the chain stops. Every hop is a model call nobody pressed a button
 *    for, and two agents that keep naming each other would not stop on their
 *    own.
 *
 * Pure, and separated from the route for the reason the router itself is:
 * the failure it replaces could only be reproduced by spending money on two
 * models, and this one can be reproduced by calling a function.
 */
export function roomResponder(
  written: Responder | null,
  opts: {
    /** the agent whose message is being answered, if any */
    replyTo?: string | null;
    /** who produced the text — an agent's handle, or null for a person */
    speaker?: string | null;
    hops: number;
    max: number;
  },
): Responder | null {
  if (opts.hops >= opts.max) return null;
  const named = written ?? opts.replyTo ?? null;
  if (named === null) return null;
  if (opts.speaker !== null && opts.speaker !== undefined && named === opts.speaker) return null;
  return named;
}

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
