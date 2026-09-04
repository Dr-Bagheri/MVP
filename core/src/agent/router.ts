import type { Identity } from "./types.ts";

/**
 * WHO ANSWERS THIS TURN.
 *
 * User directive, 2026-09-04: "take a message to a neutral ground and see
 * which of them are getting called first — only that one should answer … I
 * don't want Echo to call them each time."
 *
 * ── THE SHAPE, AND WHY IT IS A HANDOFF ────────────────────────────────────
 *
 * Two patterns exist for getting a specialist involved, and the frameworks
 * that ship both draw the line where the user's complaint is. An agent-as-TOOL
 * keeps the caller owning the user-facing conversation — Echo asks Roya, reads
 * her answer, and speaks. A HANDOFF gives the chosen agent the whole turn.
 * What was asked for is the handoff, so the router decides once, before the
 * run, and exactly one voice answers.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * It is not a quality improvement and should not be sold as one. Splitting a
 * generalist into specialists spends more tokens for the same answer, and the
 * largest published taxonomy of multi-agent failures puts *inter-agent
 * misalignment* at over a third of them — a category that exists only because
 * somebody split. The reason here is voice: a named colleague should answer
 * for herself rather than be ventriloquised. So the job of this file is to
 * LOSE NOTHING, not to gain something.
 *
 * ── THE STAGES ────────────────────────────────────────────────────────────
 *
 * 0. Deterministic pre-empt, no model call at all: an explicit @mention, a
 *    surface that names an agent, or a run this thread is already waiting on.
 *    What a person named beats what a model inferred, always.
 * 1. One cheap constrained call — the roster, the LAST message, and who spoke
 *    last. Not the thread.
 * 2. Hysteresis: cheap to stay, expensive to move.
 * 3. Every nothing gets its own answer (see `decide`).
 *
 * ── WHY THE ROUTER MUST NOT SEE THE THREAD ────────────────────────────────
 *
 * This is the best-documented way to break a router and it is worth stating
 * plainly, because "give it more context" is the reflex. A reported production
 * case: turn one asks for a hard piece of code and routes to a strong model;
 * turn two says "looks good, commit it" and routes to a tiny one, because
 * "commit it" carries no topic. The same failure here is «و بعدش؟» after
 * Ava's answer landing on Echo. The fix is not more context — it is the
 * incumbent, below.
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
  /** the model chose */
  | "model"
  /** the model chose someone else and was not confident enough to move */
  | "sticky"
  /** nothing to go on, and no incumbent */
  | "floor"
  /** the router could not answer — a timeout, an error, a name nobody has */
  | "fallback";

export interface RouteDecision {
  agent: Responder;
  rule: RouteRule;
  /** null when no model call was made — an absence, not a zero */
  confidence: number | null;
  incumbent: Responder | null;
  switched: boolean;
}

/**
 * What the classifier is asked to return. Deliberately three fields: an agent,
 * how sure it is, and whether this is the same topic as the last turn — the
 * third is what lets a follow-up stay put without the router having to read
 * the follow-up's history to understand it.
 */
export interface RouterVerdict {
  agent: Responder;
  confidence: number;
  continues_previous_topic: boolean;
}

export interface RosterEntry {
  handle: Responder;
  /** what this one owns, in one line — the routing contract */
  owns: string;
  /** canonical questions, in BOTH locales (see the locale note below) */
  examples: string[];
}

/**
 * ASYMMETRIC BY DESIGN: cheap to stay, expensive to move.
 *
 * The numbers are the published shape for this — a low bar to keep the current
 * speaker and a high one to take the turn away from them, the same idea an
 * audio compressor calls fast-attack/slow-release. They are thresholds, not
 * measurements, and they are named here so a future change is a decision
 * somebody makes rather than a number somebody edits.
 */
export const KEEP_FLOOR = 0.5;    // first turn: below this, Echo answers
export const SWITCH_FLOOR = 0.75; // taking the turn from the incumbent

/**
 * The decision, given a verdict (or the absence of one).
 *
 * Pure, and separated from the model call on purpose: the hysteresis is the
 * part with the interesting failure modes, and it is testable without a
 * network. `verdict === null` covers every way the call can fail to produce
 * one — a timeout, a transport error, or a name no agent has — because from
 * here they are the same fact: nothing usable came back.
 */
export function decide(
  verdict: RouterVerdict | null,
  incumbent: Responder | null,
  known: ReadonlySet<Responder>,
): RouteDecision {
  /*
   * FAIL OPEN TO THE GENERALIST. A router outage must never produce "no
   * answer" — and `fallback` is a distinct rule from a confident route to
   * Echo, so the log can tell the two apart. They look identical in the
   * product and mean opposite things about the router's health.
   */
  if (verdict === null || !known.has(verdict.agent)) {
    return {
      agent: incumbent ?? ECHO,
      rule: "fallback",
      confidence: null,
      incumbent,
      switched: false,
    };
  }

  const { agent, confidence } = verdict;

  if (incumbent === null) {
    /* the first turn of a thread: no one to be loyal to. Echo is the abstain
       target, and it is a real product surface rather than an error state —
       most routers do not have that luxury. */
    return confidence >= KEEP_FLOOR
      ? { agent, rule: "model", confidence, incumbent, switched: false }
      : { agent: ECHO, rule: "floor", confidence, incumbent, switched: false };
  }

  if (agent === incumbent) {
    return { agent, rule: "model", confidence, incumbent, switched: false };
  }

  /*
   * A FOLLOW-UP STAYS PUT. «و بعدش؟» is not a topic — it is a continuation,
   * and the classifier says so in its own field rather than this file trying
   * to recognise the phrase in two languages.
   */
  if (verdict.continues_previous_topic) {
    return { agent: incumbent, rule: "sticky", confidence, incumbent, switched: false };
  }

  if (confidence >= SWITCH_FLOOR) {
    return { agent, rule: "model", confidence, incumbent, switched: true };
  }

  /* a tie goes to whoever is already speaking */
  return { agent: incumbent, rule: "sticky", confidence, incumbent, switched: false };
}

/**
 * The prompt. Roster + the last message + who spoke last — and nothing else.
 *
 * The examples carry BOTH locales, and that is not thoroughness. This product
 * is Persian-first, so the default path is the one a reader is structurally
 * least likely to check; a roster described only in English will route the two
 * languages differently and nobody will notice, because the language nobody
 * tests is the one that keeps working by accident.
 */
export function routerPrompt(
  roster: readonly RosterEntry[],
  incumbent: Responder | null,
): string {
  const lines = roster.map(
    (r) => `- ${r.handle}: ${r.owns}\n  ${r.examples.map((e) => `"${e}"`).join(" · ")}`,
  );
  return [
    "You route ONE message to ONE responder. You do not answer it.",
    "",
    "The responders:",
    ...lines,
    "",
    incumbent === null
      ? "No one has answered in this conversation yet."
      : `The last turn was answered by: ${incumbent}.`,
    "",
    "Return JSON only:",
    '{"agent":"<handle>","confidence":<0..1>,"continues_previous_topic":<bool>}',
    "",
    "`continues_previous_topic` is true when the message is a follow-up to the",
    "last turn — a short acknowledgement, a request for more detail, a pronoun",
    "with no new subject. It is the difference between a new question and the",
    "same conversation, and it matters more than the agent you pick.",
    "Confidence is how sure you are of the AGENT, not of your reading.",
  ].join("\n");
}

/**
 * The roster the router is given, derived from the agents the caller can see.
 *
 * `owns` and `examples` are the routing CONTRACT: vague capability lines are
 * the documented cause of random routing, and when two responders keep being
 * confused for one another the fix is these sentences, not the model. Echo is
 * first and is described as the fallback, so an unclassifiable message has an
 * obvious home.
 */
export function rosterFor(
  agents: readonly { handle: string; description: string }[],
  locale: string | undefined,
): RosterEntry[] {
  const fa = locale !== "en";
  const echo: RosterEntry = {
    handle: ECHO,
    owns: fa
      ? "دستیار عمومی پلتفرم. هر چیزی که آشکارا کار یکی از دیگران نیست."
      : "The platform's general assistant. Anything not clearly one of the others'.",
    examples: fa
      ? ["سلام", "این پلتفرم چه کارهایی می‌کند؟", "کمکم کن"]
      : ["hello", "what can this platform do?", "help me"],
  };
  return [
    echo,
    ...agents.map((a) => ({
      handle: a.handle,
      owns: a.description,
      examples: [],
    })),
  ];
}

/**
 * Read a verdict out of whatever the model returned.
 *
 * Tolerant on the way in and strict on the way out: models fence JSON, prefix
 * it with a sentence, or return a number where a boolean was asked for, and
 * none of that is worth failing a turn over. Anything that cannot be read
 * becomes `null`, which `decide` already treats as "nothing usable came back"
 * — the same branch as a timeout, because from the decision's point of view
 * they are the same fact.
 */
export function parseVerdict(text: string): RouterVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const agent = typeof row.agent === "string" ? row.agent.trim().toLowerCase() : "";
  if (agent === "") return null;
  /* a missing confidence is NOT zero — zero is a statement, absence is not.
     0.5 sits exactly on the keep floor, so an unstated confidence is enough to
     answer a fresh thread and never enough to take a turn from somebody. */
  const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence)
    ? Math.min(1, Math.max(0, row.confidence))
    : 0.5;
  return {
    agent,
    confidence,
    continues_previous_topic: row.continues_previous_topic === true,
  };
}

/** Test seam / caller helper: the identity is unused today and named so the
    signature does not change when per-person routing preferences arrive. */
export type RouterIdentity = Identity;
