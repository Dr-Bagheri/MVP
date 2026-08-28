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
  /* the 2026-08-28 wave: seven options per platform agent (AGENT_STARTERS
     in core) — the parity test compares every literal below against the
     producer's, so a rename in core goes red here instead of silently
     falling back to Persian on the English UI */
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
