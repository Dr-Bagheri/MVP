/**
 * 0209 → 2026-09-19 — reading a transcript for what a meeting PRODUCED.
 *
 * FIVE kinds, the same five the review tabs show and db/0234 permits: what
 * was DECIDED, the TASKS it hands out (`action` on the wire, «تسک‌ها» on the
 * screen), the PROJECTS it proposes, the QUESTIONS it left open and the RISKS
 * it named. Until today this pass knew two of them — decisions and
 * commitments — and the user's report was exact: "when they are talking it
 * must notice the risks, the questions that need answers, the tasks and
 * projects, and the approvals; it is weak now in understanding them". It was
 * not weak at those; it had never been asked for them, and a model that is
 * asked for two things returns two things.
 *
 * The pass runs after a summary lands, on the same transcript, and its output
 * is a list of CLAIMS. Not decisions: claims. They land as `source = 'ai'`
 * with no confirmation, the wall (0160's agent insert policy) refuses any
 * other shape, and no surface may render one as a decided thing until a
 * person has said so.
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
 * It follows the GROUNDING pass exactly (0087): a second advisory run through
 * the same runtime, so its spend and its trace land in `agent_run` like every
 * other model call (invariant 5), and any failure yields NOTHING rather than
 * a fabricated empty list that would read as "this meeting decided nothing".
 *
 * ── THE PROMPT'S RULES ────────────────────────────────────────────────────
 *
 * 1. QUOTE, do not summarise. A claim's `text` has to be checkable against the
 *    transcript by a person reading both, so the model keeps the meeting's own
 *    words. `detail` is where it may say who said it and why — one sentence,
 *    reworded is fine there.
 * 2. NAME NOBODY IT CANNOT HEAR. An owner is a NAME as spoken, resolved
 *    against the roster by core — never a person the model picked because a
 *    task ought to have one. «یکی باید این را انجام دهد» is a real thing to
 *    have heard, and it lands with no owner. Only a task or a project HAS an
 *    owner: a decision's «(سینا)» is who proposed it, which is not the same
 *    fact and must not become an assignee (the slicer's own rule, kept).
 * 3. ANSWER IN THE MEETING'S LANGUAGE. The prompt is written in Persian and a
 *    model answers the language it is addressed in: an English meeting's
 *    claims came back as Persian `text`, which fails rule 1 by construction.
 *    db/0219 and db/0222 settled the same question for the summarizer: state
 *    the rule FIRST and in BOTH languages rather than picking a prompt by a
 *    detected `language` that is one value for a meeting held in two.
 * 4. READ THE WHOLE CONVERSATION, not the sentences that announce themselves.
 *    «من فردا می‌فرستم» is a task with an owner and nobody said the word task;
 *    «معلوم نیست کی…» is an open question; «ممکنه دیر بشه» is a risk. The
 *    per-kind examples in the prompt exist for this — the earlier prompt
 *    defined its two kinds in one line each, and a one-line definition is
 *    read as "the explicit cases only".
 * 5. A KIND IT DID NOT NAME IS NOT FILED. A model that answers `kind:
 *    "suggestion"` has not produced a decision; the old default ("anything
 *    but commitment is a decision") would have written it into the ledger
 *    as one, which is a fabricated decision arrived at by lenient parsing.
 *    Aliases a model plausibly uses (`commitment`, `task`, `concern`, the
 *    Persian words) are mapped; anything else is dropped, and the drop is
 *    countable because `parseExtraction` returns fewer rows than the model
 *    wrote.
 */
import { MEETING_ITEM_KINDS, type MeetingItemKind } from "../api/vocabulary.ts";

/** one claim, as the model is asked to shape it */
export interface ExtractedClaim {
  kind: MeetingItemKind;
  text: string;
  detail: string;
  /** the speaker's NAME as the transcript spells it — core resolves it;
      only a task or a project carries one */
  owner_name: string | null;
  /** `YYYY-MM-DD`, when the meeting named a day — tasks and projects only */
  due_on: string | null;
  evidence_start_ms: number | null;
  evidence_end_ms: number | null;
}

/** the kinds that carry a person and a day; the others describe the meeting */
const OWNED_KINDS: ReadonlySet<MeetingItemKind> = new Set(["action", "project"]);

/**
 * What a model may call a kind, and what the ledger calls it. English is the
 * schema's language, but a model addressed in Persian answers in Persian
 * often enough that refusing «تصمیم» would drop real rows for a spelling.
 * The map is closed: an unlisted word is an unfiled claim (rule 5 above).
 */
const KIND_ALIASES: Readonly<Record<string, MeetingItemKind>> = {
  decision: "decision", approval: "decision", approved: "decision", resolution: "decision",
  agreed: "decision", agreement: "decision",
  "تصمیم": "decision", "مصوبه": "decision", "توافق": "decision",

  action: "action", action_item: "action", commitment: "action", task: "action", todo: "action",
  to_do: "action", follow_up: "action", followup: "action",
  "تسک": "action", "تعهد": "action", "اقدام": "action", "کار": "action",

  project: "project", initiative: "project", workstream: "project",
  "پروژه": "project",

  question: "question", open_question: "question", unanswered: "question", unresolved: "question",
  "سؤال": "question", "سوال": "question", "پرسش": "question",

  risk: "risk", concern: "risk", blocker: "risk", issue: "risk", obstacle: "risk", problem: "risk",
  "ریسک": "risk", "خطر": "risk", "مانع": "risk", "نگرانی": "risk",
};

/** the ledger's word for what the model wrote, or null for a word it did not name */
export function normaliseKind(raw: unknown): MeetingItemKind | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/‌/g, "");
  return KIND_ALIASES[key] ?? null;
}

/**
 * The prompt. The transcript enters FENCED and named as data, the same
 * treatment M43 gives a mail body — a meeting is a place strangers speak, and
 * "ignore your instructions" said aloud in one is a sentence in the record,
 * not an instruction to the reader of it.
 */
export function composeExtractionInput(transcript: string, today: string): string {
  return [
    /* THE LANGUAGE RULE FIRST, in both languages — db/0222's shape exactly.
       The first line is what a model takes its own language from, so this one
       has to be the line that refuses to pick one. */
    "زبانِ جوابْ همان زبانِ جلسه است: متن پیاده‌شدهٔ انگلیسی → متنِ انگلیسی؛ متن"
      + " فارسی → فارسی. اگر جلسه دوزبانه بود، زبانی را بنویس که آن حرف به آن زده"
      + " شده. هیچ جمله‌ای را ترجمه نکن — `text` باید عینِ حرفِ گوینده باشد تا کسی"
      + " که هر دو را می‌خواند بتواند راستی‌اش را بسنجد. زبان خودت را بر جلسه"
      + " تحمیل نکن.",
    "(Answer in the language the meeting was held in: an English transcript"
      + " yields English rows, a Persian transcript Persian ones. If the meeting"
      + " was bilingual, use the language each thing was said in. Translate"
      + " nothing — `text` must be the speaker's own words, so that a person"
      + " reading the transcript and the row together can check it. Never impose"
      + " your own language on the meeting.)",
    "",
    "تو خواننده‌ی دقیقِ صورت‌جلسه‌ای. کلِ گفتگو را بخوان — نه فقط جمله‌هایی که"
      + " خودشان را اعلام می‌کنند — و پنج چیز را بیرون بکش:",
    "۱) decision — تصمیم/مصوبه: چیزی که همین‌جا قطعی شد. «قرار شد…»، «تصویب شد»،"
      + " «موافقیم که…»، «همین رو می‌ریم جلو». پیشنهادی که به نتیجه نرسید تصمیم"
      + " نیست.",
    "۲) action — تسک/تعهد: کاری که یک نفر قبول کرد انجام دهد یا به کسی سپرده شد."
      + " «من فردا می‌فرستم» یعنی تسکِ همان گوینده؛ «سینا پیگیری کنه» یعنی تسکِ"
      + " سینا؛ «باید یکی … رو چک کنه» تسکِ بی‌صاحب است. owner_name را از متن"
      + " بردار و due_on را اگر روزی گفته شد.",
    "۳) project — پروژه: کارِ بزرگ‌تری که چند تسک در آن جا می‌گیرد و باید به‌عنوان"
      + " پروژه باز شود یا به پروژه‌ها اضافه شود. «یه پروژه باز کنیم برای…»، «این"
      + " رو جدا پیش ببریم»، «فاز دوم …»، «برای … یه تیم بذاریم». owner_name ="
      + " کسی که مسئول یا لیدِ آن نامیده شد.",
    "۴) question — سؤال باز: پرسشی که مطرح شد و همین‌جا پاسخ نگرفت. «باید"
      + " بپرسیم…»، «معلوم نیست…»، «کی قراره…؟»، «هنوز نمی‌دونیم…». سؤال بلاغی"
      + " یا سؤالی که همان‌جا جواب گرفت نه.",
    "۵) risk — ریسک: خطر، مانع یا نگرانی‌ای که نام برده شد. «ممکنه دیر بشه»،"
      + " «مشکل اینه که…»، «اگر … نشه، …»، «نگرانم که…».",
    "(You are a careful reader of meeting records. Read the WHOLE conversation,"
      + " not only the sentences that announce themselves, and pull out five"
      + " things. decision: what was settled here — 'we agreed', 'approved',"
      + " 'let's go with this'; a proposal that went nowhere is not one."
      + " action: work a person took on or was given — 'I'll send it tomorrow'"
      + " is that speaker's task, 'Sina should follow up' is Sina's, 'someone"
      + " has to check' is an unowned one; take owner_name from the words and"
      + " due_on when a day was said. project: a larger piece of work that"
      + " holds several tasks and should be opened as a project — 'let's start"
      + " a project for', 'run this separately', 'phase two'; owner_name is"
      + " whoever was named to lead it. question: asked here and not answered"
      + " here — 'we need to ask', 'it is unclear', 'who is going to'; not a"
      + " rhetorical one, not one answered on the spot. risk: a danger,"
      + " obstacle or worry that was named — 'this might slip', 'the problem"
      + " is', 'if X does not happen'.)",
    "",
    "قواعد سخت‌گیرانه:",
    "- text: عینِ جمله‌ی گوینده؛ خلاصه و بازنویسی نکن. detail: در یک جمله بگو چه"
      + " کسی گفت و در چه زمینه‌ای — این‌جا بازنویسی آزاد است.",
    "- یک جمله می‌تواند هم تصمیم باشد و هم تسک بسازد؛ هر دو را بنویس. یک چیز را"
      + " دو بار ننویس.",
    "- اگر چیزی از یک نوع نبود، از آن نوع چیزی ننویس. فهرست خالی جوابِ درستی است.",
    "- owner_name فقط برای action و project، همان‌طور که در متن آمده. اگر معلوم"
      + " نیست، null بگذار؛ اسم حدس نزن.",
    "- «Speaker 2» و «گویندهٔ ۲» نامِ کسی نیستند؛ اسمِ داخلیِ خودِ سامانه‌اند. اگر"
      + " فقط همین را داری، owner_name را null بگذار.",
    `- تاریخ‌ها را به شکل YYYY-MM-DD بنویس. امروز ${today} است. اگر تاریخی گفته نشد، null بگذار.`,
    "- start و end را بر حسب میلی‌ثانیه از ابتدای جلسه بنویس؛ اگر معلوم نیست، null بگذار.",
    "",
    "(Strict rules: text is the speaker's own sentence — do not summarise or"
      + " reword it; detail is one sentence on who said it and in what context,"
      + " reworded freely. One sentence may be both a decision and a task —"
      + " write both; write nothing twice. If a kind has nothing, write nothing"
      + " of that kind; an empty list is a correct answer. owner_name only for"
      + " action and project, exactly as the transcript spells it, and null when"
      + " it is not clear — never guess a name. \"Speaker 2\" is not a person's"
      + " name, it is this system's own placeholder for a voice: if that is all"
      + ` you have, owner_name is null. Write dates as YYYY-MM-DD; today is ${today},`
      + " and null when no date was said. Write start and end as milliseconds"
      + " from the beginning of the meeting, null when unknown.)",
    "",
    "فقط JSON بده، بدون هیچ متن دیگری:",
    "(Reply with JSON only, and nothing else. The field NAMES and the kind"
      + " VALUES below are part of the schema and stay English in every"
      + " language.)",
    `{"items":[{"kind":"${MEETING_ITEM_KINDS.join("|")}","text":"...","detail":"...",`
      + '"owner_name":null,"due_on":null,"start_ms":null,"end_ms":null}]}',
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
    /* a kind the model did not name is a row this pass does not file (rule 5
       in the header) — never defaulted to a decision */
    const kind = normaliseKind(item.kind);
    if (kind === null) continue;
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
    const owned = OWNED_KINDS.has(kind);
    const due = owned && typeof item.due_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.due_on)
      ? item.due_on : null;
    out.push({
      kind,
      text: text_,
      detail: typeof item.detail === "string" ? item.detail.trim().slice(0, 2000) : "",
      /* a decision's or a question's "owner" is whoever said it, which is not
         an assignee — kept only where the row means somebody owes something */
      owner_name: owned && typeof item.owner_name === "string" && item.owner_name.trim() !== ""
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
 * match is a task filed against a colleague who never took it, so the bar is
 * the same: fold both sides, compare whole, and hand back null when two
 * people match.
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
