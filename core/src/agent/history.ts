/**
 * WHAT WAS SAID BEFORE THIS QUESTION.
 *
 * User report, 2026-09-08: "the AI assistant and agents forget about the
 * talks that we have before … when it answers you it forgets."
 *
 * They were right, and it was not a memory that leaked — there was none. The
 * thread was persisted (M4, db/0018), reloaded, resumed and rendered, and the
 * MODEL never saw a word of it: `runPi` took one `userText`, and `loopInput`
 * handed Pi a context whose `messages` was the empty array on every single
 * run. So every turn was a first turn. The room had a transcript
 * (`roomTranscript`, 2026-09-05) and the assistant — the surface people
 * actually talk to — did not.
 *
 * This module is the shape of that memory, kept out of the route so it can be
 * tested: what a model is shown of a conversation is a decision with rules,
 * and none of them are visible from a rendered thread.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *
 * · TOOL ROWS ARE NOT CONVERSATION. The thread stores tool turns as codes
 *   only, deliberately (arguments quote transcripts). A row that carries no
 *   words is not something anybody said.
 * · A COLLEAGUE'S TURN IS NAMED. Roya's answer sits in the thread as an
 *   assistant turn with her handle on it; unnamed, Echo reads her words as
 *   its own and answers "as I said earlier" about something it never said.
 *   The room learned this the same way ("what did Sara decide" over a
 *   transcript that flattened every human to one label).
 * · THE OLDEST GOES FIRST. A budget spent on the opening pleasantries
 *   answers yesterday's question — trim from the front, whole turns only.
 * · A CLIP IS VISIBLE. One enormous turn can eat the whole budget, so a
 *   single turn is cut at `turnChars` and the cut is MARKED. A silent clip
 *   is a lie about what was said; an ellipsis is a fact.
 *
 * What this is NOT: a summary. Nothing here re-writes, condenses or
 * interprets a turn — a "memory" that paraphrases is a second author in the
 * conversation, and the first thing it would get wrong is the sentence
 * somebody is about to act on.
 */

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

/** The thread's own row, narrowed to what a model may be shown. */
export interface ThreadRow {
  role: "user" | "assistant" | "tool";
  content: string;
  /** db/0169: the colleague who wrote it. Null = Echo, or a human's turn. */
  author: string | null;
}

export interface HistoryLimits {
  /** How many turns at most — the newest ones. */
  maxTurns: number;
  /** Total characters across the kept turns. */
  maxChars: number;
  /** Ceiling for ONE turn, so a single long answer cannot spend the lot. */
  turnChars: number;
}

/**
 * Measured against nothing — chosen, and here is the reasoning. Twenty-four
 * turns is roughly a working conversation (a dozen questions and their
 * answers); 12k characters is about 3–4k tokens, which is affordable beside
 * an 8k output ceiling on every model this product will serve. They are two
 * limits rather than one because they fail differently: a long thread of
 * short turns is cheap and worth keeping whole, and three enormous answers
 * are expensive and worth trimming even though they are only three.
 */
export const HISTORY_LIMITS: HistoryLimits = {
  maxTurns: 24,
  maxChars: 12_000,
  turnChars: 4_000,
};

/** the mark a clipped turn carries, so "cut off here" is on the page */
export const CLIP_MARK = " […]";

export function conversationHistory(
  rows: readonly ThreadRow[],
  limits: HistoryLimits = HISTORY_LIMITS,
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const row of rows) {
    if (row.role === "tool") continue;
    const said = row.content.trim();
    if (said === "") continue;
    /* the SPEAKER, when it is not the one being asked. A human turn keeps no
       prefix: the model is talking to them, and "user: …" in front of every
       question is noise the role already carries. */
    const named = row.role === "assistant" && row.author !== null && row.author !== ""
      ? `${row.author}: ${said}`
      : said;
    turns.push({
      role: row.role,
      text: named.length > limits.turnChars
        ? named.slice(0, limits.turnChars) + CLIP_MARK
        : named,
    });
  }

  const kept = turns.slice(-limits.maxTurns);
  /* whole turns, from the front. `length > 1` rather than `> 0`: the newest
     turn stays even when it alone exceeds the budget — an empty history and
     a history of one clipped turn are different answers, and the second is
     the true one. */
  let total = kept.reduce((n, t) => n + t.text.length, 0);
  while (kept.length > 1 && total > limits.maxChars) {
    total -= kept[0]!.text.length;
    kept.shift();
  }
  return kept;
}
