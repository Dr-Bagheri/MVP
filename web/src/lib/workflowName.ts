"use client";

import { useTranslations } from "next-intl";

/**
 * Display copy for the SHIPPED STARTER workflows (user report: the English
 * `/workflows` list read «برچسب‌گذاری خودکار جلسه» and «پیگیری جلسه‌ها»).
 *
 * The same line `lib/skillName.ts` draws, one catalogue over: a shipped
 * starter's name and description are PRODUCT COPY — we wrote them, they ship
 * in the binary, and they localize like every other product string. An
 * org-authored workflow's name is the org's own words and renders exactly as
 * authored, always.
 *
 * ── The wrinkle a skill does not have ───────────────────────────────────────
 *
 * A starter is not read from a shipped catalogue at render time: installing
 * one COPIES its Persian name into `echo.workflow` as an ordinary row, and
 * from that moment an admin may rename it (`PATCH /v1/workflows/:id`). So the
 * stored string is product copy *until somebody edits it*, and after that it
 * is theirs — the one case where the same field is both kinds of content at
 * different times.
 *
 * The discriminator is the only honest one available: the row still holds the
 * string we seeded. Equal → nobody has touched it, so it is still our copy and
 * localizes. Different → a person chose those words, and a person's words are
 * never translated. There is no `renamed_at` to consult and adding one would
 * be a column to keep in step with a comparison that already answers.
 *
 * Name and description are gated INDEPENDENTLY because they are independently
 * editable: renaming a workflow while leaving its description alone must not
 * strand the description in Persian on the English UI.
 */

/**
 * The names core seeds, mirrored from `STARTER_WORKFLOWS` in
 * `core/src/api/workflow-authoring.ts`.
 *
 * A mirror rather than an import: that module reaches for `node:crypto`, the
 * error classes and the db types, and it is not one of core's two browser-safe
 * exports (`./vocabulary`, `./wire`) — pulling it into the client bundle to
 * read six strings is the wrong trade. The copy is kept honest by
 * `workflowName.test.ts`, which imports the real module in Node and asserts
 * every literal here still matches the producer's, so a starter renamed in
 * core goes red instead of silently falling back to Persian.
 */
export const SEEDED_STARTERS: Readonly<
  Record<string, { name: string; description: string }>
> = {
  "wf-starter-record-recap": {
    name: "جمع‌بندی پس از ضبط",
    description: "تا ضبط تمام شود، از روی رونوشت یک جمع‌بندی کوتاه می‌نویسد: موضوع، تصمیم‌ها و آنچه باز مانده.",
  },
  "wf-starter-record-commitments": {
    name: "قول‌های این ضبط",
    description: "پس از هر ضبط، قول‌ها را با نام گوینده درمی‌آورد تا معلوم باشد چه کسی چه چیزی را بر عهده گرفته.",
  },
  "wf-starter-record-decisions": {
    name: "تصمیم‌های این ضبط",
    description: "هر تصمیمی که در این ضبط گرفته شد، با جملهٔ خودِ گوینده.",
  },
  "wf-starter-record-open": {
    name: "آنچه باز ماند",
    description: "پرسش‌ها و موضوع‌هایی که در این ضبط بی‌پاسخ ماندند.",
  },
  "wf-starter-record-speakers": {
    name: "چه کسی چه گفت",
    description: "به‌ازای هر گوینده، خلاصه‌ای از سهم او در این گفت‌وگو.",
  },
  "wf-starter-record-quotes": {
    name: "جمله‌های کلیدی",
    description: "چند جملهٔ مهم این ضبط، دقیقاً همان‌طور که گفته شد.",
  },
  "wf-starter-record-next": {
    name: "قدم بعدی پس از این ضبط",
    description: "پس از این گفت‌وگو چه چیزی باید انجام شود و به دست چه کسی.",
  },
  "wf-starter-record-timeline": {
    name: "خط زمانی گفت‌وگو",
    description: "این ضبط از کجا شروع شد و به کجا رسید — به ترتیب.",
  },
  "wf-starter-commit-by-person": {
    name: "قول‌ها به تفکیک افراد",
    description: "از جلسه‌های اخیر، هر شخص چه چیزهایی را بر عهده گرفته.",
  },
  "wf-starter-commit-overdue": {
    name: "قول‌های از موعد گذشته",
    description: "قول‌هایی که زمانشان گفته شده بود و آن زمان گذشته است.",
  },
  "wf-starter-commit-unowned": {
    name: "کارهای بی‌صاحب",
    description: "چیزهایی که قرار شد انجام شود ولی کسی آن را بر عهده نگرفت.",
  },
  "wf-starter-commit-recent": {
    name: "قول‌های تازه",
    description: "قول‌هایی که در جلسه‌های اخیر داده شده‌اند.",
  },
  "wf-starter-commit-followup": {
    name: "یادآوری قول‌ها",
    description: "برای هر قول باز، یک خط یادآوری که خودتان بفرستید.",
  },
  "wf-starter-commit-history": {
    name: "سابقهٔ یک موضوع",
    description: "یک موضوع در جلسه‌های پیاپی چه مسیری را طی کرده.",
  },
  "wf-starter-followups": {
    name: "پیگیری جلسه‌ها",
    description: "از جلسه‌های اخیر موضوع‌ها را درمی‌آورد و برای هر کدام یک خط پیگیری می‌نویسد.",
  },
  "wf-starter-autotag": {
    name: "برچسب‌گذاری خودکار جلسه",
    description: "پس از هر جلسه موضوع‌ها از رونوشت درمی‌آید و به‌عنوان برچسب پیشنهاد می‌شود - با تأیید شما ثبت می‌شود.",
  },
  "wf-starter-mail-reply": {
    name: "پیش‌نویس پاسخ ایمیل",
    description: "هر ایمیل تازه‌ای که می‌رسد خوانده می‌شود و اگر پاسخ می‌خواهد، پیش‌نویسی نوشته می‌شود که خودتان بازبینی و ارسال کنید.",
  },
  "wf-starter-meeting-title": {
    name: "پیشنهاد عنوان جلسه",
    description: "پس از هر جلسه یک عنوان کوتاه از رونوشت پیشنهاد می‌شود — با تأیید شما ثبت می‌شود.",
  },
  "wf-starter-decisions-digest": {
    name: "جمع‌بندی تصمیم‌ها",
    description: "از خلاصه‌های جلسه‌های اخیر تصمیم‌ها را جمع می‌کند و یک جمع‌بندی کوتاه می‌نویسد.",
  },
  "wf-starter-action-items": {
    name: "مرور کارهای جلسه",
    description: "پس از هر جلسه کارهای گفته‌شده با مسئول و موعدشان بیرون کشیده می‌شود و برای هر کدام یک خط پیگیری نوشته می‌شود.",
  },
  "wf-starter-open-questions": {
    name: "پرسش‌های بی‌پاسخ جلسه",
    description: "پس از هر جلسه پرسش‌هایی که بی‌پاسخ ماند جمع می‌شود تا هیچ‌کدام گم نشود.",
  },
  "wf-starter-topic-history": {
    name: "سیر موضوع‌ها",
    description: "در خلاصه‌های جلسه‌ها موضوع‌های تکرارشونده را پیدا می‌کند و مسیر هر کدام را روایت می‌کند.",
  },
  "wf-starter-mail-triage": {
    name: "تشخیص ایمیل‌های پاسخ‌خواه",
    description: "هر ایمیل تازه خوانده می‌شود و اگر پاسخ انسانی بخواهد، با یک یادداشت کوتاه خبرتان می‌کند.",
  },
  "wf-starter-mail-summary": {
    name: "خلاصهٔ ایمیل تازه",
    description: "هر ایمیل تازه در دو-سه خط خلاصه می‌شود: چه می‌خواهد، از چه کسی، تا کی.",
  },
  "wf-starter-mail-reply-formal": {
    name: "پیش‌نویس رسمی پاسخ",
    description: "برای ایمیل‌هایی که پاسخ می‌خواهند پیش‌نویسی با لحن رسمی و اداری نوشته می‌شود — ارسال همیشه با خود شماست.",
  },
  "wf-starter-mail-reply-brief": {
    name: "پاسخ کوتاه دریافت",
    description: "برای ایمیل‌های پاسخ‌خواه یک پیش‌نویس کوتاه دو-سه جمله‌ای نوشته می‌شود: رسید، در دست بررسی است.",
  },
  "wf-starter-mail-meeting-request": {
    name: "تشخیص درخواست جلسه",
    description: "اگر ایمیلی درخواست جلسه یا قرار داشته باشد، همان لحظه با یادداشتی کوتاه خبرتان می‌کند.",
  },
  "wf-starter-mail-context": {
    name: "پیشینهٔ فرستنده و موضوع",
    description: "برای هر ایمیل تازه، در خلاصه‌های جلسه‌ها هرچه به فرستنده یا موضوعش مربوط است جمع می‌شود.",
  },
  "wf-starter-prep-brief": {
    name: "جمع‌بندی پیش از جلسه",
    description: "کمی پیش از هر جلسه، از سابقهٔ گفت‌وگوها یک جمع‌بندی کوتاه ساخته می‌شود: چه گذشت، چه ماند، چه بپرسید.",
  },
  "wf-starter-prep-people": {
    name: "شناخت شرکت‌کنندگان",
    description: "پیش از هر جلسه سابقهٔ گفت‌وگو با شرکت‌کنندگان مرور می‌شود: آخرین بار چه گفتید و چه چیزی از هر نفر مانده.",
  },
  "wf-starter-prep-questions": {
    name: "پرسش‌های پیشنهادی جلسه",
    description: "پیش از هر جلسه چند پرسش از دل خلاصه‌های پیشین پیشنهاد می‌شود که بحث را جلو ببرد.",
  },
  "wf-starter-prep-open-decisions": {
    name: "موارد باز پیش از جلسه",
    description: "پیش از هر جلسه تصمیم‌های معلق و کارهای ناتمام فهرست می‌شود تا در جلسه بسته شوند.",
  },
  "wf-starter-prep-related": {
    name: "رکوردهای مرتبط با جلسه",
    description: "پیش از هر جلسه تماس‌ها و جلسه‌های مرتبط با آن پیدا و فهرست می‌شود.",
  },
  "wf-starter-prep-today": {
    name: "نمای امروز",
    description: "هر وقت بخواهید، از تازه‌ترین تماس‌ها یک نمای کلی می‌سازد: چه گذشته، چه در جریان است، چه چیزی به توجه نیاز دارد.",
  },
  "wf-starter-prep-agenda": {
    name: "پیش‌نویس دستور جلسهٔ بعد",
    description: "پس از هر جلسه از تصمیم‌ها و کارهای آن، دستور جلسهٔ بعدی پیش‌نویس می‌شود.",
  },
  "wf-starter-sales-debrief": {
    name: "گزارش تماس فروش",
    description: "پس از هر تماس، یک گزارش فروش کوتاه نوشته می‌شود: نیاز مشتری، دغدغه‌ها و قدم بعدی.",
  },
  "wf-starter-sales-objections": {
    name: "مخالفت‌های پرتکرار",
    description: "از خلاصه‌های تماس‌های اخیر، دغدغه‌ها و مخالفت‌های تکرارشونده جمع می‌شود — با پاسخ‌هایی که جواب داده‌اند.",
  },
  "wf-starter-sales-next-steps": {
    name: "قدم‌های بعدی مشتری",
    description: "پس از هر تماس، قول‌ها و قدم‌های بعدی با مسئول و موعدشان بیرون کشیده می‌شود.",
  },
  "wf-starter-sales-commitments": {
    name: "قول‌هایی که ما داده‌ایم",
    description: "هر وقت بخواهید، از تماس‌های اخیر هر قولی که به مشتری‌ها داده شده جمع می‌شود — پیش از آن‌که فراموش شود.",
  },
  "wf-starter-sales-lead-mail": {
    name: "تشخیص ایمیل مشتری",
    description: "اگر ایمیل تازه از یک مشتری یا سرنخ فروش باشد — پرسش قیمت، درخواست دمو، پیگیری خرید — همان لحظه خبرتان می‌کند.",
  },
  "wf-starter-sales-meeting-prep": {
    name: "آماده‌سازی جلسهٔ فروش",
    description: "پیش از هر جلسه، سابقهٔ همان مشتری مرور می‌شود: چه گفته، چه خواسته، و چه چیزی هنوز روی میز است.",
  },
  "wf-starter-sales-pipeline": {
    name: "نمای مشتری‌ها",
    description: "هر وقت بخواهید، از تماس‌های اخیر یک نمای فروش ساخته می‌شود: هر مشتری کجاست و کدام به توجه فوری نیاز دارد.",
  },
  "wf-starter-int-scorecard": {
    name: "کارنامهٔ مصاحبه",
    description: "پس از هر مصاحبه، یک کارنامهٔ ساختاریافته نوشته می‌شود: نقاط قوت، نگرانی‌ها، و شواهد هر کدام از خود گفت‌وگو.",
  },
  "wf-starter-int-questions": {
    name: "پرسش‌های مصاحبهٔ بعد",
    description: "پیش از هر مصاحبه، از دورهای قبلی همان فرایند پرسش‌هایی ساخته می‌شود که هنوز جواب نگرفته‌اند.",
  },
  "wf-starter-int-compare": {
    name: "مقایسهٔ نامزدها",
    description: "هر وقت بخواهید، مصاحبه‌های اخیر کنار هم گذاشته می‌شوند: هر نامزد در چه چیزی قوی‌تر بود، با شاهد.",
  },
  "wf-starter-int-redflags": {
    name: "نکته‌های نیازمند وارسی",
    description: "پس از هر مصاحبه، ادعاهای وارسی‌نشده و ناسازگاری‌ها فهرست می‌شود — چیزهایی که پیش از تصمیم باید روشن شوند.",
  },
  "wf-starter-int-candidate-mail": {
    name: "پیش‌نویس پاسخ به نامزد",
    description: "اگر ایمیل تازه از یک نامزد استخدام باشد، پاسخی مودبانه و بی‌وعده پیش‌نویس می‌شود — ارسال همیشه با خود شماست.",
  },
  "wf-starter-int-tag": {
    name: "برچسب مصاحبه",
    description: "پس از هر مصاحبه، برچسب‌هایی مثل نقش و حوزهٔ آن پیشنهاد می‌شود — با تأیید شما ثبت می‌شود.",
  },
  "wf-starter-int-debrief": {
    name: "دستور جلسهٔ جمع‌بندی",
    description: "پس از هر مصاحبه، دستور جلسهٔ جمع‌بندی تیم پیش‌نویس می‌شود: چه دیدیم، چه بسنجیم، چه تصمیمی مانده.",
  },
  "wf-starter-mgr-meeting-brief": {
    name: "جلسه از چشم مدیر",
    description: "پیش از هر جلسه، یک برگهٔ مدیر ساخته می‌شود: چه تصمیمی روی میز است، چه کسی چه می‌خواهد، کجا نباید کوتاه آمد.",
  },
  "wf-starter-mgr-week-review": {
    name: "مرور هفته",
    description: "هر وقت بخواهید، از جلسه‌های اخیر یک مرور مدیریتی ساخته می‌شود: محورها، تصمیم‌ها، و آنچه عقب مانده.",
  },
  "wf-starter-mgr-delegations": {
    name: "بار هر نفر",
    description: "از جلسه‌های اخیر، کارهای سپرده‌شده به تفکیک افراد جمع می‌شود — چه کسی چه بر عهده دارد و بار چه کسی سنگین است.",
  },
  "wf-starter-mgr-risks": {
    name: "ریسک‌ها و گره‌ها",
    description: "هر وقت بخواهید، از جلسه‌های اخیر هر ریسک، گره و نگرانی گفته‌شده جمع می‌شود — پیش از آن‌که به مشکل برسد.",
  },
  "wf-starter-mgr-decisions-log": {
    name: "ثبت تصمیم‌های جلسه",
    description: "پس از هر جلسه، تصمیم‌های آن با صاحبشان در یک فهرست تمیز ثبت می‌شود.",
  },
  "wf-starter-mgr-escalations": {
    name: "تشخیص ایمیل فوری",
    description: "اگر ایمیل تازه چیزی باشد که تصمیم یا دخالت مدیر می‌خواهد — شکایت، ریسک، مهلت — همان لحظه خبرتان می‌کند.",
  },
  "wf-starter-mgr-one-on-one": {
    name: "آماده‌سازی جلسهٔ فردی",
    description: "پیش از هر جلسهٔ فردی، سابقهٔ همان نفر مرور می‌شود: چه بر عهده گرفته، چه گفته، و چه چیزی باید پرسیده شود.",
  },
};

/**
 * THE TWO SHIPPED TEMPLATES, exactly as db/0065 seeds them.
 *
 * They arrive from the wire in English because that is the language the
 * migration wrote them in, and until now the cards rendered that string
 * straight — so the flagship of a Persian-first product introduced itself in
 * English on its own page (user report, 2026-09-02, with the screenshot).
 *
 * Same discipline as the starters below: the catalogue only replaces a string
 * that is still WORD FOR WORD what we shipped. An organization that renamed
 * its template keeps its name in every locale, because that name is a person's
 * words and ours are not.
 */
export const SEEDED_TEMPLATES: Readonly<
  Record<string, { name: string; description: string }>
> = {
  "prepare-meetings": {
    name: "Prepare me for meetings",
    description: "Turn one selected calendar event into a concise, evidence-based meeting brief.",
  },
  "draft-email-replies": {
    name: "Draft email replies",
    description: "Turn one selected email into a thoughtful reply draft for the user to review.",
  },
};

/** what a caller has to hand us — every workflow list row carries these */
export interface WorkflowCopySubject {
  handle: string;
  name: string;
  description?: string | null;
}

export interface WorkflowCopy {
  name: string;
  description: string;
}

/**
 * The resolver. Hand it a row, render what comes back.
 *
 * A starter whose catalogue entry is missing falls back to the stored string
 * rather than throwing or rendering a raw key — visible and untranslated beats
 * invisible and broken, the same fallback the skill catalogue takes.
 */
export function useWorkflowCopy(): (workflow: WorkflowCopySubject) => WorkflowCopy {
  const t = useTranslations("workflows");
  return (workflow) => {
    const stored: WorkflowCopy = {
      name: workflow.name,
      description: workflow.description ?? "",
    };
    const seeded = SEEDED_STARTERS[workflow.handle];
    /* not a shipped starter at all — an org authored it, and it renders as
       authored in every locale */
    if (seeded === undefined) return stored;

    let entry: Partial<WorkflowCopy> | undefined;
    try {
      entry = t.raw(`starter.${workflow.handle}`) as Partial<WorkflowCopy> | undefined;
    } catch {
      /* no catalogue entry for this handle — the stored words still serve */
      return stored;
    }

    return {
      name:
        stored.name.trim() === seeded.name && typeof entry?.name === "string"
          ? entry.name
          : stored.name,
      description:
        stored.description.trim() === seeded.description && typeof entry?.description === "string"
          ? entry.description
          : stored.description,
    };
  };
}

/**
 * The template card resolver — the `useWorkflowCopy` rule keyed on SLUG,
 * which is the identity a `workflow_template` row carries (a starter carries
 * a handle; they are different tables and the two must not be conflated).
 */
export function useWorkflowTemplateCopy(): (
  template: { slug: string; name: string; description?: string | null },
) => WorkflowCopy {
  const t = useTranslations("workflows");
  return (template) => {
    const stored: WorkflowCopy = {
      name: template.name,
      description: template.description ?? "",
    };
    const seeded = SEEDED_TEMPLATES[template.slug];
    if (seeded === undefined) return stored;

    let entry: Partial<WorkflowCopy> | undefined;
    try {
      entry = t.raw(`card.${template.slug}`) as Partial<WorkflowCopy> | undefined;
    } catch {
      return stored;
    }
    return {
      name:
        stored.name.trim() === seeded.name && typeof entry?.name === "string"
          ? entry.name
          : stored.name,
      description:
        stored.description.trim() === seeded.description && typeof entry?.description === "string"
          ? entry.description
          : stored.description,
    };
  };
}
