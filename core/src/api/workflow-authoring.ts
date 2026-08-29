/**
 * M41 P5 — AUTHORING: an admin builds and publishes a workflow without
 * touching SQL. Thin like every repo: the walls already decide who may
 * (admin insert policies, W18's missing UPDATE grant on versions), and
 * the VALIDATOR already decides what a graph may say — this file is
 * shape, sequencing, and honest refusals.
 *
 * Publish = INSERT a new version and repoint. Rollback = repoint at any
 * prior version of the same workflow (W32) — one pointer move, cheap
 * precisely because versions are immutable. Pause = enabled false; new
 * runs stop, in-flight runs finish on their pinned version.
 */
import { randomBytes } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { iso, WORKFLOW_EVENTS, AUTO_APPLY_ELIGIBLE } from "./vocabulary.ts";
import {
  validateWorkflowBudget,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "./workflow-graph.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * THE SHIPPED STARTERS - installable per org with one press, so the engine
 * is never an empty shelf. Each graph is validated by the SAME publish
 * path an authored one takes (and pinned in the validator's corpus, so a
 * grammar change that breaks a starter breaks the suite, not the press).
 *
 *  followups - manual: reads the member's recent meetings, extracts the
 *    topics, writes one line per topic, cards the result. No writes, so
 *    it runs for any org untouched.
 *  autotag - the flagship (design doc s10): after every summarized
 *    meeting, extract topics from the transcript and PROPOSE them as tags
 *    - the human approves on the run page; the write lands on the agent
 *    role.
 *
 * [REVISED 2026-08-28, user directive] every starter ships max_autonomy
 * "assist": watch and act left the product (see PINNED_AUTONOMY in
 * db/capabilities.ts). Existing published versions may still CARRY act or
 * watch on their rows — the wire field stays — but nothing resolves above
 * assist any more, so every write waits for its human everywhere.
 *
 * [EXTENDED 2026-08-28, user directive: "for each of these agents make 7
 * different workflow to choose from"] each platform agent (db/0124:
 * meetings / mail / prep) offers SEVEN starters — `AGENT_STARTERS` below
 * is that menu. Every addition obeys the same law as the first three:
 * published through the validated path, pinned in the validator's corpus
 * (test/workflow-graph.test.ts iterates this whole object), and mirrored
 * for display in web/src/lib/workflowName.ts. Two runtime facts shaped
 * these graphs, and they are worth restating because the validator cannot
 * see them: `search scope:"transcript"` executes only against
 * {{trigger.call_id}} (worker/workflow-step.ts), so transcript-reading
 * starters are call-triggered; and binding a SINGLE envelope field
 * ({{s1.title}}) fails the run when the provider left it empty, so event
 * context is bound as the WHOLE envelope ({{s1}}), which tolerates absent
 * fields and fences as content. `notify.card` values come from the
 * agent_card CHECK (db/0117): workflow_result, or mail_draft where a
 * draft was actually written — an invented card kind would publish and
 * then 23514 at 3 a.m., which is the exact failure this registry must
 * never ship.
 */
export const STARTER_WORKFLOWS = {
  /*
   * ── the two recording starters (user directive, 2026-08-29) ───────────
   *
   * They fire AFTER a take, not before it, and that is a constraint rather
   * than a preference: a workflow step runs in the WORKER, which has no
   * microphone and no browser. Starting a recording needs a person's own
   * surface, which is why `start_recording` is a CLIENT tool — the agent
   * asks the screen to do it, and the screen is the thing holding the mic.
   *
   * So "record" is not a step kind here. A kind the executor could never
   * run would be a producer with no consumer wearing a feature's name, and
   * a scheduled workflow reaching one at 3 a.m. would fail every night.
   * Asking an agent to start a recording works today, through the tool.
   */
  record_recap: {
    handle: "wf-starter-record-recap",
    name: "جمع‌بندی پس از ضبط",
    description: "تا ضبط تمام شود، از روی رونوشت یک جمع‌بندی کوتاه می‌نویسد: موضوع، تصمیم‌ها و آنچه باز مانده.",
    trigger_event: "call.transcribed" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask",
          instruction: "از این رونوشت یک جمع‌بندی کوتاه بنویس: موضوع گفت‌وگو، تصمیم‌هایی که گرفته شد، و آنچه بی‌پاسخ ماند. هر ادعا را به همین گفت‌وگو مستند کن و چیزی به آن اضافه نکن." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  record_commitments: {
    handle: "wf-starter-record-commitments",
    name: "قول‌های این ضبط",
    description: "پس از هر ضبط، قول‌ها را با نام گوینده درمی‌آورد تا معلوم باشد چه کسی چه چیزی را بر عهده گرفته.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
          instruction: "هر جایی که کسی چیزی را بر عهده گرفته، آن را به‌صورت یک عبارت کوتاه دربیاور. اگر کسی چیزی را بر عهده نگرفته، فهرست را خالی بگذار." },
        { id: "s3", kind: "decide", on: "s2.topics.length", gt: 0, then: "s4", else: "s6" },
        { id: "s4", kind: "foreach", over: "{{s2.topics}}", max: 5, do: "s5" },
        { id: "s5", kind: "ask",
          instruction: "برای «{{s4.item}}» بنویس چه کسی آن را گفته و تا چه زمانی — فقط از روی همین گفت‌وگو." },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  record_decisions: {
    handle: "wf-starter-record-decisions",
    name: "تصمیم‌های این ضبط",
    description: "هر تصمیمی که در این ضبط گرفته شد، با جملهٔ خودِ گوینده.",
    trigger_event: "call.transcribed" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask",
          instruction: "فقط تصمیم‌ها را فهرست کن: چه چیزی قطعی شد و چه کسی آن را گفت. برای هر تصمیم جملهٔ خودِ گفت‌وگو را نقل کن. اگر تصمیمی گرفته نشده، همین را بنویس و چیزی نساز." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  record_open: {
    handle: "wf-starter-record-open",
    name: "آنچه باز ماند",
    description: "پرسش‌ها و موضوع‌هایی که در این ضبط بی‌پاسخ ماندند.",
    trigger_event: "call.transcribed" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask",
          instruction: "پرسش‌ها و موضوع‌هایی را فهرست کن که مطرح شدند و پاسخی نگرفتند. برای هر کدام بنویس چه کسی آن را پرسید. چیزی را که پاسخ گرفته باز نشمار." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  record_speakers: {
    handle: "wf-starter-record-speakers",
    name: "چه کسی چه گفت",
    description: "به‌ازای هر گوینده، خلاصه‌ای از سهم او در این گفت‌وگو.",
    trigger_event: "call.transcribed" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask",
          instruction: "برای هر گوینده یک بند کوتاه بنویس: او دربارهٔ چه چیزی حرف زد و چه موضعی داشت. اگر نام گوینده معلوم نیست، همان برچسب رونوشت را بیاور و حدس نزن." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  record_quotes: {
    handle: "wf-starter-record-quotes",
    name: "جمله‌های کلیدی",
    description: "چند جملهٔ مهم این ضبط، دقیقاً همان‌طور که گفته شد.",
    trigger_event: "call.transcribed" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask",
          instruction: "حداکثر پنج جملهٔ کلیدی را عیناً نقل کن و برای هرکدام بنویس چه کسی آن را گفت و چرا مهم است. جمله را بازنویسی نکن." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  record_next: {
    handle: "wf-starter-record-next",
    name: "قدم بعدی پس از این ضبط",
    description: "پس از این گفت‌وگو چه چیزی باید انجام شود و به دست چه کسی.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask",
          instruction: "بنویس پس از این گفت‌وگو چه کارهایی باید انجام شود، هرکدام با نام صاحب کار اگر در گفت‌وگو معلوم شده. کاری را که کسی نگفته اضافه نکن." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  record_timeline: {
    handle: "wf-starter-record-timeline",
    name: "خط زمانی گفت‌وگو",
    description: "این ضبط از کجا شروع شد و به کجا رسید — به ترتیب.",
    trigger_event: "call.transcribed" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask",
          instruction: "مسیر گفت‌وگو را به ترتیب بنویس: از چه موضوعی شروع شد، کجا چرخید و به کجا ختم شد. ترتیب را از خود رونوشت بگیر." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  commit_by_person: {
    handle: "wf-starter-commit-by-person",
    name: "قول‌ها به تفکیک افراد",
    description: "از جلسه‌های اخیر، هر شخص چه چیزهایی را بر عهده گرفته.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 5 },
        { id: "s2", kind: "ask",
          instruction: "از این جلسه‌ها قول‌ها را به تفکیک شخص گروه‌بندی کن: زیر نام هر نفر، چیزهایی که بر عهده گرفته. هر مورد را به جلسه‌ای که در آن گفته شده نسبت بده." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  commit_overdue: {
    handle: "wf-starter-commit-overdue",
    name: "قول‌های از موعد گذشته",
    description: "قول‌هایی که زمانشان گفته شده بود و آن زمان گذشته است.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 5 },
        { id: "s2", kind: "ask",
          instruction: "فقط قول‌هایی را بیاور که در گفت‌وگو زمانی برایشان گفته شده و آن زمان گذشته است. اگر زمانی گفته نشده، آن مورد را در این فهرست نیاور." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  commit_unowned: {
    handle: "wf-starter-commit-unowned",
    name: "کارهای بی‌صاحب",
    description: "چیزهایی که قرار شد انجام شود ولی کسی آن را بر عهده نگرفت.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 5 },
        { id: "s2", kind: "ask",
          instruction: "کارهایی را فهرست کن که در گفت‌وگو لازم دانسته شدند ولی هیچ‌کس آن‌ها را بر عهده نگرفت. برای هرکدام بنویس کجا مطرح شد." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  commit_recent: {
    handle: "wf-starter-commit-recent",
    name: "قول‌های تازه",
    description: "قول‌هایی که در جلسه‌های اخیر داده شده‌اند.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 3 },
        { id: "s2", kind: "ask",
          instruction: "قول‌های داده‌شده در این جلسه‌ها را به ترتیب تازگی فهرست کن: چه کسی، چه چیزی، در کدام جلسه." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  commit_followup: {
    handle: "wf-starter-commit-followup",
    name: "یادآوری قول‌ها",
    description: "برای هر قول باز، یک خط یادآوری که خودتان بفرستید.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 5 },
        { id: "s2", kind: "ask",
          instruction: "برای هر قولی که هنوز باز است یک خط کوتاه و مؤدبانه بنویس که بشود همان‌طور برای طرف فرستاد. چیزی را که کسی نگفته یادآوری نکن." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  commit_history: {
    handle: "wf-starter-commit-history",
    name: "سابقهٔ یک موضوع",
    description: "یک موضوع در جلسه‌های پیاپی چه مسیری را طی کرده.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 8 },
        { id: "s2", kind: "ask",
          instruction: "دنبال کن که موضوع‌های تکرارشونده در این جلسه‌ها چه مسیری داشته‌اند: کجا مطرح شد، چه قولی داده شد و آیا در جلسهٔ بعد به آن برگشتند." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  followups: {
    handle: "wf-starter-followups",
    name: "\u067e\u06cc\u06af\u06cc\u0631\u06cc \u062c\u0644\u0633\u0647\u200c\u0647\u0627",
    description: "\u0627\u0632 \u062c\u0644\u0633\u0647\u200c\u0647\u0627\u06cc \u0627\u062e\u06cc\u0631 \u0645\u0648\u0636\u0648\u0639\u200c\u0647\u0627 \u0631\u0627 \u062f\u0631\u0645\u06cc\u200c\u0622\u0648\u0631\u062f \u0648 \u0628\u0631\u0627\u06cc \u0647\u0631 \u06a9\u062f\u0627\u0645 \u06cc\u06a9 \u062e\u0637 \u067e\u06cc\u06af\u06cc\u0631\u06cc \u0645\u06cc\u200c\u0646\u0648\u06cc\u0633\u062f.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 5 },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
          instruction: "\u0627\u0632 \u0639\u0646\u0648\u0627\u0646 \u062c\u0644\u0633\u0647\u200c\u0647\u0627 \u0645\u0648\u0636\u0648\u0639\u200c\u0647\u0627\u06cc \u0627\u0635\u0644\u06cc \u0631\u0627 \u0627\u0633\u062a\u062e\u0631\u0627\u062c \u06a9\u0646." },
        { id: "s3", kind: "decide", on: "s2.topics.length", gt: 0, then: "s4", else: "s6" },
        { id: "s4", kind: "foreach", over: "{{s2.topics}}", max: 3, do: "s5" },
        { id: "s5", kind: "ask",
          instruction: "\u062f\u0631\u0628\u0627\u0631\u0647\u0654 \u00ab{{s4.item}}\u00bb \u06cc\u06a9 \u062c\u0645\u0644\u0647\u0654 \u067e\u06cc\u06af\u06cc\u0631\u06cc \u0628\u0646\u0648\u06cc\u0633." },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  autotag: {
    handle: "wf-starter-autotag",
    name: "\u0628\u0631\u0686\u0633\u0628\u200c\u06af\u0630\u0627\u0631\u06cc \u062e\u0648\u062f\u06a9\u0627\u0631 \u062c\u0644\u0633\u0647",
    description: "\u067e\u0633 \u0627\u0632 \u0647\u0631 \u062c\u0644\u0633\u0647 \u0645\u0648\u0636\u0648\u0639\u200c\u0647\u0627 \u0627\u0632 \u0631\u0648\u0646\u0648\u0634\u062a \u062f\u0631\u0645\u06cc\u200c\u0622\u06cc\u062f \u0648 \u0628\u0647\u200c\u0639\u0646\u0648\u0627\u0646 \u0628\u0631\u0686\u0633\u0628 \u067e\u06cc\u0634\u0646\u0647\u0627\u062f \u0645\u06cc\u200c\u0634\u0648\u062f - \u0628\u0627 \u062a\u0623\u06cc\u06cc\u062f \u0634\u0645\u0627 \u062b\u0628\u062a \u0645\u06cc\u200c\u0634\u0648\u062f.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
          instruction: "\u0627\u0632 \u0627\u06cc\u0646 \u0631\u0648\u0646\u0648\u0634\u062a \u062d\u062f\u0627\u06a9\u062b\u0631 \u067e\u0646\u062c \u0645\u0648\u0636\u0648\u0639 \u06a9\u0648\u062a\u0627\u0647 \u062f\u0631\u0628\u06cc\u0627\u0648\u0631." },
        { id: "s3", kind: "propose", proposal: "add_tags",
          from: "{{s2.topics}}", call: "{{trigger.call_id}}" },
        { id: "s4", kind: "wait", on: "decision" },
        { id: "s5", kind: "apply", from: "s3" },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mail_reply: {
    handle: "wf-starter-mail-reply",
    name: "\u067e\u06cc\u0634\u200c\u0646\u0648\u06cc\u0633 \u067e\u0627\u0633\u062e \u0627\u06cc\u0645\u06cc\u0644",
    description: "\u0647\u0631 \u0627\u06cc\u0645\u06cc\u0644 \u062a\u0627\u0632\u0647\u200c\u0627\u06cc \u06a9\u0647 \u0645\u06cc\u200c\u0631\u0633\u062f \u062e\u0648\u0627\u0646\u062f\u0647 \u0645\u06cc\u200c\u0634\u0648\u062f \u0648 \u0627\u06af\u0631 \u067e\u0627\u0633\u062e \u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u062f\u060c \u067e\u06cc\u0634\u200c\u0646\u0648\u06cc\u0633\u06cc \u0646\u0648\u0634\u062a\u0647 \u0645\u06cc\u200c\u0634\u0648\u062f \u06a9\u0647 \u062e\u0648\u062f\u062a\u0627\u0646 \u0628\u0627\u0632\u0628\u06cc\u0646\u06cc \u0648 \u0627\u0631\u0633\u0627\u0644 \u06a9\u0646\u06cc\u062f.",
    trigger_event: "mail.received" as string | null,
    /* The last step WRITES — a draft, into the person's own mailbox. It
       writes nothing anybody has sent: the grant wall (db/0114) is what
       makes that true, not this ceiling. `assist` is fine for it: the
       validator refuses apply only under "watch", and the draft_mail apply
       is the separately-ruled inert kind. */
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        /* the message the trigger named, read under the owner's own grant */
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        /* the verdict AND the reply, as one validated shape. `reply` is a
           boolean so the next step can branch on it — `decide` refuses to
           read raw content, and is right to. */
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "\u0627\u06cc\u0646 \u067e\u06cc\u0627\u0645 \u0631\u0627 \u0628\u062e\u0648\u0627\u0646 \u0648 \u062a\u0635\u0645\u06cc\u0645 \u0628\u06af\u06cc\u0631 \u06a9\u0647 \u0622\u06cc\u0627 \u0627\u0632 \u06cc\u06a9 \u0627\u0646\u0633\u0627\u0646 \u067e\u0627\u0633\u062e \u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u062f \u06cc\u0627 \u0646\u0647 \u2014 \u0627\u0639\u0644\u0627\u0646\u200c\u0647\u0627\u060c \u0631\u0633\u06cc\u062f\u0647\u0627 \u0648 \u062e\u0628\u0631\u0646\u0627\u0645\u0647\u200c\u0647\u0627 \u0646\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0646\u062f. \u0627\u06af\u0631 \u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u062f\u060c \u067e\u0627\u0633\u062e\u06cc \u0628\u0647 \u0647\u0645\u0627\u0646 \u0632\u0628\u0627\u0646 \u067e\u06cc\u0627\u0645 \u0628\u0646\u0648\u06cc\u0633: \u0628\u0627 \u0633\u0644\u0627\u0645\u06cc \u0645\u062a\u0646\u0627\u0633\u0628 \u0628\u0627 \u0644\u062d\u0646 \u0641\u0631\u0633\u062a\u0646\u062f\u0647 \u0634\u0631\u0648\u0639 \u06a9\u0646\u060c \u062f\u0631 \u0628\u0646\u062f\u0647\u0627\u06cc \u06a9\u0648\u062a\u0627\u0647 \u0628\u0646\u0648\u06cc\u0633\u060c \u0648 \u0628\u0627 \u06cc\u06a9 \u062e\u062f\u0627\u062d\u0627\u0641\u0638\u06cc \u0633\u0627\u062f\u0647 \u062a\u0645\u0627\u0645 \u06a9\u0646\u061b \u0647\u0631\u06af\u0632 \u0646\u0627\u0645\u06cc \u0628\u0631\u0627\u06cc \u0635\u0627\u062d\u0628 \u062d\u0633\u0627\u0628 \u0627\u0632 \u062e\u0648\u062f\u062a \u0646\u0633\u0627\u0632. \u062f\u0631 note \u06cc\u06a9 \u062c\u0645\u0644\u0647 \u0628\u0631\u0627\u06cc \u0635\u0627\u062d\u0628 \u062d\u0633\u0627\u0628 \u0628\u0646\u0648\u06cc\u0633 \u06a9\u0647 \u0686\u0647 \u06a9\u0631\u062f\u06cc." },
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        /* every dangerous field BOUND to a header the provider parsed */
        { id: "s4", kind: "propose", proposal: "draft_mail",
          message: "{{s1.id}}", to: "{{s1.reply_to}}", subject: "{{s1.subject}}",
          from: "{{s2.body}}" },
        { id: "s5", kind: "apply", from: "s4" },
        { id: "s6", kind: "notify", card: "mail_draft" },
      ],
    },
  },

  /* ── the MEETINGS agent's remaining five (autotag + followups above) ── */

  meeting_title: {
    handle: "wf-starter-meeting-title",
    name: "پیشنهاد عنوان جلسه",
    description: "پس از هر جلسه یک عنوان کوتاه از رونوشت پیشنهاد می‌شود — با تأیید شما ثبت می‌شود.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        /* propose.from must be TYPED data, and ask's prose is not — so the
           title travels as topics_v1's first (and only) list item */
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
          instruction: "از این رونوشت فقط یک مورد در topics بگذار: عنوانی کوتاه و گویا برای این جلسه، حداکثر ده کلمه." },
        { id: "s3", kind: "propose", proposal: "set_title",
          from: "{{s2.topics[0]}}", call: "{{trigger.call_id}}" },
        { id: "s4", kind: "wait", on: "decision" },
        { id: "s5", kind: "apply", from: "s3" },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  decisions_digest: {
    handle: "wf-starter-decisions-digest",
    name: "جمع‌بندی تصمیم‌ها",
    description: "از خلاصه‌های جلسه‌های اخیر تصمیم‌ها را جمع می‌کند و یک جمع‌بندی کوتاه می‌نویسد.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 10 },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "decisions_v1",
          instruction: "از این خلاصه‌ها تصمیم‌های ثبت‌شده، کارهای سپرده‌شده و پرسش‌های باز را دربیاور." },
        { id: "s3", kind: "ask",
          instruction: "این تصمیم‌ها از جلسه‌های اخیر است: {{s2.decisions}} و این کارها: {{s2.action_items}} — یک جمع‌بندی کوتاه بنویس: هر تصمیم یک خط، و در پایان بگو چه چیزهایی هنوز باز مانده است." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  action_items: {
    handle: "wf-starter-action-items",
    name: "مرور کارهای جلسه",
    description: "پس از هر جلسه کارهای گفته‌شده با مسئول و موعدشان بیرون کشیده می‌شود و برای هر کدام یک خط پیگیری نوشته می‌شود.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        /* the schema demands non-empty assignee/due, and a meeting often
           names neither — the instruction supplies the honest filler so a
           silent field never fails the whole extraction */
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "action_items_v1",
          instruction: "کارهای گفته‌شده در این جلسه را دربیاور؛ اگر مسئول یا موعد گفته نشده بود، همان «نامشخص» را بنویس." },
        { id: "s3", kind: "decide", on: "s2.action_items.length", gt: 0, then: "s4", else: "s6" },
        { id: "s4", kind: "foreach", over: "{{s2.action_items}}", max: 10, do: "s5" },
        { id: "s5", kind: "ask",
          instruction: "برای این کار یک خط پیگیری بنویس که مسئول و موعد را نام ببرد: {{s4.item}}" },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  open_questions: {
    handle: "wf-starter-open-questions",
    name: "پرسش‌های بی‌پاسخ جلسه",
    description: "پس از هر جلسه پرسش‌هایی که بی‌پاسخ ماند جمع می‌شود تا هیچ‌کدام گم نشود.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "decisions_v1",
          instruction: "تمرکز روی پرسش‌های باز: هر پرسشی که در جلسه مطرح شد و پاسخ روشنی نگرفت را در open_questions بیاور؛ تصمیم‌ها و کارها را هم اگر بود ثبت کن." },
        /* no open questions -> straight to the card; the run still says it
           looked (a silent end is the wrong kind of nothing) */
        { id: "s3", kind: "decide", on: "s2.open_questions.length", gt: 0, then: "s4", else: "s5" },
        { id: "s4", kind: "ask",
          instruction: "این پرسش‌ها در جلسه بی‌پاسخ ماند: {{s2.open_questions}} — برای هر کدام بنویس پاسخش را باید از کجا یا از چه کسی گرفت." },
        { id: "s5", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  topic_history: {
    handle: "wf-starter-topic-history",
    name: "سیر موضوع‌ها",
    description: "در خلاصه‌های جلسه‌ها موضوع‌های تکرارشونده را پیدا می‌کند و مسیر هر کدام را روایت می‌کند.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 20 },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "در این خلاصه‌ها موضوع‌های تکرارشونده را پیدا کن و برای هر کدام بنویس در طول جلسه‌ها چه مسیری داشته است: کجا مطرح شد، چه تغییری کرد، اکنون کجاست." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },

  /* ── the MAIL agent's remaining six (mail_reply above) ────────────────
     None of these are manual: the grammar can reach a specific message
     only through {{trigger.source_ref}}, so every mail starter rides
     mail.received. The model steps that read a stranger's prose carry
     tools:"none" even where no draft_mail forces it — retrieval already
     happened in a deterministic step, and a mail body must never steer
     tools (the M43 asymmetry, applied one notch earlier than the
     validator demands). */

  mail_triage: {
    handle: "wf-starter-mail-triage",
    name: "تشخیص ایمیل‌های پاسخ‌خواه",
    description: "هر ایمیل تازه خوانده می‌شود و اگر پاسخ انسانی بخواهد، با یک یادداشت کوتاه خبرتان می‌کند.",
    trigger_event: "mail.received" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "این پیام را بخوان و تشخیص بده آیا پاسخِ یک انسان را می‌خواهد یا نه — اعلان‌ها، رسیدها و خبرنامه‌ها نمی‌خواهند. در reply همین را بگو؛ در note یک جمله دلیلت را بنویس؛ در body در یک خط بنویس چه اقدامی لازم است." },
        /* the quiet mail ends quietly — a card for every newsletter would
           teach the person to ignore the channel */
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mail_summary: {
    handle: "wf-starter-mail-summary",
    name: "خلاصهٔ ایمیل تازه",
    description: "هر ایمیل تازه در دو-سه خط خلاصه می‌شود: چه می‌خواهد، از چه کسی، تا کی.",
    trigger_event: "mail.received" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        /* the WHOLE envelope, not s1.subject — a subjectless mail is legal,
           and a single-field binding fails the run when the field is empty */
        { id: "s2", kind: "ask", tools: "none", from: "{{s1}}",
          instruction: "این ایمیل را در دو-سه خط خلاصه کن: چه می‌خواهد، از چه کسی، تا چه زمانی؛ اگر مهلتی یا پیوستی نام برده شده آن را هم بیاور." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mail_reply_formal: {
    handle: "wf-starter-mail-reply-formal",
    name: "پیش‌نویس رسمی پاسخ",
    description: "برای ایمیل‌هایی که پاسخ می‌خواهند پیش‌نویسی با لحن رسمی و اداری نوشته می‌شود — ارسال همیشه با خود شماست.",
    trigger_event: "mail.received" as string | null,
    /* same shape as mail_reply, same reasoning for the assist ceiling:
       the draft_mail apply is the ruled inert kind, and db/0114's grant
       wall is what keeps the draft unsent — never this field */
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "این پیام را بخوان و تصمیم بگیر که آیا از یک انسان پاسخ می‌خواهد یا نه — اعلان‌ها، رسیدها و خبرنامه‌ها نمی‌خواهند. اگر می‌خواهد، پاسخی رسمی و اداری به همان زبان پیام بنویس: با «با سلام و احترام» یا معادل آن در زبان پیام آغاز کن، در بندهای کوتاه و سنجیده بنویس، و با «با احترام» یا معادل آن پایان بده؛ هرگز نامی برای صاحب حساب از خودت نساز. در note یک جمله برای صاحب حساب بنویس که چه کردی." },
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        { id: "s4", kind: "propose", proposal: "draft_mail",
          message: "{{s1.id}}", to: "{{s1.reply_to}}", subject: "{{s1.subject}}",
          from: "{{s2.body}}" },
        { id: "s5", kind: "apply", from: "s4" },
        { id: "s6", kind: "notify", card: "mail_draft" },
      ],
    },
  },
  mail_reply_brief: {
    handle: "wf-starter-mail-reply-brief",
    name: "پاسخ کوتاه دریافت",
    description: "برای ایمیل‌های پاسخ‌خواه یک پیش‌نویس کوتاه دو-سه جمله‌ای نوشته می‌شود: رسید، در دست بررسی است.",
    trigger_event: "mail.received" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "این پیام را بخوان و تصمیم بگیر که آیا فرستنده منتظر پاسخ است یا نه — اعلان‌ها، رسیدها و خبرنامه‌ها منتظر نیستند. اگر هست، فقط یک پاسخ کوتاهِ دو-سه جمله‌ای به همان زبان پیام بنویس: دریافت را تأیید کن و بگو در دست بررسی است و پاسخ کامل به‌زودی می‌رسد؛ قولی جز این نده و هرگز نامی برای صاحب حساب از خودت نساز. در note یک جمله برای صاحب حساب بنویس که چه کردی." },
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        { id: "s4", kind: "propose", proposal: "draft_mail",
          message: "{{s1.id}}", to: "{{s1.reply_to}}", subject: "{{s1.subject}}",
          from: "{{s2.body}}" },
        { id: "s5", kind: "apply", from: "s4" },
        { id: "s6", kind: "notify", card: "mail_draft" },
      ],
    },
  },
  mail_meeting_request: {
    handle: "wf-starter-mail-meeting-request",
    name: "تشخیص درخواست جلسه",
    description: "اگر ایمیلی درخواست جلسه یا قرار داشته باشد، همان لحظه با یادداشتی کوتاه خبرتان می‌کند.",
    trigger_event: "mail.received" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        /* mail_reply_v1 reused as a detector: `reply` is the typed boolean
           decide needs, and the instruction redefines what the boolean is
           ABOUT — the schema is a shape contract, not a semantics one */
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "فقط تشخیص بده آیا این پیام درخواست جلسه، تماس یا قرار دارد. اگر دارد reply را true کن؛ در note بنویس چه کسی و برای چه؛ در body زمان‌های پیشنهادشده را بیاور و اگر زمانی پیشنهاد نشده بنویس «زمانی پیشنهاد نشده»." },
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mail_context: {
    handle: "wf-starter-mail-context",
    name: "پیشینهٔ فرستنده و موضوع",
    description: "برای هر ایمیل تازه، در خلاصه‌های جلسه‌ها هرچه به فرستنده یا موضوعش مربوط است جمع می‌شود.",
    trigger_event: "mail.received" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    /* the replacement for an end-of-day recap, which the grammar cannot
       say: no schedule trigger exists and no step enumerates a mailbox
       (fetch reads ONE message; search has no mail scope). This one is
       expressible AND more useful per message: the org's own records,
       brought to the mail the moment it lands. */
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        /* retrieval is THIS deterministic step, so the model step below can
           stay tools:"none" while still having records to work with */
        { id: "s2", kind: "search", scope: "summaries", limit: 10 },
        { id: "s3", kind: "ask", tools: "none", from: "{{s2}}",
          instruction: "ایمیل تازه‌ای رسیده است: {{s1}} — در خلاصه‌های جلسه‌ها که در ادامه می‌آید هرچه به فرستنده یا موضوع این ایمیل مربوط است را جمع کن؛ اگر چیزی پیدا نشد، همین را صریح بگو." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },

  /* ── the PREP agent's seven ───────────────────────────────────────────
     The meeting.soon graphs bind the calendar event as the WHOLE envelope
     ({{s1}}): titles, attendees and descriptions are all optional on real
     providers, and a single-field binding fails the run whenever its field
     is absent. The brief-shaped asks keep the default READ tools — M44's
     ruling: what they produce never leaves the building, so retrieval is
     the value, not a hazard. */

  prep_brief: {
    handle: "wf-starter-prep-brief",
    name: "جمع‌بندی پیش از جلسه",
    description: "کمی پیش از هر جلسه، از سابقهٔ گفت‌وگوها یک جمع‌بندی کوتاه ساخته می‌شود: چه گذشت، چه ماند، چه بپرسید.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "summaries", limit: 10 },
        { id: "s3", kind: "ask", from: "{{s2}}",
          instruction: "این رویداد تقویم پیشِ روست: {{s1}} — از خلاصه‌هایی که در ادامه می‌آید یک جمع‌بندی کوتاه برای این جلسه بساز: چه گذشت، چه تصمیم‌هایی باز ماند، چه باید بپرسید. آن‌قدر کوتاه که در یک دقیقه خوانده شود." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  prep_people: {
    handle: "wf-starter-prep-people",
    name: "شناخت شرکت‌کنندگان",
    description: "پیش از هر جلسه سابقهٔ گفت‌وگو با شرکت‌کنندگان مرور می‌شود: آخرین بار چه گفتید و چه چیزی از هر نفر مانده.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "directory", limit: 20 },
        { id: "s3", kind: "ask", from: "{{s2}}",
          instruction: "این رویداد تقویم پیشِ روست: {{s1}} — با کمک ابزارها سابقهٔ گفت‌وگو با شرکت‌کنندگان این جلسه را بررسی کن و دربارهٔ هر نفر دو خط بنویس: آخرین بار چه گفتید و چه چیزی از او مانده است." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  prep_questions: {
    handle: "wf-starter-prep-questions",
    name: "پرسش‌های پیشنهادی جلسه",
    description: "پیش از هر جلسه چند پرسش از دل خلاصه‌های پیشین پیشنهاد می‌شود که بحث را جلو ببرد.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "summaries", limit: 10 },
        { id: "s3", kind: "ask", from: "{{s2}}",
          instruction: "برای جلسهٔ پیشِ رو ({{s1}}) پنج پرسش پیشنهاد بده که بحث را جلو ببرد — پرسش‌هایی که از خلاصه‌های پیشین برمی‌آید، نه کلیات." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  prep_open_decisions: {
    handle: "wf-starter-prep-open-decisions",
    name: "موارد باز پیش از جلسه",
    description: "پیش از هر جلسه تصمیم‌های معلق و کارهای ناتمام فهرست می‌شود تا در جلسه بسته شوند.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "summaries", limit: 10 },
        { id: "s3", kind: "extract", from: "{{s2}}", schema: "decisions_v1",
          instruction: "از این خلاصه‌ها تصمیم‌های گرفته‌شده، کارهای سپرده‌شده و پرسش‌های باز را دربیاور." },
        { id: "s4", kind: "decide", on: "s3.open_questions.length", gt: 0, then: "s5", else: "s6" },
        { id: "s5", kind: "ask",
          instruction: "جلسه‌ای در راه است: {{s1}} — این پرسش‌ها هنوز بازند: {{s3.open_questions}} و این کارها هنوز در جریان‌اند: {{s3.action_items}}. فهرست کن کدام‌ها را باید همین جلسه بست." },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  prep_related: {
    handle: "wf-starter-prep-related",
    name: "رکوردهای مرتبط با جلسه",
    description: "پیش از هر جلسه تماس‌ها و جلسه‌های مرتبط با آن پیدا و فهرست می‌شود.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "calls", limit: 10 },
        { id: "s3", kind: "ask", from: "{{s2}}",
          instruction: "این رویداد تقویم پیشِ روست: {{s1}} — از میان تماس‌هایی که در ادامه می‌آید هر کدام را که به این جلسه مربوط است نام ببر و بگو چرا؛ اگر هیچ‌کدام مربوط نبود، همین را بگو." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  prep_today: {
    handle: "wf-starter-prep-today",
    name: "نمای امروز",
    description: "هر وقت بخواهید، از تازه‌ترین تماس‌ها یک نمای کلی می‌سازد: چه گذشته، چه در جریان است، چه چیزی به توجه نیاز دارد.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "calls", limit: 10 },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "از این تازه‌ترین تماس‌ها یک نمای کلی بساز: چه جلسه‌هایی برگزار شده، چه موضوع‌هایی در جریان است و چه چیزی اکنون به توجه نیاز دارد. با کمک ابزارها جزئیات موارد مهم را بررسی کن." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  prep_agenda: {
    handle: "wf-starter-prep-agenda",
    name: "پیش‌نویس دستور جلسهٔ بعد",
    description: "پس از هر جلسه از تصمیم‌ها و کارهای آن، دستور جلسهٔ بعدی پیش‌نویس می‌شود.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "decisions_v1",
          instruction: "تصمیم‌ها، کارهای سپرده‌شده و پرسش‌های باز این جلسه را دربیاور." },
        { id: "s3", kind: "ask",
          instruction: "بر پایهٔ این جلسه، دستور جلسهٔ بعدی را پیش‌نویس کن — تصمیم‌هایی که باید پیگیری شود: {{s2.decisions}}؛ کارها: {{s2.action_items}}؛ پرسش‌های باز: {{s2.open_questions}}. هر بند یک خط." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },

  /* ── the SALES agent's seven (2026-08-28 wave: three more platform
     agents; every graph obeys the two runtime facts in this file's header
     — transcript scope only under a call trigger, envelopes bound whole) ── */

  sales_debrief: {
    handle: "wf-starter-sales-debrief",
    name: "گزارش تماس فروش",
    description: "پس از هر تماس، یک گزارش فروش کوتاه نوشته می‌شود: نیاز مشتری، دغدغه‌ها و قدم بعدی.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "از این رونوشت یک گزارش تماس فروش بنویس: مشتری چه می‌خواهد، چه دغدغه‌ها یا مخالفت‌هایی گفت، چه قول‌هایی داده شد، و قدم بعدی چیست. کوتاه و قابل اقدام." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  sales_objections: {
    handle: "wf-starter-sales-objections",
    name: "مخالفت‌های پرتکرار",
    description: "از خلاصه‌های تماس‌های اخیر، دغدغه‌ها و مخالفت‌های تکرارشونده جمع می‌شود — با پاسخ‌هایی که جواب داده‌اند.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 10 },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "در این خلاصه‌ها دغدغه‌ها و مخالفت‌های مشتری‌ها را پیدا کن؛ تکرارشونده‌ها را اول بیاور، و اگر جایی پاسخی داده شده که جواب داده، همان را کنارش بنویس." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  sales_next_steps: {
    handle: "wf-starter-sales-next-steps",
    name: "قدم‌های بعدی مشتری",
    description: "پس از هر تماس، قول‌ها و قدم‌های بعدی با مسئول و موعدشان بیرون کشیده می‌شود.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "action_items_v1",
          instruction: "قول‌ها و قدم‌های بعدی این تماس را دربیاور؛ اگر مسئول یا موعد گفته نشده بود، «نامشخص» بنویس." },
        { id: "s3", kind: "decide", on: "s2.action_items.length", gt: 0, then: "s4", else: "s6" },
        { id: "s4", kind: "foreach", over: "{{s2.action_items}}", max: 8, do: "s5" },
        { id: "s5", kind: "ask",
          instruction: "برای این قدم یک خط پیگیری بنویس که مسئول و موعد را نام ببرد: {{s4.item}}" },
        { id: "s6", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  sales_commitments: {
    handle: "wf-starter-sales-commitments",
    name: "قول‌هایی که ما داده‌ایم",
    description: "هر وقت بخواهید، از تماس‌های اخیر هر قولی که به مشتری‌ها داده شده جمع می‌شود — پیش از آن‌که فراموش شود.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 10 },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "در این خلاصه‌ها هر قولی که طرف ما به مشتری داده — قیمت، زمان تحویل، پیگیری، سند — را جمع کن؛ برای هر کدام بنویس به چه کسی و در کدام جلسه." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  sales_lead_mail: {
    handle: "wf-starter-sales-lead-mail",
    name: "تشخیص ایمیل مشتری",
    description: "اگر ایمیل تازه از یک مشتری یا سرنخ فروش باشد — پرسش قیمت، درخواست دمو، پیگیری خرید — همان لحظه خبرتان می‌کند.",
    trigger_event: "mail.received" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "فقط تشخیص بده آیا این پیام از یک مشتری یا سرنخ فروش است — پرسش قیمت، درخواست دمو، علاقه به خرید یا پیگیری سفارش. اگر هست reply را true کن؛ در note یک جمله بنویس چه می‌خواهد؛ body را یک خط تیره بگذار." },
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  sales_meeting_prep: {
    handle: "wf-starter-sales-meeting-prep",
    name: "آماده‌سازی جلسهٔ فروش",
    description: "پیش از هر جلسه، سابقهٔ همان مشتری مرور می‌شود: چه گفته، چه خواسته، و چه چیزی هنوز روی میز است.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "summaries", limit: 10 },
        { id: "s3", kind: "ask", from: "{{s2}}",
          instruction: "این جلسهٔ فروش پیشِ روست: {{s1}} — از خلاصه‌های در ادامه، سابقهٔ همین مشتری را جمع کن: چه خواسته، چه قول‌هایی رد و بدل شده، چه دغدغه‌ای مانده، و در این جلسه چه چیزی را باید ببندید." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  sales_pipeline: {
    handle: "wf-starter-sales-pipeline",
    name: "نمای مشتری‌ها",
    description: "هر وقت بخواهید، از تماس‌های اخیر یک نمای فروش ساخته می‌شود: هر مشتری کجاست و کدام به توجه فوری نیاز دارد.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 10 },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "از این خلاصه‌ها یک نمای فروش بساز: برای هر مشتری یک خط — کجای گفت‌وگوست، آخرین تماس کی بود، و قدم بعدی چیست. مشتری‌هایی که مدتی است خبری از آن‌ها نیست را جدا نام ببر." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },

  /* ── the INTERVIEW agent's seven ── */

  int_scorecard: {
    handle: "wf-starter-int-scorecard",
    name: "کارنامهٔ مصاحبه",
    description: "پس از هر مصاحبه، یک کارنامهٔ ساختاریافته نوشته می‌شود: نقاط قوت، نگرانی‌ها، و شواهد هر کدام از خود گفت‌وگو.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "اگر این گفت‌وگو یک مصاحبهٔ کاری است، از آن یک کارنامه بنویس: نقاط قوت با نقل‌قول شاهد، نگرانی‌ها با شاهد، تجربه‌های مرتبط، و یک جمع‌بندی بی‌طرف. اگر مصاحبه نیست، فقط همین را بگو و تمام." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  int_questions: {
    handle: "wf-starter-int-questions",
    name: "پرسش‌های مصاحبهٔ بعد",
    description: "پیش از هر مصاحبه، از دورهای قبلی همان فرایند پرسش‌هایی ساخته می‌شود که هنوز جواب نگرفته‌اند.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "summaries", limit: 10 },
        { id: "s3", kind: "ask", from: "{{s2}}",
          instruction: "این جلسه پیشِ روست: {{s1}} — اگر مصاحبه است، از خلاصه‌های در ادامه دورهای قبلیِ همین فرایند را پیدا کن و پرسش‌هایی بنویس که هنوز بی‌جواب مانده‌اند: چیزهایی که مبهم ماند، ادعاهایی که سنجیده نشد. اگر سابقه‌ای نبود، پرسش‌های پایه‌ای برای شروع پیشنهاد کن." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  int_compare: {
    handle: "wf-starter-int-compare",
    name: "مقایسهٔ نامزدها",
    description: "هر وقت بخواهید، مصاحبه‌های اخیر کنار هم گذاشته می‌شوند: هر نامزد در چه چیزی قوی‌تر بود، با شاهد.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 10 },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "در این خلاصه‌ها مصاحبه‌های کاری را پیدا کن و نامزدها را کنار هم بگذار: برای هر معیار — تجربه، مهارت فنی، ارتباط — بگو کدام نامزد قوی‌تر بود و شاهدش چیست. اگر فقط یک مصاحبه هست، همان یک نفر را جمع‌بندی کن؛ اگر هیچ، صریح بگو." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  int_redflags: {
    handle: "wf-starter-int-redflags",
    name: "نکته‌های نیازمند وارسی",
    description: "پس از هر مصاحبه، ادعاهای وارسی‌نشده و ناسازگاری‌ها فهرست می‌شود — چیزهایی که پیش از تصمیم باید روشن شوند.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "اگر این گفت‌وگو مصاحبه است، فهرست کن چه ادعاهایی وارسی نشد، کجا پاسخ‌ها با هم نمی‌خواند، و چه چیزی پیش از تصمیم باید روشن شود — هر مورد با نقل‌قول. اتهام نزن؛ فقط آنچه باید پرسیده شود را بنویس. اگر مصاحبه نیست، همین را بگو." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  int_candidate_mail: {
    handle: "wf-starter-int-candidate-mail",
    name: "پیش‌نویس پاسخ به نامزد",
    description: "اگر ایمیل تازه از یک نامزد استخدام باشد، پاسخی مودبانه و بی‌وعده پیش‌نویس می‌شود — ارسال همیشه با خود شماست.",
    trigger_event: "mail.received" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "فقط اگر این پیام از یک نامزد استخدام دربارهٔ فرایند مصاحبه است — پیگیری نتیجه، هماهنگی زمان، پرسش دربارهٔ نقش — reply را true کن و پاسخی به همان زبان بنویس: مودبانه، کوتاه، و بدون هیچ وعده‌ای دربارهٔ نتیجه یا زمان قطعی؛ هرگز نامی برای صاحب حساب از خودت نساز. در note بنویس چه کردی." },
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        { id: "s4", kind: "propose", proposal: "draft_mail",
          message: "{{s1.id}}", to: "{{s1.reply_to}}", subject: "{{s1.subject}}",
          from: "{{s2.body}}" },
        { id: "s5", kind: "apply", from: "s4" },
        { id: "s6", kind: "notify", card: "mail_draft" },
      ],
    },
  },
  int_tag: {
    handle: "wf-starter-int-tag",
    name: "برچسب مصاحبه",
    description: "پس از هر مصاحبه، برچسب‌هایی مثل نقش و حوزهٔ آن پیشنهاد می‌شود — با تأیید شما ثبت می‌شود.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1",
          instruction: "اگر این گفت‌وگو مصاحبه است، حداکثر چهار برچسب کوتاه بده: «مصاحبه»، نام نقش، و حوزه‌های اصلی. اگر مصاحبه نیست، topics را خالی بگذار." },
        { id: "s3", kind: "decide", on: "s2.topics.length", gt: 0, then: "s4", else: "__end" },
        { id: "s4", kind: "propose", proposal: "add_tags",
          from: "{{s2.topics}}", call: "{{trigger.call_id}}" },
        { id: "s5", kind: "wait", on: "decision" },
        { id: "s6", kind: "apply", from: "s4" },
        { id: "s7", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  int_debrief: {
    handle: "wf-starter-int-debrief",
    name: "دستور جلسهٔ جمع‌بندی",
    description: "پس از هر مصاحبه، دستور جلسهٔ جمع‌بندی تیم پیش‌نویس می‌شود: چه دیدیم، چه بسنجیم، چه تصمیمی مانده.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "اگر این گفت‌وگو مصاحبه است، دستور جلسهٔ کوتاهی برای جمع‌بندی تیم بنویس: مشاهده‌های کلیدی، نکته‌هایی که باید سنجیده شود، و تصمیمی که باید گرفته شود. اگر مصاحبه نیست، همین را بگو." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },

  /* ── the MANAGER agent's seven ── */

  mgr_meeting_brief: {
    handle: "wf-starter-mgr-meeting-brief",
    name: "جلسه از چشم مدیر",
    description: "پیش از هر جلسه، یک برگهٔ مدیر ساخته می‌شود: چه تصمیمی روی میز است، چه کسی چه می‌خواهد، کجا نباید کوتاه آمد.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "summaries", limit: 10 },
        { id: "s3", kind: "ask", from: "{{s2}}",
          instruction: "این جلسه پیشِ روست: {{s1}} — از خلاصه‌های در ادامه یک برگهٔ مدیر بساز: چه تصمیمی باید در این جلسه گرفته شود، هر طرف چه می‌خواهد، و چه چیزی را نباید بی‌جواب گذاشت. کوتاه و صریح." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mgr_week_review: {
    handle: "wf-starter-mgr-week-review",
    name: "مرور هفته",
    description: "هر وقت بخواهید، از جلسه‌های اخیر یک مرور مدیریتی ساخته می‌شود: محورها، تصمیم‌ها، و آنچه عقب مانده.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 10 },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "از این خلاصه‌ها یک مرور مدیریتی بنویس: محورهای اصلی این مدت، تصمیم‌های گرفته‌شده، کارهایی که عقب مانده، و یکی دو چیزی که اگر امروز به آن نرسید هفتهٔ بعد گران تمام می‌شود." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mgr_delegations: {
    handle: "wf-starter-mgr-delegations",
    name: "بار هر نفر",
    description: "از جلسه‌های اخیر، کارهای سپرده‌شده به تفکیک افراد جمع می‌شود — چه کسی چه بر عهده دارد و بار چه کسی سنگین است.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 10 },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "action_items_v1",
          instruction: "همهٔ کارهای سپرده‌شده در این خلاصه‌ها را دربیاور؛ اگر مسئول یا موعد نامشخص بود، «نامشخص» بنویس." },
        { id: "s3", kind: "ask",
          instruction: "این کارها را به تفکیک مسئول مرتب کن: {{s2.action_items}} — زیر نام هر نفر کارهایش، و در پایان بگو بار چه کسی سنگین‌تر از بقیه است و چه کارهایی مسئول ندارند." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mgr_risks: {
    handle: "wf-starter-mgr-risks",
    name: "ریسک‌ها و گره‌ها",
    description: "هر وقت بخواهید، از جلسه‌های اخیر هر ریسک، گره و نگرانی گفته‌شده جمع می‌شود — پیش از آن‌که به مشکل برسد.",
    trigger_event: null as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "summaries", limit: 10 },
        { id: "s2", kind: "ask", from: "{{s1}}",
          instruction: "در این خلاصه‌ها هر ریسک، گره، تاخیر یا نگرانی که کسی گفته را جمع کن؛ برای هر کدام بنویس در کدام جلسه گفته شد و آیا برایش کاری تعیین شد یا بی‌صاحب ماند." },
        { id: "s3", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mgr_decisions_log: {
    handle: "wf-starter-mgr-decisions-log",
    name: "ثبت تصمیم‌های جلسه",
    description: "پس از هر جلسه، تصمیم‌های آن با صاحبشان در یک فهرست تمیز ثبت می‌شود.",
    trigger_event: "call.summarized" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "search", scope: "transcript", of: "{{trigger.call_id}}" },
        { id: "s2", kind: "extract", from: "{{s1}}", schema: "decisions_v1",
          instruction: "تصمیم‌های این جلسه را با نام تصمیم‌گیرنده دربیاور؛ پرسش‌هایی که باز ماند را هم بیاور." },
        { id: "s3", kind: "ask",
          instruction: "از این‌ها یک فهرست تمیز بساز — هر تصمیم یک خط با نام صاحبش: {{s2.decisions}} — و در پایان پرسش‌های باز را جدا بیاور." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mgr_escalations: {
    handle: "wf-starter-mgr-escalations",
    name: "تشخیص ایمیل فوری",
    description: "اگر ایمیل تازه چیزی باشد که تصمیم یا دخالت مدیر می‌خواهد — شکایت، ریسک، مهلت — همان لحظه خبرتان می‌کند.",
    trigger_event: "mail.received" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "mail_message", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "extract", schema: "mail_reply_v1", tools: "none",
          from: "{{s1.body}}",
          instruction: "فقط تشخیص بده آیا این پیام به تصمیم یا دخالت یک مدیر نیاز دارد — شکایت جدی، ریسک، مهلت نزدیک، یا تعهدی مالی. اگر دارد reply را true کن؛ در note یک جمله بنویس چرا فوری است؛ body را یک خط تیره بگذار." },
        { id: "s3", kind: "decide", on: "s2.reply", eq: true, then: "s4", else: "__end" },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
  mgr_one_on_one: {
    handle: "wf-starter-mgr-one-on-one",
    name: "آماده‌سازی جلسهٔ فردی",
    description: "پیش از هر جلسهٔ فردی، سابقهٔ همان نفر مرور می‌شود: چه بر عهده گرفته، چه گفته، و چه چیزی باید پرسیده شود.",
    trigger_event: "meeting.soon" as string | null,
    max_autonomy: "assist" as "watch" | "assist" | "act",
    graph: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "fetch", source_kind: "calendar_event", of: "{{trigger.source_ref}}" },
        { id: "s2", kind: "search", scope: "summaries", limit: 10 },
        { id: "s3", kind: "ask", from: "{{s2}}",
          instruction: "این جلسه پیشِ روست: {{s1}} — اگر جلسهٔ فردی است، از خلاصه‌های در ادامه سابقهٔ همان نفر را جمع کن: چه کارهایی بر عهده گرفته و کدام هنوز باز است، چه دغدغه‌ای گفته، و چه چیزی ارزش پرسیدن دارد. اگر معلوم نیست با چه کسی است، از عنوان رویداد کمک بگیر." },
        { id: "s4", kind: "notify", card: "workflow_result" },
      ],
    },
  },
} as const;
export type StarterKey = keyof typeof STARTER_WORKFLOWS;

/**
 * WHICH SEVEN COME UP WITH EACH AGENT (user directive, 2026-08-28: "for
 * each of these agents make 7 different workflow to choose from when it
 * comes up — i want to have options").
 *
 * Keys are the three platform agents' HANDLES (db/0124) — the same string
 * the wire's AgentCard carries, which is what the panel has in hand when
 * an agent is picked. Values are STARTER_WORKFLOWS keys, so a typo here is
 * a compile error rather than an empty menu.
 *
 * The web panel cannot import this module (node:crypto — see
 * workflowName.ts's header for the precedent), so
 * web/src/lib/agentStarters.ts mirrors it by HANDLE with a parity test
 * that imports THIS object in Node and compares whole-object. The core
 * suite pins the other invariants: exactly seven per agent, every key
 * real, and the 21 assignments partitioning the registry — an unassigned
 * starter is a shelf item no door leads to.
 */
export const AGENT_STARTERS: Readonly<Record<"meetings" | "mail" | "prep" | "sales" | "interview" | "manager" | "recorder" | "commitments", readonly StarterKey[]>> = {
  /* the 2026-08-29 wave: the recording itself as a subject. Seeded as
     system agents in db/0139. `recorder` is about the take that just
     happened; `commitments` reads ACROSS takes, which is why its starters
     search calls rather than one transcript. */
  recorder: [
    "record_recap", "record_decisions", "record_open", "record_speakers",
    "record_quotes", "record_next", "record_timeline",
  ],
  commitments: [
    "record_commitments", "commit_by_person", "commit_overdue",
    "commit_unowned", "commit_recent", "commit_followup", "commit_history",
  ],
  meetings: [
    "autotag", "followups", "meeting_title", "decisions_digest",
    "action_items", "open_questions", "topic_history",
  ],
  mail: [
    "mail_reply", "mail_triage", "mail_summary", "mail_reply_formal",
    "mail_reply_brief", "mail_meeting_request", "mail_context",
  ],
  prep: [
    "prep_brief", "prep_people", "prep_questions", "prep_open_decisions",
    "prep_related", "prep_today", "prep_agenda",
  ],
  /* the 2026-08-28 second wave (user directive: "3 more related agents
     ... with their workflow"). Seeded as system agents in db/0129. */
  sales: [
    "sales_debrief", "sales_objections", "sales_next_steps",
    "sales_commitments", "sales_lead_mail", "sales_meeting_prep",
    "sales_pipeline",
  ],
  interview: [
    "int_scorecard", "int_questions", "int_compare", "int_redflags",
    "int_candidate_mail", "int_tag", "int_debrief",
  ],
  manager: [
    "mgr_meeting_brief", "mgr_week_review", "mgr_delegations",
    "mgr_risks", "mgr_decisions_log", "mgr_escalations",
    "mgr_one_on_one",
  ],
};

export interface AuthoredWorkflow {
  id: string;
  handle: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger_event: string | null;
  current_version: number | null;
  current_version_id: string | null;
  versions: number;
  created_at: string;
}

export interface WorkflowVersionRow {
  id: string;
  version: number;
  max_autonomy: string;
  published_at: string;
  published_by: string;
}

const ROW = `
  select w.id, w.handle, w.name, w.description, w.enabled, w.trigger_event,
         w.current_version_id, w.created_at,
         (select v.version from echo.workflow_version v
           where v.id = w.current_version_id) as current_version,
         (select count(*) from echo.workflow_version v
           where v.workflow_id = w.id) as versions
    from echo.workflow w`;

function toAuthored(row: Record<string, unknown>): AuthoredWorkflow {
  return {
    id: String(row.id),
    handle: String(row.handle),
    name: String(row.name),
    description: String(row.description ?? ""),
    enabled: row.enabled === true,
    trigger_event: (row.trigger_event as string | null) ?? null,
    current_version: row.current_version === null ? null : Number(row.current_version),
    current_version_id: (row.current_version_id as string | null) ?? null,
    versions: Number(row.versions ?? 0),
    created_at: iso(row.created_at),
  };
}

export function createWorkflowAuthoringRepo(db: Db) {
  return {
    /** the builder's list — authored workflows incl. disabled/unpublished */
    async list(identity: Identity): Promise<AuthoredWorkflow[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `${ROW} where w.archived_at is null order by w.created_at desc`));
      return rows.map(toAuthored);
    },

    /** a new DRAFT: no version yet, disabled until published + enabled */
    async create(
      identity: Identity,
      input: { handle?: unknown; name?: unknown; description?: unknown },
    ): Promise<AuthoredWorkflow> {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) throw new ValidationError("name is required");
      const handle = typeof input.handle === "string" && input.handle.trim() !== ""
        ? input.handle.trim()
        : `wf-${randomBytes(4).toString("hex")}`;
      if (!HANDLE.test(handle)) {
        throw new ValidationError("handle must be lowercase letters, digits and dashes");
      }
      const description = typeof input.description === "string" ? input.description.trim() : "";
      try {
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ id: string }>(
            `insert into echo.workflow (org_id, handle, name, description, enabled, created_by)
             values ($1, $2, $3, $4, false, $5)
             returning id`,
            [identity.orgId, handle, name, description, identity.userId]));
        return (await this.get(identity, rows[0]!.id))!;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError("that handle is already in use",
            { code: "handle_taken", params: { handle } });
        }
        throw error;
      }
    },

    async get(identity: Identity, id: string): Promise<AuthoredWorkflow | undefined> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(`${ROW} where w.id = $1`, [id]));
      return rows[0] ? toAuthored(rows[0]) : undefined;
    },

    /**
     * PUBLISH: validate the whole checklist, insert version N+1, repoint.
     * The refusal NAMES the step and the rule — the validator's whole
     * point is that an invalid workflow dies here, not at 3 a.m.
     */
    async publish(
      identity: Identity,
      workflowId: string,
      input: { graph?: unknown; max_autonomy?: unknown; budget?: unknown },
    ): Promise<{ version: number; version_id: string }> {
      const workflow = await this.get(identity, workflowId);
      if (!workflow) throw new NotFoundError("no such workflow");
      const maxAutonomy = input.max_autonomy === "watch" || input.max_autonomy === "act"
        ? input.max_autonomy : "assist";
      const graph: WorkflowGraph = validateWorkflowGraph(input.graph, { maxAutonomy });
      const budget = validateWorkflowBudget(input.budget);

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; version: number }>(
          `insert into echo.workflow_version
             (workflow_id, org_id, version, graph, max_autonomy, budget, published_by)
           values ($1, $2,
             coalesce((select max(version) from echo.workflow_version
                        where workflow_id = $1), 0) + 1,
             $3::text::jsonb, $4, $5::text::jsonb, $6)
           returning id, version`,
          [workflowId, identity.orgId, JSON.stringify(graph),
            maxAutonomy, JSON.stringify(budget), identity.userId]));
      const version = rows[0];
      if (!version) throw new Error("version insert returned no row");
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.workflow set current_version_id = $2 where id = $1`,
          [workflowId, version.id]));
      return { version: version.version, version_id: version.id };
    },

    /** pause / rename / trigger / ROLLBACK (repoint at a prior version) */
    /**
     * **Remove a workflow** (user directive, 2026-08-28: "add remove this
     * workflow to the kebab menu").
     *
     * ARCHIVE, not DELETE, and the reason is not squeamishness: a workflow's
     * runs, its step outputs and its published versions all point at this
     * row, and they are the record of things that actually happened to
     * somebody's data. Destroying the row would either orphan that history
     * or cascade it away — one of which is a lie and the other is a bigger
     * one. `archived_at` takes it out of every list, out of the trigger
     * query, and out of the product; the history it produced stays readable.
     *
     * Reversible on purpose, at the database. The product offers no un-remove
     * because nobody has asked for one — and "we cannot get it back" would be
     * false if it did.
     */
    async archive(identity: Identity, workflowId: string): Promise<void> {
      const workflow = await this.get(identity, workflowId);
      if (!workflow) throw new NotFoundError("no such workflow");
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          /* enabled goes false in the same statement: an archived row is
             invisible, and an invisible row that is still `enabled` would
             keep firing on every matching event forever */
          `update echo.workflow
              set archived_at = now(), enabled = false
            where id = $1 and archived_at is null`,
          [workflowId]));
    },

    async update(
      identity: Identity,
      workflowId: string,
      patch: {
        enabled?: unknown; name?: unknown; description?: unknown;
        trigger_event?: unknown; current_version_id?: unknown;
      },
    ): Promise<AuthoredWorkflow> {
      const workflow = await this.get(identity, workflowId);
      if (!workflow) throw new NotFoundError("no such workflow");
      if (patch.trigger_event !== undefined && patch.trigger_event !== null
        && !(WORKFLOW_EVENTS as readonly string[]).includes(patch.trigger_event as string)) {
        throw new ValidationError("trigger_event must be a known fact or null");
      }
      if (patch.current_version_id !== undefined) {
        // W32's rollback: the pointer may only land on THIS workflow's own
        // immutable history — anything else is a graph swap wearing a
        // rollback costume
        const owns = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ id: string }>(
            `select id from echo.workflow_version
              where id = $1 and workflow_id = $2`,
            [String(patch.current_version_id), workflowId]));
        if (owns.length === 0) {
          throw new ValidationError("current_version_id must name one of this workflow's versions");
        }
      }
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.workflow
              set enabled = coalesce($2::boolean, enabled),
                  name = coalesce($3::text, name),
                  description = coalesce($4::text, description),
                  trigger_event = case when $5::boolean then $6::text else trigger_event end,
                  current_version_id = coalesce($7::uuid, current_version_id)
            where id = $1`,
          [workflowId,
            typeof patch.enabled === "boolean" ? patch.enabled : null,
            typeof patch.name === "string" && patch.name.trim() !== "" ? patch.name.trim() : null,
            typeof patch.description === "string" ? patch.description.trim() : null,
            patch.trigger_event !== undefined,
            (patch.trigger_event as string | null) ?? null,
            patch.current_version_id !== undefined ? String(patch.current_version_id) : null,
          ]));
      return (await this.get(identity, workflowId))!;
    },

    /** the immutable history, for the rollback picker */
    async versions(identity: Identity, workflowId: string): Promise<WorkflowVersionRow[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select id, version, max_autonomy, published_at, published_by
             from echo.workflow_version
            where workflow_id = $1 order by version desc`,
          [workflowId]));
      return rows.map((row) => ({
        id: String(row.id),
        version: Number(row.version),
        max_autonomy: String(row.max_autonomy),
        published_at: iso(row.published_at),
        published_by: String(row.published_by),
      }));
    },

    /** the current (or named) graph, for the editor — ADMIN policy read */
    async graph(
      identity: Identity, workflowId: string, versionId?: string,
    ): Promise<{ graph: WorkflowGraph; max_autonomy: string; budget: unknown } | undefined> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ graph: WorkflowGraph; max_autonomy: string; budget: unknown }>(
          versionId
            ? `select graph, max_autonomy, budget from echo.workflow_version
                where workflow_id = $1 and id = $2`
            : `select v.graph, v.max_autonomy, v.budget
                 from echo.workflow w join echo.workflow_version v on v.id = w.current_version_id
                where w.id = $1`,
          versionId ? [workflowId, versionId] : [workflowId]));
      return rows[0];
    },

    /**
     * Install one shipped starter for THIS org: create with its fixed
     * handle, publish through the same validated path as any authored
     * graph, enable, set its trigger. A second install of the same
     * starter is one 23505 -> 409, named.
     */
    async installStarter(identity: Identity, key: unknown): Promise<AuthoredWorkflow> {
      if (typeof key !== "string" || !(key in STARTER_WORKFLOWS)) {
        throw new ValidationError(
          `starter must be one of: ${Object.keys(STARTER_WORKFLOWS).join(", ")}`);
      }
      const starter = STARTER_WORKFLOWS[key as StarterKey];
      let workflow: AuthoredWorkflow;
      try {
        workflow = await this.create(identity, {
          handle: starter.handle, name: starter.name, description: starter.description,
        });
      } catch (error) {
        if (error instanceof ConflictError) {
          throw new ConflictError("this starter is already installed",
            { code: "starter_installed", params: { handle: starter.handle } });
        }
        throw error;
      }
      await this.publish(identity, workflow.id, {
        graph: starter.graph, max_autonomy: starter.max_autonomy,
      });
      return this.update(identity, workflow.id, {
        enabled: true, trigger_event: starter.trigger_event,
      });
    },

    /**
     * The standing decisions (W13/W17). Only ELIGIBLE (reversible) kinds
     * may ever be enabled — the platform floor an org cannot lower.
     */
    async autoApply(identity: Identity): Promise<{ kind: string; allowed: boolean; decided_by: string }[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select proposal_kind, allowed, decided_by from echo.workflow_auto_apply
            where org_id = $1 order by proposal_kind`,
          [identity.orgId]));
      return rows.map((row) => ({
        kind: String(row.proposal_kind),
        allowed: row.allowed === true,
        decided_by: String(row.decided_by),
      }));
    },

    async setAutoApply(
      identity: Identity, kind: string, allowed: boolean,
    ): Promise<void> {
      if (!(AUTO_APPLY_ELIGIBLE as readonly string[]).includes(kind)) {
        throw new ValidationError(
          "only reversible kinds may auto-apply — this one always keeps a live human",
          { code: "kind_not_eligible", params: { kind } });
      }
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `insert into echo.workflow_auto_apply (org_id, proposal_kind, allowed, decided_by)
           values ($1, $2, $3, $4)
           on conflict (org_id, proposal_kind)
           do update set allowed = excluded.allowed,
                         decided_by = excluded.decided_by,
                         decided_at = now()`,
          [identity.orgId, kind, allowed, identity.userId]));
    },
  };
}
