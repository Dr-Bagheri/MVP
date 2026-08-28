"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { MailDraft } from "@/api/types";
import { notify } from "@/lib/notify";

/**
 * M43 — the reply, in the thread, with the one button that sends it.
 *
 * Two things this deliberately does NOT do:
 *
 * **It does not let you edit and send in one motion.** The body shown here
 * is the row the server will send, read again server-side at send time; a
 * textarea whose contents travelled with the press would mean the thing sent
 * is not necessarily the thing anyone read. Editing belongs in the mailbox,
 * where the draft also is, and the card says so.
 *
 * **It does not disappear when sent.** A sent reply becomes a quiet record
 * with its address still visible — a card that vanishes on success leaves the
 * person wondering whether it went.
 */
export function MailDraftCard({
  draft,
  onChanged,
}: {
  draft: MailDraft;
  onChanged?: (next: MailDraft) => void;
}) {
  const t = useTranslations("mail");
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [state, setState] = useState(draft);

  async function act(kind: "send" | "discard") {
    if (busy) return;
    setBusy(kind);
    try {
      const next = kind === "send"
        ? await api.sendMailDraft(state.id)
        : await api.discardMailDraft(state.id);
      setState(next);
      onChanged?.(next);
      notify(t(kind === "send" ? "sent" : "discarded"));
    } catch (cause) {
      /* 409 means somebody already decided it — that is not a failure, it is
         the answer, and it must not read as "try again" */
      const status = (cause as { status?: number }).status;
      notify(t(status === 409 ? "alreadyDecided" : "sendFailed"), "warn");
    } finally {
      setBusy(null);
    }
  }

  const decided = state.status !== "pending";

  return (
    <div className="mt-3 max-w-[42rem] overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg">
          <MailMark />
          {t(state.status === "sent" ? "sentLabel" : state.status === "discarded" ? "discardedLabel" : "newEmail")}
        </span>
        {state.in_provider ? (
          <span className="text-xs text-fg-subtle">{t("inMailbox")}</span>
        ) : null}
      </div>

      <dl className="divide-y divide-border">
        <div className="flex gap-3 px-4 py-2.5">
          <dt className="sr-only">{t("to")}</dt>
          <dd dir="ltr" className="truncate text-sm text-fg">{state.to_address}</dd>
        </div>
        <div className="flex gap-3 px-4 py-2.5">
          <dt className="sr-only">{t("subject")}</dt>
          <dd className="truncate text-sm font-medium text-fg">{state.subject}</dd>
        </div>
      </dl>

      <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-7 text-fg-muted">{state.body}</p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <span className="text-xs text-fg-subtle">
          {decided ? t("decidedNote") : t("editNote")}
        </span>
        {decided ? null : (
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="tap h-9 min-h-0 rounded-lg px-3 text-xs text-fg-muted hover:text-danger"
              disabled={busy !== null}
              onClick={() => void act("discard")}
            >
              {t("discard")}
            </button>
            <button
              type="button"
              className="btn-primary h-9 min-h-0 px-4 text-sm"
              disabled={busy !== null}
              onClick={() => void act("send")}
            >
              {busy === "send" ? t("sending") : t("sendNow")}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function MailMark() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="m3 6 7 5 7-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
