"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { MailDraft, MailSourceMessage } from "@/api/types";
import { ConfirmDialog } from "@/components/rowActions";
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
 * ── Where the sources sit ──────────────────────────────────────────────────
 *
 * A reply on its own asks somebody to approve a decision they cannot check
 * (user directive, 2026-08-28: "the draft must come like this already prepared
 * with the email on top of it as well" / "the sources when we do email reply
 * should look like this"). So the message being answered is presented as what
 * it is — the SOURCE the answer was written from — above the reply and outside
 * its card, collapsed to one line until asked for.
 *
 * It is fetched HERE rather than handed down: the product stores a reference,
 * not the person's mail, so reading the original is a live call to the
 * provider — one per card that is actually on screen, never one per row of a
 * list. A failure degrades to no source at all: the reply is the record, the
 * source is context, and an error banner over every draft would be noise about
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
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  /**
   * Discard asks first (the platform's destructive-action rule; see
   * `confirm.guard.test.ts`). SEND does not, and the difference is the point:
   * this whole card exists so the reply can be read before it goes, so the
   * press IS the considered act — a second box in front of it would be the
   * same question twice. Discarding is the one that cannot be taken back:
   * the row is decided forever, and the reply nobody kept is unrecoverable.
   */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [state, setState] = useState(draft);
  /** the message this answers; null while it is in flight or unreadable */
  const [source, setSource] = useState<MailSourceMessage | null>(null);

  useEffect(() => {
    let live = true;
    void api.mailDraftSource(draft.id)
      .then((message) => { if (live) setSource(message); })
      /* the provider refused, the message is gone, or the shape was
         unreadable — all of which mean the same thing to a reader: there is
         no source to show. The draft itself is unaffected. */
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
      {source ? <SourcePanel message={source} locale={locale} /> : null}

      <article className="card overflow-hidden p-0">
        {/*
          The header names WHO is speaking and in what state. The mark is
          tinted rather than outlined so the card reads as one object from a
          distance instead of three stacked rules.
        */}
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            <MailMark />
          </span>
          <span className="text-sm font-medium text-fg">
            {t(state.status === "sent" ? "sentLabel" : state.status === "discarded" ? "discardedLabel" : "draftLabel")}
          </span>
          {state.in_provider ? (
            /*
             * Discarding marks OUR row; it does not reach into the person's
             * mailbox, where the draft is still sitting. Saying "also in your
             * Drafts folder" over a discarded reply would leave the product
             * and the mailbox telling two different stories, so the discarded
             * case says the true thing instead — the deletion is theirs to
             * make, in the place the draft actually lives.
             */
            <span className="ms-auto inline-flex items-center gap-1 text-xs text-fg-subtle">
              {state.status === "discarded" ? null : <CheckMark />}
              {t(state.status === "discarded" ? "stillInMailbox" : "inMailbox")}
            </span>
          ) : null}
        </header>

        {/*
          Recipient and subject as a mail HEAD, not a definition list: the two
          facts a person checks before pressing send are the address and the
          subject line, and they should be readable in one glance rather than
          in two labelled rows. The address keeps `dir="ltr"` — an email
          address is Latin text inside a Persian page and reverses without it.
        */}
        <div className="px-4 pt-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-fg-subtle">{t("to")}</span>
            <span dir="ltr" className="max-w-full truncate rounded-full bg-surface-2 px-2.5 py-1 font-medium text-fg-muted">
              {state.to_address}
            </span>
          </div>
          <h4 className="mt-2 text-[15px] font-semibold leading-6 text-fg">{state.subject}</h4>
        </div>

        <p className="whitespace-pre-wrap px-4 pb-4 pt-2 text-sm leading-7 text-fg-muted">{state.body}</p>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2/50 px-4 py-3">
          <span className="text-xs text-fg-subtle">
            {decided ? t("decidedNote") : canSend ? t("editNote") : t("cannotSendNote")}
          </span>
          {/*
            2026-09-03: all three controls in this footer are the theme's
            compact size now. Every one of them had written its own geometry
            — `h-9 min-h-0 px-3 text-xs`, `h-9 min-h-0 gap-1.5 px-4 text-sm`,
            and a bare `tap h-9 rounded-lg` — and the first two wrote it ON
            TOP of `.btn-secondary` / `.btn-primary`, which is a hand-rolled
            control wearing the very class that exists to prevent one. Two
            things follow from that: the row stood at 36px where the
            platform's compact control is 34, and control.guard could not see
            any of it (no centring class to match, and the ones that had a
            `btn-` word are skipped by name), so this footer would have gone
            on being a twelfth size indefinitely.
            The state classes stay exactly as they were — `text-fg-muted
            hover:text-danger` is what discard LOOKS like, not how big it is
            — and discard keeps `.btn`'s bare face: no `.btn-ghost`, whose
            `hover:text-fg` would fight the danger tone at equal specificity.
          */}
          {decided ? null : !canSend ? (
            <Link href="/integrations" className="btn-secondary btn-sm">
              {t("connectToSend")}
            </Link>
          ) : (
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-sm text-fg-muted hover:text-danger"
                disabled={busy !== null}
                onClick={() => setConfirmDiscard(true)}
              >
                {t("discard")}
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy !== null}
                onClick={() => void act("send")}
              >
                {busy === "send" ? t("sending") : <><SendMark />{t("sendNow")}</>}
              </button>
            </span>
          )}
        </div>
      </article>

      {/* the platform's one destructive-action dialog. The body says the part
          a person cannot see from here: our row is decided, and the copy
          sitting in their own Drafts folder is not touched — the same true
          thing the discarded header says afterwards. */}
      {confirmDiscard ? (
        <ConfirmDialog
          title={t("discardTitle", { subject: state.subject })}
          body={t("discardBody")}
          confirmLabel={t("discard")}
          cancelLabel={tCommon("cancel")}
          busy={busy !== null}
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false);
            void act("discard");
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * What the reply was written from.
 *
 * The rules under the styling, in the order they mattered:
 *
 *  * this is somebody ELSE's text, so it never sits inside the reply's card
 *    and never wears the reply's ground — a quoted line that looks authored
 *    is a lie about who said it;
 *  * it opens COLLAPSED. The point of a source is that it can be checked, not
 *    that it is re-read: an inbox message pasted at full length above every
 *    draft pushes the thing the person is deciding on off the screen;
 *  * expanded, the body scrolls in its own box rather than being clipped,
 *    because a quote cut at an arbitrary line changes what the message said
 *    while looking complete.
 *
 * The provider can hand back empty strings when it cannot read a field. An
 * empty line is skipped rather than rendered as a labelled blank, which would
 * report "this message has no sender" — a claim we cannot make.
 */
function SourcePanel({ message, locale }: { message: MailSourceMessage; locale: string }) {
  const t = useTranslations("mail");
  const [open, setOpen] = useState(false);
  /* one source, always, today: the message this reply answers. The count is
     rendered from the list rather than written as "1" so the day a reply is
     drafted from two messages does not need this component edited. */
  const sources = [message];

  return (
    <section className="well mb-2 p-0">
      <button
        type="button"
        className="tap flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <SourceMark />
        <span className="text-xs font-medium text-fg-muted">{t("sources")}</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-fg-subtle">
          {sources.length}
        </span>
        <span className="ms-auto text-[11px] text-fg-subtle">{open ? t("hideSource") : t("showSource")}</span>
        <Chevron open={open} />
      </button>

      {sources.map((source, index) => (
        <div key={index} className="border-t border-border px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {source.subject ? (
              <span className="truncate text-sm font-medium text-fg">{source.subject}</span>
            ) : null}
            {source.occurred_at ? (
              <span className="text-[11px] text-fg-subtle">
                {`${formatRelativeDate(source.occurred_at, locale)} ${formatTime(source.occurred_at, locale)}`}
              </span>
            ) : null}
          </div>
          {source.from ? (
            <p dir="ltr" className="truncate text-xs text-fg-subtle">{source.from}</p>
          ) : null}
          {open && source.body ? (
            <blockquote className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap border-s-2 border-border-strong ps-3 text-sm leading-6 text-fg-muted">
              {source.body}
            </blockquote>
          ) : null}
        </div>
      ))}
    </section>
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

function SourceMark() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-fg-subtle" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M4.5 3.5h8l3 3v10h-11z" strokeLinejoin="round" />
      <path d="M12 3.5v3.5h3.5" strokeLinejoin="round" />
    </svg>
  );
}

function SendMark() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3.5 10 16.5 4l-4 12-2.5-5z" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-3.5 w-3.5 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`}
      fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden
    >
      <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
