"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { Overlay } from "@/components/platform/Overlay";
import { IconCalendar, IconMic, IconRows, IconSparkle, IconUsers } from "@/components/icons";
import { DIALOG_BODY } from "@/components/platform/tasks/panelStyle";
import { startTour } from "@/lib/tour";
import { LESSONS, lessonSteps, type Lesson } from "./lessons";
import { ProductDemo } from "./ProductDemo";

/**
 * «HOW WOULD YOU LIKE TO USE NEURAI FIRST?» — the reference's last screen,
 * on Home, ONCE (M54).
 *
 * Five choices on the start side, a preview on the end side, one button:
 * «try it now» closes this and starts the chosen LESSON — the existing tour
 * mechanism ringing the real control (lessons.ts). «later» closes it too.
 * Either way the answer is saved with the person's onboarding, so the door
 * does not open again on the next visit or the next device.
 *
 * Every lesson includes a shipped, localized film with illustrative data.
 * Watching a film never records, invites, authorizes, or spends an AI call.
 *
 * Rendered only for a member whose flow is FINISHED (`onboarding_completed_at`
 * set) and who has not seen this — a person mid-flow is on /onboarding, not
 * here, and an un-migrated deployment (absent stamp) has no door at all.
 */
const LESSON_ICON: Record<Lesson, React.ReactNode> = {
  meeting: <IconMic width={16} height={16} />,
  ask: <IconSparkle width={16} height={16} />,
  tasks: <IconRows width={16} height={16} />,
  team: <IconUsers width={16} height={16} />,
  connect: <IconCalendar width={16} height={16} />,
};

/** whether the door opens for this person — pure, so the test can ask it */
export function firstRunDue(me: Me | null | undefined): boolean {
  if (!me) return false;
  if (me.onboarding_completed_at === undefined || me.onboarding_completed_at === null) return false;
  return me.onboarding?.firstRunSeen !== true;
}

/**
 * THE DOOR REOPENED OVER THE LESSON IT HAD JUST STARTED (user report,
 * 2026-09-16: "when the help appears and I asked it to guide me for Gmail,
 * it comes in front again"). `close()` sends the answer and starts the tour
 * in the same breath, and the Gmail lesson's first stop is `/integrations`,
 * which redirects into Home's own pane — so Home REMOUNTS, this door mounts
 * with it and asks `api.me()` again, and the read cache (60 s) answers with
 * the identity read BEFORE the answer was sent. The PATCH had not even
 * responded; the cache could not know. The four other lessons land on pages
 * that do not carry this door, which is why only Gmail showed it.
 *
 * So the answer is remembered in this TAB the moment it is given, and a
 * remount asks the latch before it asks the server. `sessionStorage` rather
 * than a module variable: a reload mid-lesson is the same tab and the same
 * answer, while a new tab or another device asks the server, which by then
 * holds the row. A write that failed leaves the server unmarked and the next
 * tab asks again — the honest outcome for a door that must not nag.
 */
const ANSWERED_KEY = "neurai.firstRunAnswered";
function answeredHere(): boolean {
  try { return sessionStorage.getItem(ANSWERED_KEY) === "1"; } catch { return false; }
}
function rememberAnswered(): void {
  try { sessionStorage.setItem(ANSWERED_KEY, "1"); } catch { /* private mode: the server's row is the memory */ }
}

export function FirstRunDoor() {
  const t = useTranslations("onboarding");
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Lesson>("meeting");

  useEffect(() => {
    if (answeredHere()) return;
    let live = true;
    void api.me().then((me) => { if (live && firstRunDue(me)) setOpen(true); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  if (!open) return null;

  const close = (chosen: Lesson | null) => {
    setOpen(false);
    rememberAnswered();
    /* recorded either way — «later» is an answer too, and a door that
       reopens until pressed is a nag */
    void api.updateOnboarding({
      answers: { firstRunSeen: true, ...(chosen ? { firstRunChoice: chosen } : {}) },
    }).catch(() => undefined);
    if (chosen) startTour(lessonSteps(chosen, t));
  };

  return (
    <Overlay onClose={() => close(null)} label={t("firstRunTitle")} size="xl">
      {/* DIALOG_BODY is the scroll box and the section rhythm; it is NOT a flex
          row, so the two halves are made one here — the first deploy showed
          them stacked, the preview under the fold (read on production, not
          in a test: jsdom lays nothing out) */}
      <div className={`${DIALOG_BODY} flex flex-col gap-6 md:flex-row md:divide-y-0 md:gap-8 [&>*]:py-0`}>
        <div className="flex flex-col md:w-2/5">
          <h2 className="h-page">{t("firstRunTitle")}</h2>
          <div className="mt-6 flex flex-col gap-2" role="radiogroup" aria-label={t("firstRunTitle")}>
            {LESSONS.map((lesson) => (
              <button
                key={lesson}
                type="button"
                role="radio"
                aria-checked={choice === lesson}
                onClick={() => setChoice(lesson)}
                className={`btn justify-start gap-2 ${choice === lesson ? "bg-accent-soft text-accent ring-1 ring-accent" : "bg-surface-2 text-fg hover:bg-border"}`}
              >
                {LESSON_ICON[lesson]}
                {t(`firstRun_${lesson}`)}
              </button>
            ))}
          </div>
          <div className="mt-auto flex flex-wrap gap-2 pt-8">
            <button type="button" className="btn-primary" onClick={() => close(choice)}>
              {t("firstRunTry")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => close(null)}>
              {t("firstRunLater")}
            </button>
          </div>
        </div>
        <div className="well flex min-w-0 flex-1 flex-col items-center justify-center p-3">
          <ProductDemo lesson={choice} />
        </div>
      </div>
    </Overlay>
  );
}
