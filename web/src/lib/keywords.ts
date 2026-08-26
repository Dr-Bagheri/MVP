/**
 * Live keywords (user directive, 2026-08-26: the recorder's Keywords tab,
 * "all coming out of the record"): the most frequent meaningful words of
 * the transcript SO FAR. Purely derived — a frequency count over the text
 * with function words removed, never a model's guess — so the tab can run
 * live, offline, and honestly: what it shows is exactly what was said,
 * counted.
 *
 * ZWNJ is word-internal in Persian («می‌رود» is ONE word) — the splitter
 * must never break on it.
 */

const STOP_FA = new Set([
  "و", "در", "به", "از", "که", "این", "آن", "با", "را", "برای", "تا", "هم",
  "یا", "اگر", "ما", "من", "شما", "او", "است", "هست", "نیست", "بود", "شد",
  "می", "خیلی", "یک", "یه", "رو", "بر", "اون", "چه", "چی", "کنیم", "کنید",
  "کنم", "کرد", "کردیم", "بشه", "باشه", "خب", "خوب", "الان", "بعد", "قبل",
  "دیگه", "دیگر", "هر", "همه", "باید", "نباید", "ولی", "اما", "پس", "چون",
  "حالا", "اینکه", "داریم", "دارم", "داره", "دارید", "نه", "بله", "آره",
  "بی", "بدون", "روی", "زیر", "بین", "مثل", "چند", "کجا", "کی", "چرا",
]);
const STOP_EN = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
  "for", "with", "is", "are", "was", "were", "be", "been", "being", "it",
  "its", "this", "that", "these", "those", "we", "you", "i", "he", "she",
  "they", "them", "us", "our", "your", "my", "so", "just", "like", "yeah",
  "ok", "okay", "well", "now", "then", "there", "here", "have", "has",
  "had", "do", "does", "did", "not", "no", "yes", "can", "could", "will",
  "would", "should", "about", "from", "as", "by", "what", "which", "who",
  "when", "where", "how", "all", "also", "up", "out", "get", "got", "go",
  "going", "let", "lets", "some", "any", "more", "very", "really",
]);

export interface Keyword {
  word: string;
  count: number;
}

export function extractKeywords(text: string, max = 12): Keyword[] {
  const counts = new Map<string, number>();
  // split on whitespace and punctuation — NOT on ZWNJ (‌)
  for (const raw of text.split(/[\s.,!?؟،؛:;()«»[\]"'`~*_—–\-…/\\]+/u)) {
    const word = raw.trim();
    if (word.length < 2) continue;
    if (/^\d+$/u.test(word)) continue;
    const lower = word.toLowerCase();
    if (STOP_FA.has(word) || STOP_EN.has(lower)) continue;
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, max);
}
