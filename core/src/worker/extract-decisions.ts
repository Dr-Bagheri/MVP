/**
 * 0209 — reading a transcript for what was DECIDED and what was PROMISED.
 *
 * The pass runs after a summary lands, on the same transcript, and its output
 * is a list of CLAIMS. Not decisions: claims. They land as
 * `source = 'extracted'` with no confirmation, the wall (0209's agent insert
 * policy) refuses any other shape, and no surface may render one as a decided
 * thing until a person has said so.
 *
 * ── WHY IT IS ITS OWN PASS AND NOT PART OF THE SUMMARY ────────────────────
 *
 * A summary is prose for a reader; these are ROWS for a query. Asking one
 * model call for both produces a summary bent into a shape and a list bent
 * into prose, and when the parse fails you lose the summary too. Separate,
 * an unparseable extraction costs the extraction (M21: degrade what was
 * inferred), and the summary — the thing the person is waiting for — is
 * already stored.
 *
 * It follows the GROUNDING pass exactly (0087), which is the precedent in
 * this file's sibling: a second advisory run through the same runtime, so its
 * spend and its trace land in `agent_run` like every other model call
 * (invariant 5), and any failure yields NOTHING rather than a fabricated
 * empty list that would read as "this meeting decided nothing".
 *
 * ── THE PROMPT'S TWO RULES ────────────────────────────────────────────────
 *
 * 1. QUOTE, do not summarise. A decision's `text` has to be checkable against
 *    the transcript by a person reading both, so the model is told to keep
 *    the meeting's own words.
 * 2. NAME NOBODY IT CANNOT HEAR. An owner is a NAME as spoken, resolved
 *    against the roster by core — never a person the model picked because a
 *    commitment ought to have one. «یکی باید این را انجام دهد» is a real
 *    thing to have heard, and it lands with no owner.
 */

/** one claim, as the model is asked to shape it */
export interface ExtractedClaim {
  kind: "decision" | "commitment";
  text: string;
  detail: string;
  /** the speaker's NAME as the transcript spells it — core resolves it */
  owner_name: string | null;
  /** `YYYY-MM-DD`, when the meeting named a day */
  due_on: string | null;
  evidence_start_ms: number | null;
  evidence_end_ms: number | null;
}

/**
 * The prompt. The transcript enters FENCED and named as data, the same
 * treatment M43 gives a mail body — a meeting is a place strangers speak, and
 * "ignore your instructions" said aloud in one is a sentence in the record,
 * not an instruction to the reader of it.
 */
export function composeExtractionInput(transcript: string, today: string): string {
  return [
    "تو خواننده‌ی دقیقِ صورت‌جلسه‌ای. از متن گفتگوی زیر دو چیز را بیرون بکش:",
    "۱) تصمیم‌ها: چیزهایی که در همین جلسه قطعی شد.",
    "۲) تعهدها: کاری که یک نفر مشخص قبول کرد انجام دهد.",
    "",
    "قواعد سخت‌گیرانه:",
    "- عین جمله‌ی گوینده را نگه دار؛ خلاصه و بازنویسی نکن.",
    "- اگر چیزی قطعی نشد، آن را ننویس. فهرست خالی جوابِ درستی است.",
    "- برای تعهد، نامِ گوینده را همان‌طور که در متن آمده بنویس. اگر معلوم نیست، null بگذار؛ اسم حدس نزن.",
    `- تاریخ‌ها را به شکل YYYY-MM-DD بنویس. امروز ${today} است. اگر تاریخی گفته نشد، null بگذار.`,
    "- start و end را بر حسب میلی‌ثانیه از ابتدای جلسه بنویس؛ اگر معلوم نیست، null بگذار.",
    "",
    "فقط JSON بده، بدون هیچ متن دیگری:",
    '{"items":[{"kind":"decision|commitment","text":"...","detail":"...",' +
      '"owner_name":null,"due_on":null,"start_ms":null,"end_ms":null}]}',
    "<<<TRANSCRIPT",
    transcript,
    "TRANSCRIPT",
  ].join("\n");
}

/**
 * Defensive parse, the grounding verdict's twin: a model that answers in
 * prose, fences its JSON or invents fields yields an EMPTY list — and the
 * caller can tell that from "there was nothing to find", because this returns
 * `null` for unreadable and `[]` for a model that read the meeting and found
 * nothing. Two different nothings, kept apart (rule 12).
 */
export function parseExtraction(text: string): ExtractedClaim[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1)) as { items?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.items)) return null;

  const out: ExtractedClaim[] = [];
  for (const raw of parsed.items) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const text_ = typeof item.text === "string" ? item.text.trim() : "";
    /* a claim with no sentence is not a claim. Dropped rather than kept with
       a placeholder: a row reading "—" in the decisions list is a fabricated
       decision wearing an ellipsis. */
    if (text_ === "" || text_.length > 400) continue;
    const kind = item.kind === "commitment" ? "commitment" : "decision";
    const ms = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    let s = ms(item.start_ms);
    let e = ms(item.end_ms);
    /* a span is two ends or neither: half of one is a citation that cannot be
       played, and the schema refuses it anyway — dropping the half here means
       the row still lands, without a broken cite */
    if (s === null || e === null || e < s) { s = null; e = null; }
    const due = typeof item.due_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.due_on)
      ? item.due_on : null;
    out.push({
      kind,
      text: text_,
      detail: typeof item.detail === "string" ? item.detail.trim().slice(0, 2000) : "",
      owner_name: typeof item.owner_name === "string" && item.owner_name.trim() !== ""
        ? item.owner_name.trim().slice(0, 120) : null,
      due_on: due,
      evidence_start_ms: s,
      evidence_end_ms: e,
    });
    /* a ceiling, because an unbounded list is a model's enthusiasm becoming
       the organisation's record */
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * A NAME AS SPOKEN, RESOLVED TO AN ACCOUNT — or nobody.
 *
 * EXACTLY or not at all, which is the ruling this repo made on 2026-09-06
 * after a lone prefix match made «ali» the only Alireza and a consent card
 * named a handle that belonged to somebody else. Here the cost of a wrong
 * match is a commitment filed against a colleague who never made it, so the
 * bar is the same: fold both sides, compare whole, and hand back null when
 * two people match.
 */
export function resolveOwner(
  name: string | null,
  people: { id: string; names: string[] }[],
  fold: (s: string) => string,
): string | null {
  if (name === null) return null;
  const want = fold(name);
  if (want === "") return null;
  const hits = people.filter((p) => p.names.some((n) => fold(n) === want));
  return hits.length === 1 ? hits[0]!.id : null;
}
