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

/** One turn of a thread, once it is known to be speech. */
interface Said {
  role: "user" | "assistant";
  /** the colleague who said it (db/0169); null for Echo and for a human. */
  author: string | null;
  /** what was said, clipped and MARKED if it was too long to carry. */
  text: string;
}

/**
 * WHAT COUNTS AS SOMETHING SOMEBODY SAID — decided once, for both renderings.
 *
 * The thread below hands the model roles (`context.messages`); the carry-over
 * block further down hands it a flat transcript with a speaker on every line.
 * They differ in how a speaker is NAMED and not at all in what a speaker is,
 * so the drop-and-clip rule lives here and each rendering names its own.
 *
 * The clip is on the WORDS, not on the rendered line: a handle is not part of
 * what was said, and a ceiling that a long name could push past would be a
 * ceiling that means something slightly different per speaker.
 */
function said(row: ThreadRow, turnChars: number): Said | null {
  if (row.role === "tool") return null;
  const text = row.content.trim();
  if (text === "") return null;
  return {
    role: row.role,
    author: row.author !== null && row.author !== "" ? row.author : null,
    text: text.length > turnChars ? text.slice(0, turnChars) + CLIP_MARK : text,
  };
}

export function conversationHistory(
  rows: readonly ThreadRow[],
  limits: HistoryLimits = HISTORY_LIMITS,
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const row of rows) {
    const turn = said(row, limits.turnChars);
    if (turn === null) continue;
    /* the SPEAKER, when it is not the one being asked. A human turn keeps no
       prefix: the model is talking to them, and "user: …" in front of every
       question is noise the role already carries. */
    turns.push({
      role: turn.role,
      text: turn.role === "assistant" && turn.author !== null
        ? `${turn.author}: ${turn.text}`
        : turn.text,
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

/* ── ACROSS CONVERSATIONS ───────────────────────────────────────────────── */

/**
 * THE MEMORY IS THE SESSION'S, NOT THE THREAD'S (user directive, 2026-09-08:
 * "make the memory per session not per thread").
 *
 * Everything above carries ONE conversation, which is what the same person
 * asked for the day before and is not enough: they press «گفت‌وگوی جدید», ask
 * the obvious follow-up, and the assistant has never heard of them. A thread
 * is a filing decision, and nobody re-files their own morning before asking a
 * second question about it.
 *
 * So a turn also carries the TAIL of the person's other recent conversations
 * — their own, and only their own: `agent_session_own` scopes every row here
 * to `actor_id = echo.actor_id()`, so this reads nothing the caller could not
 * already open in their own sidebar. No widening, no migration, no new door.
 *
 * ── WHY IT IS A BLOCK AND NOT MORE TURNS ──────────────────────────────────
 *
 * The obvious implementation is to put these in front of the thread's own
 * turns in `context.messages`, and it is wrong: they would then be
 * indistinguishable from this conversation, and "as I said above" would point
 * at a screen the person is not looking at. This is the room's shape instead
 * (`ROOM_HISTORY`, 2026-09-05): a labelled block in the system prompt, framed
 * as a record of what was said elsewhere. The words are verbatim — nothing
 * here summarises, and a memory that paraphrases is a second author.
 *
 * ── WHAT IS DELIBERATELY LEFT OUT ─────────────────────────────────────────
 *
 * · This conversation. It is carried in full, above; carried twice it would
 *   be one conversation the model reads as two.
 * · ARCHIVED conversations. Archiving is the person saying "done with this",
 *   and `resolveForAsk` already refuses to resume one. A thread that cannot
 *   be reopened should not go on answering through the back door.
 * · Anything older than the window the caller passes. "Per session" is a
 *   claim about a working stretch, and a fortnight-old conversation
 *   presented as recent context is a lie in the one place the model cannot
 *   check it.
 */

/** An earlier conversation of the same person, and how it ended. */
export interface PriorConversation {
  /** its own title — the person's own words, from their sidebar */
  title: string;
  /** its LAST turns, oldest first */
  rows: readonly ThreadRow[];
}

export interface CarryLimits {
  /**
   * HOW FAR BACK A SESSION REACHES, in hours.
   *
   * Read by the caller rather than by the renderer below, and living here
   * anyway because it is the same dial: the four numbers together are the
   * answer to "how much of the session is carried", and split across two
   * files they would be tuned separately by somebody reading one of them.
   */
  windowHours: number;
  /** how many earlier conversations at most — the most recent ones */
  conversations: number;
  /** the tail of each: how many turns of it are carried */
  turnsEach: number;
  /** the whole block's ceiling */
  maxChars: number;
  /** one carried turn */
  turnChars: number;
}

/**
 * Smaller than the thread's, on purpose and in both directions.
 *
 * This is BACKGROUND: what matters is that a thing was said and roughly what
 * it was, not the exact wording of a nine-paragraph answer from an hour ago —
 * so a carried turn is clipped at 600 rather than 4,000, and the block as a
 * whole is a quarter of the thread's budget. Three conversations, six turns
 * each, because breadth is the point (the thread already provides depth).
 *
 * The cost is real and is the price of the feature: ~3k characters on top of
 * the thread's ~12k, on every ask.
 */
export const CARRY_LIMITS: CarryLimits = {
  /*
   * TWELVE HOURS — a working day, and the honest reading of "session".
   *
   * The failure is asymmetric and both directions are real. Too short and
   * the person comes back after lunch, opens a new conversation and meets
   * the bug they reported. Too long and last Tuesday arrives as "recent
   * context", which is worse than forgetting: it is a confident claim about
   * now, made out of something stale, in the one place nobody can check it.
   * Twelve covers a day's work from either end of it and reaches no further.
   */
  windowHours: 12,
  conversations: 3,
  turnsEach: 6,
  maxChars: 3_000,
  turnChars: 600,
};

/** how a conversation announces itself inside the block */
const UNTITLED = "untitled";

/**
 * The carry-over block, chronological (most recent conversation last), or ""
 * when there is nothing to carry — which the caller renders as no line at
 * all rather than as an empty heading.
 */
export function carriedConversations(
  prior: readonly PriorConversation[],
  limits: CarryLimits = CARRY_LIMITS,
): string {
  const chunks: string[] = [];
  for (const convo of prior.slice(-limits.conversations)) {
    const lines: string[] = [];
    for (const row of convo.rows.slice(-limits.turnsEach)) {
      const turn = said(row, limits.turnChars);
      if (turn === null) continue;
      /* EVERY line names its speaker here, where the roles are gone: a flat
         transcript whose two sides are not marked is a wall of sentences the
         model has to guess the owner of — the room learned this one under
         «همکار» (2026-09-05). */
      const who = turn.role === "user" ? "user" : turn.author ?? "assistant";
      lines.push(`${who}: ${turn.text}`);
    }
    /* a conversation whose whole tail was tool rows and blanks is not a
       conversation to carry — an empty heading claims a talk nobody had */
    if (lines.length === 0) continue;
    chunks.push([`[conversation: ${convo.title.trim() || UNTITLED}]`, ...lines].join("\n"));
  }

  const size = (): number => chunks.reduce((n, chunk) => n + chunk.length + 2, -2);
  /* whole conversations, oldest first — the same rule the thread trims by,
     for the same reason: half a conversation is a fragment whose beginning
     is missing, and the newest is the one still being talked about */
  while (chunks.length > 1 && size() > limits.maxChars) chunks.shift();
  /* and if the last one alone is still over, its own oldest LINES go. Its
     heading never does: an unattributed tail is worse than a short one. */
  const only = chunks[0];
  if (chunks.length === 1 && only !== undefined && only.length > limits.maxChars) {
    const [heading, ...lines] = only.split("\n");
    while (lines.length > 1 && [heading, ...lines].join("\n").length > limits.maxChars) lines.shift();
    chunks[0] = [heading, ...lines].join("\n");
  }
  return chunks.join("\n\n");
}
