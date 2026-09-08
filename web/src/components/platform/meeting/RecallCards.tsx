"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { IconClose, IconSparkle } from "@/components/icons";
import type { RecalledDecision } from "@/api/types";
import { digits, formatDate } from "@/lib/format";

/**
 * Item 7 — «this was already decided», on the host's stage and nowhere else.
 *
 * ── WHY IT IS THE HOST'S SCREEN ALONE ────────────────────────────────────
 *
 * Not a permission: a decision is readable by everybody who can read its
 * meeting, and the server enforces exactly that and no more. It is about
 * INTERRUPTION. A card that appears on ten screens mid-sentence is a
 * broadcast, and a wrong one is a public wrong statement that somebody has
 * to correct out loud. On the host's screen it is a private prompt they can
 * act on or ignore, which is what makes a high-recall feature survivable.
 *
 * ── AND WHY IT IS SILENT ─────────────────────────────────────────────────
 *
 * No sound, no toast, no motion beyond the arrival. The moment this thing
 * competes for attention it stops being a second brain and becomes a
 * notification, and a notification during a meeting is read once.
 */
export function RecallCards({ cards, onDismiss }: {
  cards: RecalledDecision[];
  onDismiss: (id: string) => void;
}) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  if (cards.length === 0) return null;

  return (
    /* absolutely placed over the stage's own corner: it must not push the
       board or the room, because a card arriving mid-stroke that reflows the
       canvas is worse than the card is good */
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex flex-col gap-2">
      {cards.map((card) => (
        <div key={card.id}
          className="card-row pointer-events-auto flex items-start gap-2.5 bg-surface/95 backdrop-blur">
          <span className="mt-0.5 text-accent" aria-hidden>
            <IconSparkle width={14} height={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-semibold text-fg-muted">
              {t("recallHeading")}
            </p>
            {/* the decision's own words. `line-clamp-2`: a long one must not
                grow into the stage it is sitting on */}
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.8] text-fg">{card.body}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-subtle">
              <Link href={`/meetings/${card.meeting_id}`} className="underline-offset-2 hover:underline">
                {card.meeting_title ?? t("recallUntitled")}
              </Link>
              <span aria-hidden>·</span>
              <span>{formatDate(card.decided_at, locale)}</span>
              {/* a decision that no longer stands is the MOST important one to
                  say so about: quoting a superseded decision back at a room is
                  the failure this whole ledger exists to prevent */}
              {card.status !== "standing" ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-fg-muted">
                    {t(`itemStatus_${card.status}`)}
                  </span>
                </>
              ) : null}
              <span aria-hidden>·</span>
              {/* the rule, shown: "shares 3 words" is a claim the host can
                  check against the card in front of them, where a relevance
                  score is a number nobody can argue with */}
              <span>{t("recallShared", { n: digits(card.shared, locale) })}</span>
            </p>
          </div>
          <button
            type="button"
            className="btn btn-icon border border-border text-fg-subtle hover:text-fg"
            aria-label={t("recallDismiss")}
            onClick={() => onDismiss(card.id)}
          >
            <IconClose width={12} height={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
