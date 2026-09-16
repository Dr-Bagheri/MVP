import type { TourStep } from "@/lib/tour";
import { PRODUCT_DEMOS, type ProductDemoId } from "@/lib/productDemos";

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
 * Each lesson has a local film in both languages (lib/productDemos.ts).
 */
export const LESSONS = PRODUCT_DEMOS;
export type Lesson = ProductDemoId;

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
