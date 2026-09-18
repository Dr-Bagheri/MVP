"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { DueAlarmItem } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { ConfirmDialog } from "@/components/rowActions";
import { formatDate, formatTime } from "@/lib/format";
import { notify } from "@/lib/notify";
import { visiblePoll } from "@/lib/visiblePoll";

/**
 * THE ALARM POP-UP (user directive, 2026-09-18: "a page in settings that you
 * can set a time for alarm that gives you a notification pop up in the
 * platform … also if you have a task that is near its deadline or if you have
 * an upcoming meeting it alarms you … if someone added you for an upcoming
 * meeting it shows you half an hour before").
 *
 * It is the meeting-invitation gate's shape on purpose — the platform's one
 * question box, in the shell, so that the answer to "while I am working" and
 * "the moment I sign in" is one mechanism rather than two. What it is NOT is
 * a toast: a toast on a timer is how an alarm gets missed by somebody who
 * looked away, and this is the one message in the product whose whole job is
 * to be seen.
 *
 * ── the server decides everything; this file decides nothing ──────────────
 *
 * Which alarms are due, how early each kind speaks, and what an
 * acknowledgement is keyed on are all core's (see api/reminders.ts). A
 * browser that computed "is this within thirty minutes" would be a second
 * clock, and the two would disagree the first time somebody's laptop was
 * wrong — which is exactly the failure an alarm cannot have.
 *
 * ── ONE AT A TIME, soonest first ──────────────────────────────────────────
 *
 * Three alarms arriving together is a plausible morning, and three stacked
 * dialogs is a wall of boxes to click through. The queue is the server's own
 * ordering; answering one shows the next.
 *
 * ── acknowledging is a WRITE, and that is the point ───────────────────────
 *
 * «باشه» tells the server, so the alarm is gone on every device rather than
 * on this one. Remembering it in the browser would mean a reminder dismissed
 * on a phone ringing again on a laptop, and a platform that repeats an alarm
 * you answered is one people learn to close without reading.
 */

/**
 * Once a minute, and only while the tab is on screen.
 *
 * An alarm is the one read in this product where a minute of staleness is the
 * feature degrading rather than a saving, which is why it is faster than the
 * invitation gate's two minutes — and why the client does NOT put this read
 * through its five-second burst cache. `visiblePoll` still means a hidden tab
 * asks nothing: it cannot show the dialog it would be polling for, and coming
 * back runs once, at once, which is the moment a person would want to know.
 */
export const ALARM_POLL_MS = 60_000;

export function AlarmGate() {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const router = useRouter();
  const [queue, setQueue] = useState<DueAlarmItem[]>([]);
  const [busy, setBusy] = useState(false);

  const look = useCallback(() => {
    /*
     * Asked from INSIDE a promise, which is not defensive style but a recorded
     * fix: this component mounts in the SHELL, so every page test in the
     * product renders it with whatever api mock that page happens to carry.
     * A mock without `dueAlarms` does not fake "no alarms" — calling undefined
     * throws synchronously in the effect and takes the whole page down, and
     * the failure arrives as whatever rendered last (2026-09-16, the
     * verification banner, same mount point, same lesson).
     */
    void Promise.resolve()
      .then(() => api.dueAlarms())
      .then((r) => setQueue(r.alarms))
      /* silent: a failed poll is not an alarm, and a toast every minute on a
         flaky connection would be worse than the thing it is reporting. The
         next tick asks again. */
      .catch(() => {});
  }, []);

  useEffect(() => { look(); }, [look]);
  useEffect(() => visiblePoll(look, ALARM_POLL_MS), [look]);

  const current = queue[0];
  if (current === undefined) return null;

  const answer = (go: boolean) => {
    if (busy) return;
    setBusy(true);
    void api
      .ackAlarm(current.key)
      /* the queue moves on either way: the person has SEEN this one, and an
         alarm that stays on screen because a write failed is an alarm that
         cannot be closed */
      .catch(() => notify(t("ackFailed"), "warn"))
      .finally(() => {
        setQueue((rest) => rest.slice(1));
        setBusy(false);
        if (!go) return;
        if (current.task_id !== undefined) router.push(`/tasks?task=${encodeURIComponent(current.task_id)}`);
        else if (current.meeting_id !== undefined) router.push(`/meetings/${encodeURIComponent(current.meeting_id)}`);
      });
  };

  /* WHICH nothing each kind is, in its own words: "your meeting starts soon"
     and "this task is due" are different sentences, and one generic
     «یادآوری» for all three would make the pop-up tell a person they have
     been woken and nothing else. */
  const heading = current.kind === "meeting" ? t("meetingTitle")
    : current.kind === "task" ? t("taskTitle")
    : t("customTitle");

  /* the moment it is ABOUT, in the platform's own zone and calendar — the
     same two formatters every other time on this platform reads through */
  const when = `${formatDate(current.at, locale)} · ${formatTime(current.at, locale)}`;

  return (
    <ConfirmDialog
      title={heading}
      body={
        <div className="space-y-1.5 text-sm text-fg-muted">
          <p className="font-semibold text-fg">{current.label}</p>
          <p>{when}</p>
        </div>
      }
      danger={false}
      busy={busy}
      /* a CUSTOM alarm has nowhere to go — it is words the person wrote — so
         it gets one button. The other two open the thing they are about,
         which is the only useful next act. */
      confirmLabel={current.kind === "custom" ? t("ok") : t("open")}
      /* the corner X on a custom alarm reads this too (ConfirmDialog uses
         cancelLabel as its label), so it must not be the confirm's own word —
         two buttons named «باشه» is a box a screen reader cannot describe */
      cancelLabel={current.kind === "custom" ? t("close") : t("ok")}
      hideCancel={current.kind === "custom"}
      onConfirm={() => answer(current.kind !== "custom")}
      onCancel={() => answer(false)}
    />
  );
}
