/**
 * THE MINUTES, WRITTEN OUT — the account of a meeting in the language a
 * صورت‌جلسه is written in, cut to the space the organisation's letterhead
 * leaves for it.
 *
 * User directive, 2026-09-17: "all the information in summarization must be
 * fit inside it — use the agent to do it as well."
 *
 * WHY A MODEL IS THE RIGHT TOOL FOR EXACTLY THIS AND NOTHING ELSE. Everything
 * around this paragraph is already structured and already true: who was
 * there, what was decided, who owes what by when. Those are rows; rewriting
 * them with a model would put a second, differently-worded copy of the
 * ledger into the document people sign. What is NOT structured is the
 * account of the discussion — and that is the only part whose LENGTH can be
 * made to fit a page, because it is the only part written in sentences.
 *
 * So this pass reads the summary the pipeline already produced and re-tells
 * it: formal register, no new facts, and at most the words the clear area
 * holds. The caller keeps the original — a composed text that goes wrong is
 * a draft somebody discards, never a summary version that overwrote one.
 */
import type { Identity } from "../agent/types.ts";
import type { createAgentRuntime } from "../agent/runtime.ts";

/**
 * HOW MANY WORDS FIT.
 *
 * An A4 page is 297mm tall. What the letterhead leaves is `297 - top -
 * bottom`, minus the room this document's own furniture takes: the identity
 * table, the roster, the agenda, the decisions and the action table. At 11pt
 * on 1.9 line-height a line is ~5.5mm and holds ~12 Persian words.
 *
 * The number is deliberately a FLOOR-ed estimate rather than a measurement:
 * nothing here can measure a rendered page, and a budget that promises
 * precision it does not have would fail silently on the first long meeting.
 * What it must do is scale with the clear area — a sheet with a 70mm header
 * gets a shorter account than one with a 30mm header — and never fall so low
 * that the answer is a sentence.
 */
export function wordBudget(topMm: number, bottomMm: number, furnitureMm = 120): number {
  const clear = 297 - topMm - bottomMm - furnitureMm;
  const lines = Math.floor(clear / 5.5);
  return Math.max(60, Math.min(600, lines * 12));
}

export function composeMinutesInput(args: {
  title: string;
  dateLabel: string;
  attendees: string[];
  summary: string;
  decisions: string[];
  actions: string[];
  words: number;
}): string {
  const list = (items: string[]) => (items.length === 0 ? "—" : items.map((x) => `- ${x}`).join("\n"));
  return [
    /* THE LANGUAGE RULE FIRST, and in both languages, for the reason
       db/0222 and the extraction pass both give: the first line is where a
       model takes its own language from, so it has to be the line that
       refuses to choose one. */
    "زبانِ جواب همان زبانِ مطالبِ زیر است: خلاصهٔ فارسی → متنِ فارسی، خلاصهٔ"
      + " انگلیسی → متنِ انگلیسی. هیچ‌چیز را ترجمه نکن.",
    "(Answer in the language of the material below. Translate nothing.)",
    "",
    "متنِ «خلاصهٔ مذاکرات» یک صورت‌جلسهٔ رسمی را بنویس — همان‌طور که در"
      + " شرکت‌ها و سازمان‌ها نوشته می‌شود: نثرِ رسمی و سوم‌شخص، بدون خطاب مستقیم،"
      + " بدون تیتر و بدون فهرست.",
    "(Write the «proceedings» paragraph of a formal meeting record: formal,"
      + " third person, no headings, no bullet lists.)",
    "",
    "قواعد سخت‌گیرانه:",
    "- فقط از مطالبِ زیر بنویس. هیچ عدد، تاریخ، نام یا تصمیمی اضافه نکن.",
    "- مصوبات و اقدامات در بخش‌های خودشان می‌آیند؛ اینجا آن‌ها را تکرار نکن.",
    `- حداکثر ${words(args.words)} کلمه. کوتاه‌تر اشکالی ندارد.`,
    "- جواب فقط همان متن است: بدون عنوان، بدون علامت نقل‌قول، بدون توضیح.",
    "",
    `عنوان جلسه: ${args.title}`,
    `تاریخ: ${args.dateLabel}`,
    `حاضران: ${args.attendees.length === 0 ? "—" : args.attendees.join("، ")}`,
    "",
    "خلاصهٔ موجود:",
    args.summary.trim() === "" ? "—" : args.summary.trim(),
    "",
    "مصوبات (برای زمینه، تکرارشان نکن):",
    list(args.decisions),
    "",
    "اقدامات (برای زمینه، تکرارشان نکن):",
    list(args.actions),
  ].join("\n");
}

/* the budget spelled for the prompt in ASCII digits: the model is being told
   a number, not shown one — the DOCUMENT's digits follow the reader's
   language, and that happens where the document is written */
function words(n: number): string {
  return String(n);
}

/**
 * The composed paragraph, or null.
 *
 * NULL IS A REAL ANSWER and the caller renders it as one: a provider that
 * refused, or a model that answered with nothing usable, is not a meeting
 * with nothing to say. The rest of the document is unaffected either way —
 * this pass adds a better paragraph or it adds nothing.
 */
export async function composeMinutes(args: {
  runtime: ReturnType<typeof createAgentRuntime>;
  identity: Identity;
  callId: string | null;
  input: string;
  callerModel?: string | undefined;
  apiKey?: string | undefined;
  deps: unknown;
}): Promise<{ body: string | null }> {
  const run = await args.runtime.run({
    identity: args.identity,
    kind: "summarizer",
    skill: undefined,
    callerModel: args.callerModel,
    apiKey: args.apiKey,
    ...(args.callId === null ? {} : { callId: args.callId }),
    /* NO TOOLS. What this pass produces is addressed to people outside the
       room — the blast-radius rule (M44) — and it is being asked to re-tell
       material it was handed, not to go and find more. */
    tools: [],
    deps: args.deps,
    input: args.input,
  });
  if (run.failed) return { body: null };
  const body = run.text.trim();
  if (body === "") return { body: null };
  /* a model that answered with a JSON object has not answered this question;
     writing that into a document would put braces in front of a reader */
  if (body.startsWith("{") || body.startsWith("[")) return { body: null };
  return { body };
}
