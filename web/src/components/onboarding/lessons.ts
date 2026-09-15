import type { TourStep } from "@/lib/tour";

/**
 * THE FIRST-RUN DOOR'S FIVE LESSONS (M54 — "teach you how to work in
 * different parts").
 *
 * Each lesson is the existing tour mechanism (lib/tour.ts: dim the screen,
 * ring ONE real control, say a sentence beside it) pointed at a control that
 * carries a `data-tour` attribute — a declared, greppable contract, never a
 * selector into somebody else's markup. The five targets are on the real
 * buttons: `meetings-new`, `home-composer`, `board-add`, `invite-people`,
 * `integrations-shelf`. Delete one of those attributes and the overlay skips
 * the step out loud rather than trapping the person under the dim.
 *
 * ── VIDEOS ────────────────────────────────────────────────────────────────
 *
 * The reference plays a short screen recording per choice. There are no
 * recordings yet, and a slot that pretends otherwise is the thing this repo
 * refuses to ship — so the door draws the lesson's illustration and says a
 * video is coming. When a recording exists, put its URL here (a file under
 * `public/onboarding/`, or a hosted MP4) and the door plays it instead. The
 * test asserts the slot renders a `<video>` only when a URL is present.
 */
export const LESSONS = ["meeting", "ask", "tasks", "team", "connect"] as const;
export type Lesson = (typeof LESSONS)[number];

export const ONBOARDING_VIDEOS: Readonly<Record<Lesson, string | null>> = {
  meeting: null,
  ask: null,
  tasks: null,
  team: null,
  connect: null,
};

/** the lesson's one stop: where to go and what to ring; `t` localises the sentence */
export function lessonSteps(lesson: Lesson, t: (key: string) => string): TourStep[] {
  switch (lesson) {
    case "meeting":
      return [{ href: "/meetings", target: "meetings-new", text: t("lessonMeeting1") }];
    case "ask":
      return [{ href: "/", target: "home-composer", text: t("lessonAsk1") }];
    case "tasks":
      return [{ href: "/tasks", target: "board-add", text: t("lessonTasks1") }];
    case "team":
      return [{ href: "/management/invitations", target: "invite-people", text: t("lessonTeam1") }];
    case "connect":
      return [{ href: "/integrations", target: "integrations-shelf", text: t("lessonConnect1") }];
  }
}
