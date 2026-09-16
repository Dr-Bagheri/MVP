"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { personName } from "@/lib/format";
import { notifyError } from "@/lib/notify";
import { OnboardingFrame, type Layout } from "./OnboardingFrame";
import { SceneClock, SceneLock } from "./Illustrations";
import { ProductDemo } from "./ProductDemo";
import { DataScreen, GoalsScreen, PlacesScreen, WelcomeScreen, WorkScreen } from "./QuestionScreens";
import { DictateScreen, FasterPicture, FasterScreen, HotkeyScreen, LanguagesScreen, MicScreen, SavingsScreen } from "./SetupScreens";
import { nextStep, prevStep, resumeStep, type Answers, type StepId } from "./steps";

/**
 * THE FIRST-TIME FLOW (M54, 2026-09-15).
 *
 * User directive: "a first time user that comes in to have good experience
 * when they start to work with it … it personalizes it for you, gets you
 * connected and teaches you how to work in different parts."
 *
 * The reference (Wispr Flow's web onboarding) is followed step for step in
 * SHAPE — the five-stage rail, a question a screen, the picture beside it,
 * the centred cards for the microphone / language / key tests, the message
 * lesson, the speed figures, the savings slider — and
 * every question is OURS: what the product does (meetings, the assistant,
 * tasks, the room), the one permission the product actually holds (a voice
 * signature), and the key the product actually uses (push-to-talk).
 *
 * ── Saving as it goes ─────────────────────────────────────────────────────
 *
 * Every answer is PATCHed the moment it is given (db/0223 merges), and the
 * step is saved with each Continue, so a closed tab resumes where it was and
 * a reload loses nothing. The stamp lands once, on «start working» or on
 * «later» — and the shell stops sending the person here the moment it has.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * No recording lesson that writes a record, no assistant lesson that spends
 * a model call: a first-time flow that writes into the workspace it is
 * introducing is the 2026-09-06 lesson waiting to happen. The recording and
 * the assistant are TAUGHT by the first-run door on Home, which rings the
 * real controls and lets the person press them.
 */
const LAYOUT: Readonly<Record<StepId, Layout>> = {
  welcome: "split",
  goals: "split",
  work: "split",
  places: "split",
  data: "split",
  mic: "centred",
  languages: "centred",
  hotkey: "centred",
  dictate: "centred",
  /* the two «look what you get» screens are split screens like the
     questions (2026-09-16) — the reference's dark stage is gone */
  faster: "split",
  savings: "split",
};

export function Onboarding() {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [step, setStep] = useState<StepId | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  /* the stamp is written ONCE — a double press on «start working» must not
     race two completions into two navigations */
  const ending = useRef(false);

  useEffect(() => {
    let live = true;
    void api.me().then((identity) => {
      if (!live) return;
      if (!identity) { router.replace("/sign-in"); return; }
      /* finished, or a deployment with no flow (absent stamp) → home. `===
         null` is the one state this screen exists for. */
      if (identity.onboarding_completed_at !== null) { router.replace("/"); return; }
      const saved = (identity.onboarding ?? {}) as Answers;
      setAnswers(saved);
      setStep(resumeStep(saved));
      setMe(identity);
    }).catch(() => { if (live) router.replace("/"); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read, on mount
  }, []);

  /** the local answer lands at once; the server merges it behind */
  const save = useCallback((patch: Answers) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
    void api.updateOnboarding({ answers: patch }).catch(() => notifyError(t("saveFailed")));
  }, [t]);

  const go = useCallback((next: StepId) => {
    setStep(next);
    save({ step: next });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, [save]);

  const finish = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    try {
      await api.updateOnboarding({ complete: true });
    } catch {
      /* the stamp did not land — the shell will send them back next time,
         which is the honest outcome; the person still gets to the product */
      notifyError(t("saveFailed"));
    }
    router.replace("/");
  }, [router, t]);

  const skipAll = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    try {
      await api.updateOnboarding({ answers: { skippedAt: new Date().toISOString() }, complete: true });
    } catch {
      notifyError(t("saveFailed"));
    }
    router.replace("/");
  }, [router, t]);

  const advance = useCallback(() => {
    if (step === null) return;
    const next = nextStep(step);
    if (next !== null) go(next);
    else void finish();
  }, [step, go, finish]);

  const back = useCallback(() => {
    if (step === null) return;
    const prev = prevStep(step);
    if (prev !== null) go(prev);
  }, [step, go]);

  if (step === null || me === null) return null;

  const props = { answers, save, advance, back };
  const picture =
    step === "welcome" ? <ProductDemo lesson="meeting" />
      : step === "goals" ? <ProductDemo lesson="ask" />
        : step === "work" ? <ProductDemo lesson="team" />
          : step === "places" ? <ProductDemo lesson="tasks" />
            : step === "data" ? <SceneLock />
              : step === "faster" ? <FasterPicture />
                : step === "savings" ? <SceneClock />
                  : null;

  return (
    <OnboardingFrame step={step} layout={LAYOUT[step]} picture={picture}>
      {/* «later» — the way out, on every screen: a flow with no exit is a wall */}
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-sm text-fg-muted hover:text-fg"
          onClick={() => void skipAll()}
        >
          {t("skipAll")}
        </button>
      </div>
      {step === "welcome" ? <WelcomeScreen {...props} name={personName(me, locale) || me.email.split("@")[0] || ""} />
        : step === "goals" ? <GoalsScreen {...props} />
          : step === "work" ? <WorkScreen {...props} />
            : step === "places" ? <PlacesScreen {...props} />
              : step === "data" ? <DataScreen {...props} />
                : step === "mic" ? <MicScreen {...props} />
                  : step === "languages" ? <LanguagesScreen {...props} />
                    : step === "hotkey" ? <HotkeyScreen {...props} />
                      : step === "dictate" ? <DictateScreen {...props} />
                        : step === "faster" ? <FasterScreen {...props} />
                          : <SavingsScreen {...props} finish={() => void finish()} />}
    </OnboardingFrame>
  );
}
