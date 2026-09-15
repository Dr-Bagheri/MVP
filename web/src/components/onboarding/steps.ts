/**
 * THE FIRST-TIME FLOW'S SHAPE (M54, 2026-09-15 — user directive: "a first
 * time user that comes in to have good experience … it personalizes it for
 * you, gets you connected and teaches you how to work in different parts").
 *
 * Five STAGES in a rail across the top, eleven STEPS under them, in the
 * reference's own order (sign up → permissions → set up → learn →
 * personalize). The rail is what a person reads to know how much is left;
 * the steps are what they answer.
 *
 * Pure: no React, no network. The component reads this table and the answers
 * object; tests read it too, which is how "the rail's progress equals the
 * steps done" can be asserted without rendering a thing.
 *
 * ── The answers ───────────────────────────────────────────────────────────
 *
 * Everything a step learns is a key in ONE object that PATCH /v1/me/onboarding
 * MERGES (db/0223) — a step sends only what it asked, a reload resumes from
 * `answers.step`, and nothing here gates anything on the server. The keys are
 * named here rather than typed per step because the server stores a jsonb
 * and the client is the only thing that knows what the words mean.
 */

export const STAGES = ["signup", "permissions", "setup", "learn", "personalize"] as const;
export type Stage = (typeof STAGES)[number];

export const STEP_IDS = [
  "welcome", "goals", "work", "places",
  "data", "mic",
  "languages", "hotkey",
  "dictate", "faster",
  "savings",
] as const;
export type StepId = (typeof STEP_IDS)[number];

/** which stage each step belongs to — the rail lights the stage of the step on screen */
export const STEP_STAGE: Readonly<Record<StepId, Stage>> = {
  welcome: "signup",
  goals: "signup",
  work: "signup",
  places: "signup",
  data: "permissions",
  mic: "permissions",
  languages: "setup",
  hotkey: "setup",
  dictate: "learn",
  faster: "learn",
  savings: "personalize",
};

export type Answers = {
  /** where the person is; the step to resume on reload */
  step?: StepId;
  source?: string;
  goals?: string[];
  work?: string;
  level?: string;
  places?: string[];
  /** "keep" = enrol a voiceprint later; "none" = never tie the voice to the name */
  voiceprint?: "keep" | "none";
  micOk?: boolean;
  micDevice?: string;
  languages?: string[];
  /** the push-to-talk key's `KeyboardEvent.code`, or null for "none chosen" */
  hotkey?: string | null;
  /** did a dictated word land in the lesson's box */
  dictated?: boolean;
  typingHoursPerDay?: number;
  /** the first-run door on Home: shown once, and what was chosen there */
  firstRunSeen?: boolean;
  firstRunChoice?: string;
  /** "skipped" when the person pressed «later» rather than finishing */
  skippedAt?: string;
}

export const OPTIONS = {
  source: ["search", "social", "friend", "event", "article", "ai", "other"],
  goals: ["meetings", "assistant", "tasks", "team"],
  work: [
    "founder", "manager", "product", "developer", "sales", "marketing", "operations",
    "support", "legal", "healthcare", "education", "student", "consultant", "other",
  ],
  level: ["executive", "director", "manager", "ic", "freelancer", "other"],
  places: ["meetings", "email", "chat", "docs", "notes", "code", "calendar", "other"],
  languages: ["fa", "en", "ar", "tr", "de", "fr", "es"],
} as const;

/** the figures behind «speaking can be N× faster» — an estimate, and labelled as one on the screen */
export const TYPING_WPM = 40;
export const SPEAKING_WPM = 150;
export const SPEED_RATIO = Math.round((SPEAKING_WPM / TYPING_WPM) * 10) / 10;

/** the slider's range on the savings step */
export const TYPING_HOURS = { min: 1, max: 8, default: 3 } as const;

/**
 * Hours a week saved for a given typing load: the typing hours a day that
 * become dictation, times five working days, minus the time the dictation
 * itself takes at the speed ratio. Rounded to a whole hour — a decimal here
 * would claim a precision the estimate does not have.
 */
export function hoursSavedPerWeek(typingHoursPerDay: number): number {
  const hours = Math.min(TYPING_HOURS.max, Math.max(TYPING_HOURS.min, typingHoursPerDay));
  return Math.round(hours * 5 * (1 - 1 / SPEED_RATIO));
}

export function stepIndex(id: StepId): number {
  return STEP_IDS.indexOf(id);
}

export function nextStep(id: StepId): StepId | null {
  const at = stepIndex(id);
  return at >= 0 && at < STEP_IDS.length - 1 ? STEP_IDS[at + 1]! : null;
}

export function prevStep(id: StepId): StepId | null {
  const at = stepIndex(id);
  return at > 0 ? STEP_IDS[at - 1]! : null;
}

/** 0..1 — the share of steps already answered; the bar under the rail */
export function progress(id: StepId): number {
  return stepIndex(id) / STEP_IDS.length;
}

/** where to resume: the saved step when it is a real one, the first otherwise */
export function resumeStep(answers: Answers | undefined): StepId {
  const saved = answers?.step;
  return saved !== undefined && (STEP_IDS as readonly string[]).includes(saved) ? saved : STEP_IDS[0];
}

/**
 * Whether «Continue» is live on a step. The reference greys the button until
 * a choice is made on the question steps; the rest are always continuable
 * because their control IS the choice (the microphone's «yes», the hotkey's
 * «yes») or there is nothing to choose.
 */
export function ready(id: StepId, answers: Answers): boolean {
  switch (id) {
    case "welcome": return typeof answers.source === "string";
    case "goals": return (answers.goals?.length ?? 0) > 0;
    case "work": return typeof answers.work === "string";
    case "places": return (answers.places?.length ?? 0) > 0;
    case "data": return answers.voiceprint === "keep" || answers.voiceprint === "none";
    case "languages": return (answers.languages?.length ?? 0) > 0;
    default: return true;
  }
}

/** toggle a value in a multi-select answer, keeping the option order stable */
export function toggle(list: readonly string[] | undefined, value: string, order: readonly string[]): string[] {
  const set = new Set(list ?? []);
  if (set.has(value)) set.delete(value); else set.add(value);
  return order.filter((v) => set.has(v));
}
