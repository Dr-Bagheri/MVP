"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { MailDraft, MailSourceMessage } from "@/api/types";
import { notify } from "@/lib/notify";
import { Link } from "@/i18n/routing";
import { formatRelativeDate, formatTime } from "@/lib/format";

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
 *
 * ── The message being answered ──────────────────────────────────────────────
 *
 * A reply on its own asks somebody to approve a decision they cannot check
 * (user directive, 2026-08-28: "the draft must come like this already prepared
 * with the email on top of it as well"). The quote above the card is that
 * check, and it is fetched HERE rather than handed down: the product stores a
 * reference, not the person's mail, so reading the original is a live call to
 * the provider — one per card that is actually on screen, never one per row of
 * a list. A failure degrades to no quote at all: the reply is the record, the
 * quote is context, and an error banner over every draft would be noise about
 * something nobody asked for.
 */
export function MailDraftCard({
  draft,
  canSend = true,
  onChanged,
}: {
  draft: MailDraft;
  /**
   * Whether the connection this draft belongs to may actually send.
   *
   * A connection made before the compose scope existed reads mail fine and
   * refuses to send it, so the draft arrives and the button fails at the
   * provider. Offering the upgrade instead of the press is the difference
   * between a control that works and one that looks like it does — the
   * failure would be Google's, and the person would read it as ours.
   */
  canSend?: boolean;
  onChanged?: (next: MailDraft) => void;
}) {
  const t = useTranslations("mail");
  const locale = useLocale();
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [state, setState] = useState(draft);
  /** the message this answers; null while it is in flight or unreadable */
  const [source, setSource] = useState<MailSourceMessage | null>(null);

  useEffect(() => {
    let live = true;
    void api.mailDraftSource(draft.id)
      .then((message) => { if (live) setSource(message); })
      /* the provider refused, the message is gone, or the shape was
         unreadable — all of which mean the same thing to a reader: there is
         no quote to show. The draft itself is unaffected. */
      .catch(() => {});
    return () => { live = false; };
  }, [draft.id]);

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
    <div className="mt-3 max-w-[42rem]">
      {source ? <QuotedSource message={source} locale={locale} /> : null}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
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
            {decided ? t("decidedNote") : canSend ? t("editNote") : t("cannotSendNote")}
          </span>
          {decided ? null : !canSend ? (
            <Link href="/integrations" className="btn-secondary h-9 min-h-0 px-3 text-xs">
              {t("connectToSend")}
            </Link>
          ) : (
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
    </div>
  );
}

/**
 * The message the reply answers, quoted above it.
 *
 * The rule under the styling: this is somebody ELSE's text, and it must never
 * be able to read as ours. So it sits outside the reply's card, on the page's
 * own ground, behind a quote rule — and its body scrolls in its own box rather
 * than being clipped, because a quote cut off at an arbitrary line can change
 * what the message says while looking complete.
 *
 * The provider can hand back empty strings when it cannot read a field. An
 * empty line is skipped rather than rendered as a labelled blank, which would
 * report "this message has no sender" — a claim we cannot make.
 */
function QuotedSource({ message, locale }: { message: MailSourceMessage; locale: string }) {
  const t = useTranslations("mail");
  return (
    <figure className="mb-2 border-s-2 border-border-strong ps-3">
      <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-medium text-fg-subtle">{t("originalLabel")}</span>
        {message.occurred_at ? (
          <span className="text-xs text-fg-subtle">
            {`${formatRelativeDate(message.occurred_at, locale)} ${formatTime(message.occurred_at, locale)}`}
          </span>
        ) : null}
      </figcaption>
      {message.from ? (
        <p dir="ltr" className="mt-1 truncate text-xs text-fg-muted">{message.from}</p>
      ) : null}
      {message.subject ? (
        <p className="mt-0.5 truncate text-sm font-medium text-fg">{message.subject}</p>
      ) : null}
      {message.body ? (
        <blockquote className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-fg-muted">
          {message.body}
        </blockquote>
      ) : null}
    </figure>
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
