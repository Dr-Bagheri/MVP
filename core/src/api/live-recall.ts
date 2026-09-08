/**
 * Item 7 — the live meeting's quiet second brain.
 *
 * While a meeting is being held, the host's stage asks this every few seconds
 * with the last stretch of what has been said. If the room is talking about
 * something the organisation already DECIDED, a card says so — which meeting,
 * when, and whether it still stands.
 *
 * ── THE RULE, IN ONE SENTENCE ─────────────────────────────────────────────
 *
 * A decision surfaces when it shares at least TWO DISTINCTIVE WORDS with what
 * is being said right now.
 *
 * Everything below exists to make that sentence exact and to keep it quiet.
 * The alternative designs were both worse:
 *
 *   * `websearch_to_tsquery` over the window ANDs every word, so thirty
 *     seconds of speech matches nothing, ever. The feature would ship,
 *     never fire, and look like a taste decision.
 *   * A single-word OR fires on «که» and «را» — on this corpus that is every
 *     decision, every time, which is a card that means nothing and trains
 *     the host to stop reading them within one meeting.
 *
 * Two distinctive words is the smallest rule that can be wrong in a way
 * somebody would notice, which is what makes it worth having.
 *
 * ── WHY A HIGH BAR IS THE DESIGN, NOT A SETTING ───────────────────────────
 *
 * A wrong card in a live meeting is worse than no card: the host reads it
 * mid-sentence, it is about something else, and the next one is not read at
 * all. Silence is the correct default and recall has to earn the interruption
 * every time. That is why nothing here degrades toward "show something".
 */
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

/**
 * The words that carry no topic.
 *
 * Written out rather than derived, and the reason is that `simple` is the
 * only text-search configuration this database has for Persian: it has no
 * stemmer and NO STOP LIST, so every function word is a lexeme with the same
 * standing as a project's name. Without this list the OR query below matches
 * every row in the ledger on «از» and the rank ordering becomes noise.
 *
 * Persian first (this is a Persian-first product and the default path is the
 * one that hides the bug), then the English a bilingual meeting mixes in.
 * A word that is genuinely a topic must never appear here — the cost of a
 * wrong entry is a decision that can never be recalled, which is silent.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  // Persian: pronouns, prepositions, conjunctions, auxiliaries, quantifiers
  "و", "در", "به", "از", "که", "را", "این", "آن", "با", "برای", "تا", "هم",
  "یا", "اما", "اگر", "چون", "پس", "هر", "همه", "هیچ", "بر", "بی", "نه",
  "من", "تو", "او", "ما", "شما", "آنها", "ایشان", "خود", "خودم", "خودت",
  "است", "هست", "بود", "باشد", "بودن", "شد", "شود", "شده", "میشود", "می",
  "کرد", "کند", "کردن", "کرده", "دارد", "داشت", "دارند", "دارم", "داریم",
  "باید", "نباید", "شاید", "بله", "خیر", "آره", "نه‌بابا", "خب", "خوب",
  "یک", "دو", "چند", "خیلی", "کمی", "بیشتر", "کمتر", "دیگر", "دیگه",
  "الان", "حالا", "بعد", "قبل", "وقتی", "چیزی", "کسی", "جا", "طور", "مورد",
  "یعنی", "مثل", "مثلا", "واقعا", "البته", "ولی", "چه", "چرا", "کجا", "کی",
  "آیا", "همین", "همان", "چیز", "کار", "بکنیم", "کنیم", "کنید", "بگیم",
  // English
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "because",
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "as", "that",
  "this", "these", "those", "it", "its", "we", "you", "they", "he", "she",
  "i", "me", "us", "them", "our", "your", "their", "is", "are", "was",
  "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "will", "would", "can", "could", "should", "may", "might", "must",
  "not", "no", "yes", "ok", "okay", "just", "very", "really", "about",
  "there", "here", "now", "then", "some", "any", "all", "more", "less",
  "what", "when", "where", "who", "why", "how", "one", "two", "thing",
]);

/** The shortest word that can carry a topic. Below this it is noise in both scripts. */
const MIN_TERM = 3;
/** How many distinctive words a decision must share before it is worth a card. */
export const MIN_SHARED_TERMS = 2;
/** How many of the window's terms to carry into the query. */
const MAX_TERMS = 24;

/**
 * The same fold the database applies, so the terms this file counts are the
 * lexemes the index holds. `echo.fa_fold` is the authority — this is its
 * TypeScript twin and exists only to split and filter; the actual matching is
 * done by Postgres against its own folded column, so a divergence here costs
 * recall rather than correctness.
 */
function fold(word: string): string {
  return word
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/ة/g, "ه")
    .replace(/[‌‎‏]/g, "")
    .replace(/[۰-۹]/g, (d) => String((d.codePointAt(0) ?? 0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String((d.codePointAt(0) ?? 0) - 0x0660))
    .toLowerCase();
}

/**
 * The distinctive words in a stretch of speech, most recent first.
 *
 * Exported and pure because it is the whole rule: given the same window it
 * must give the same terms, and every edge — a window of stop words, a window
 * of digits, one word repeated forty times — is reachable without a database.
 */
export function distinctiveTerms(window: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  /* newest first: a meeting moves on, and the words from four sentences ago
     are less about what is being discussed NOW than the last ten */
  const words = window.split(/[^\p{L}\p{N}‌]+/u).filter((w) => w !== "").reverse();
  for (const raw of words) {
    const term = fold(raw);
    if (term.length < MIN_TERM) continue;
    if (STOP_WORDS.has(term)) continue;
    /* a bare number is a quantity, not a topic — «سه» and «2026» say nothing
       about what the room is deciding */
    if (/^\d+$/.test(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

export interface RecalledDecision {
  id: string;
  kind: string;
  body: string;
  status: string;
  meeting_id: string;
  meeting_title: string | null;
  decided_at: string;
  owner_id: string | null;
  due_on: string | null;
  /** how many distinctive words it shared — the rule, returned so a reader can see it */
  shared: number;
}

interface RecallRow {
  id: string; kind: string; body: string; status: string;
  meeting_id: string; meeting_title: string | null; decided_at: Date;
  owner_id: string | null; due_on: Date | null; shared: number | string;
}

export function createLiveRecallRepo(db: Db) {
  /**
   * What the organisation already decided about what is being said now.
   *
   * `exclude` is the meeting in progress and is REQUIRED, not optional: the
   * decisions being made in this room are in the ledger within seconds of
   * being extracted, so without it the feature's first and loudest hit is the
   * meeting recalling itself — which is not a second brain, it is an echo.
   */
  async function recall(
    identity: Identity,
    input: { window: string; exclude: string; limit?: number | undefined },
  ): Promise<RecalledDecision[]> {
    const exclude = assertUuid(input.exclude, "meeting id");
    const terms = distinctiveTerms(input.window ?? "");
    /* fewer than the rule needs is not "search harder", it is nothing to
       search FOR — a window of «خب پس بله» has no topic in it */
    if (terms.length < MIN_SHARED_TERMS) return [];
    const limit = Math.min(Math.max(input.limit ?? 3, 1), 10);

    const rows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<RecallRow>(
        /*
         * The OR query finds candidates; the COUNT is the rule.
         *
         * `to_tsquery` with `|` rather than `websearch_to_tsquery`, which
         * ANDs — thirty seconds of speech would then match nothing at all.
         * The terms are already folded and stripped of everything but letters
         * and digits by `distinctiveTerms`, so `plainto_tsquery` per term is
         * safe as well as simple: it cannot carry an operator.
         *
         * The count subquery is deliberately written per-term rather than as
         * a rank: `ts_rank` answers "how strongly", which is a number nobody
         * can argue with, and "two distinct words in common" is a sentence a
         * person can check against the card in front of them.
         */
        `with terms as (select unnest($2::text[]) as w),
              q as (select to_tsquery('simple',
                     string_agg(quote_literal(w) || ':*', ' | ')) as tsq from terms)
         select i.id, i.kind, i.body, i.status,
                i.meeting_id, m.title as meeting_title,
                /* at_ms is an OFFSET INTO THE RECORDING, not a moment:
                   coalesce(at_ms, created_at) would have compared milliseconds
                   with a timestamp. What a person means by «when was this
                   decided» is the MEETING own time, and the row own created_at
                   is the fallback for an item added later.
                   (No backticks in here: this is a template literal, and a
                   markdown quote around a column name CLOSES it — which is
                   what the first version of this comment did.) */
                coalesce(m.scheduled_at, i.created_at) as decided_at,
                i.owner_id, i.due_on,
                (select count(*) from terms t
                  where i.search @@ plainto_tsquery('simple', t.w)) as shared
           from echo.meeting_item i
           join echo.meeting m on m.id = i.meeting_id
          cross join q
          where i.meeting_id <> $1::uuid
            and i.kind in ('decision', 'action')
            and i.search @@ q.tsq
            and (select count(*) from terms t
                  where i.search @@ plainto_tsquery('simple', t.w)) >= $3
          order by shared desc, decided_at desc
          limit $4`,
        [exclude, terms, MIN_SHARED_TERMS, limit],
      ));

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      /* passed through as stored: the vocabulary can gain a value before
         this file does, and a card that renders an unknown status as itself
         is better than one that hides a decision because a word is new */
      status: row.status,
      meeting_id: row.meeting_id,
      meeting_title: row.meeting_title,
      decided_at: row.decided_at.toISOString(),
      owner_id: row.owner_id,
      due_on: row.due_on === null ? null : row.due_on.toISOString().slice(0, 10),
      shared: Number(row.shared),
    }));
  }

  return { recall };
}

export type LiveRecallRepo = ReturnType<typeof createLiveRecallRepo>;
