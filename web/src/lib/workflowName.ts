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
