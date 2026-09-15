"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { Overlay } from "@/components/platform/Overlay";
import { IconCalendar, IconMic, IconRows, IconSparkle, IconUsers } from "@/components/icons";
import { DIALOG_BODY } from "@/components/platform/tasks/panelStyle";
import { startTour } from "@/lib/tour";
import { LESSONS, ONBOARDING_VIDEOS, lessonSteps, type Lesson } from "./lessons";
import { SceneConversation, SceneDesk, SceneFrames, ScenePeople, SceneLock } from "./Illustrations";

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
 * The preview is a VIDEO when one exists for the lesson and the lesson's
 * illustration when it does not (ONBOARDING_VIDEOS). There is no third
 * state: a door that plays nothing while looking like it should is the
 * thing this repo refuses to ship.
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

function preview(lesson: Lesson) {
  switch (lesson) {
    case "meeting": return <SceneConversation />;
    case "ask": return <SceneFrames />;
    case "tasks": return <SceneDesk />;
    case "team": return <ScenePeople />;
    case "connect": return <SceneLock />;
  }
}

/** whether the door opens for this person — pure, so the test can ask it */
export function firstRunDue(me: Me | null | undefined): boolean {
  if (!me) return false;
  if (me.onboarding_completed_at === undefined || me.onboarding_completed_at === null) return false;
  return me.onboarding?.firstRunSeen !== true;
}

export function FirstRunDoor() {
  const t = useTranslations("onboarding");
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Lesson>("meeting");

  useEffect(() => {
    let live = true;
    void api.me().then((me) => { if (live && firstRunDue(me)) setOpen(true); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  if (!open) return null;

  const close = (chosen: Lesson | null) => {
    setOpen(false);
    /* recorded either way — «later» is an answer too, and a door that
       reopens until pressed is a nag */
    void api.updateOnboarding({
      answers: { firstRunSeen: true, ...(chosen ? { firstRunChoice: chosen } : {}) },
    }).catch(() => undefined);
    if (chosen) startTour(lessonSteps(chosen, t));
  };

  const video = ONBOARDING_VIDEOS[choice];

  return (
    <Overlay onClose={() => close(null)} label={t("firstRunTitle")} size="xl">
      {/* DIALOG_BODY is the scroll box and the section rhythm; it is NOT a flex
          row, so the two halves are made one here — the first deploy showed
          them stacked, the preview under the fold (read on production, not
          in a test: jsdom lays nothing out) */}
      <div className={`${DIALOG_BODY} flex flex-col gap-6 md:flex-row md:divide-y-0 md:gap-8 [&>*]:py-0`}>
        <div className="flex flex-col md:w-2/5">
          <h2 className="text-2xl font-bold text-fg">{t("firstRunTitle")}</h2>
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
            <button type="button" className="btn btn-primary" onClick={() => close(choice)}>
              {t("firstRunTry")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => close(null)}>
              {t("firstRunLater")}
            </button>
          </div>
        </div>
        <div className="well flex min-h-64 flex-1 flex-col items-center justify-center p-6">
          {video !== null ? (
            <video className="w-full rounded-xl" controls preload="metadata" src={video} />
          ) : (
            <>
              <div className="w-full max-w-sm text-fg">{preview(choice)}</div>
              <p className="mt-3 text-xs text-fg-muted">{t("firstRunVideoSoon")}</p>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}
