"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { JoinInviteRecord } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { ConfirmDialog } from "@/components/rowActions";
import { formatDate } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { visiblePoll } from "@/lib/visiblePoll";

/**
 * A MEETING INVITATION ASKS, RATHER THAN WAITING TO BE FOUND (user directive,
 * 2026-09-07: "when you invite someone it must come up as a pop-up window
 * with the same theme style as delete in the users pages, at the moment they
 * have been added — if they are not logged in, when they log in it will come
 * up. Also it has to be at the notification too, that we already covered").
 *
 * db/0202 already mints the invitation in the same act that adds somebody to a
 * meeting, and the bell already renders it with accept and decline. What was
 * missing is the ASK: a badge on an icon is a thing you find, and being told
 * about a meeting is a thing that should find you — most of all when the
 * meeting is today and the notification is behind a bell you have not looked
 * at since this morning.
 *
 * WHERE IT APPEARS is the shell, so the answer to "at the moment they have
 * been added" and "when they log in" is the same mechanism: this asks on
 * mount, which covers the sign-in, and again on the refresh bus and a slow
 * poll, which covers the person already sitting in the product.
 *
 * WHAT IT IS NOT is a nag. «بعداً» closes it and this tab does not ask again
 * — the invitation is still in the bell, unanswered, because closing a
 * question is not answering it (the bell's own rule, 2026-09-04). It comes
 * back on the next sign-in, which is the point at which somebody who has
 * forgotten should be reminded.
 */
const DISMISSED = "neurai-invite-dismissed";

/**
 * Two minutes, and only while the tab is on screen. It was thirty seconds in
 * every open tab, visible or not: 4,276 reads of /v1/invites in three days on
 * production, eleven times the next route, most of them from tabs nobody was
 * looking at — and a hidden tab cannot show the dialog it is polling for.
 * Two minutes is still "at the moment they have been added" for a courtesy
 * on top of the bell; the refresh bus covers the person's own writes at once.
 */
export const INVITE_POLL_MS = 120_000;

function dismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED);
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
  } catch {
    return new Set();
  }
}

function dismiss(id: string): void {
  try {
    const all = dismissed();
    all.add(id);
    sessionStorage.setItem(DISMISSED, JSON.stringify([...all]));
  } catch {
    /* a private window just means it asks again next navigation, which is
       the harmless direction */
  }
}

export function MeetingInviteGate() {
  const t = useTranslations("presence");
  const locale = useLocale();
  const router = useRouter();
  const epoch = useRefreshEpoch("invitations");
  const [invite, setInvite] = useState<JoinInviteRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const look = useCallback(() => {
    void api.invites()
      .then((rows) => {
        const skip = dismissed();
        /* MEETINGS only: a chat room invitation is an ordinary piece of news
           and the bell is the right place for it. A meeting has a TIME, and
           the cost of missing it is not symmetrical. */
        const next = rows.find((row) => row.kind === "meeting" && !skip.has(row.id));
        setInvite(next ?? null);
      })
      .catch(() => { /* a failed read is not an invitation */ });
  }, []);

  useEffect(look, [look, epoch]);

  /* the person already in the product when somebody adds them: slow, only
     while this tab is on screen, and a courtesy on top of the bell rather
     than the record of it (INVITE_POLL_MS carries the measurement) */
  useEffect(() => visiblePoll(look, INVITE_POLL_MS), [look]);

  if (invite === null) return null;

  const answer = (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    void api.respondToInvite(invite.id, accept)
      .then((done) => {
        setInvite(null);
        /* ACCEPT GOES THERE. An invitation grants no access — the meeting was
           always readable — so what accept buys is being taken to it, which
           is the whole feature. Declining stays put: "no" is not a request to
           go anywhere. The destination is the bell's own, because two
           spellings of one navigation is how they come to disagree. */
        if (accept) router.push(`/meetings/${encodeURIComponent(done.target_id)}`);
      })
      .catch(() => notify(t("inviteAnswerFailed"), "warn"))
      .finally(() => setBusy(false));
  };

  return (
    <ConfirmDialog
      title={t("meetingInviteTitle")}
      body={
        <div className="space-y-1.5 text-sm text-fg-muted">
          {/* the wire carries the meeting's TITLE and when the invitation was
              made, and nothing else — the bell renders the same two facts.
              Reaching for a start time here would be inventing a field: the
              meeting page is one press away and has all of them. */}
          <p className="font-semibold text-fg">{invite.target_title}</p>
          <p>{formatDate(invite.created_at, locale)}</p>
        </div>
      }
      /* the accepting answer is the confirm, and it is NOT danger — this box
         is the delete dialog's shape because that is the platform's one
         question box, not because saying yes to a meeting is destructive */
      danger={false}
      busy={busy}
      confirmLabel={t("meetingInviteAccept")}
      cancelLabel={t("meetingInviteLater")}
      alt={{ label: t("meetingInviteDecline"), onSelect: () => answer(false), danger: true }}
      onConfirm={() => answer(true)}
      onCancel={() => { dismiss(invite.id); setInvite(null); }}
    />
  );
}
