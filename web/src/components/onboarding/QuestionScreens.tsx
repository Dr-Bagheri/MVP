"use client";

import { useTranslations } from "next-intl";
import { IconCalendar, IconFileText, IconMail, IconMic, IconPencil, IconSend, IconUsers } from "@/components/icons";
import { Chip, ChoiceCard, Lead, StepActions, Title } from "./bits";
import { OPTIONS, ready, toggle, type Answers } from "./steps";
import type { ScreenProps } from "./SetupScreens";

/**
 * THE FOUR QUESTIONS AND THE ONE PERMISSION — the split screens.
 *
 * Every answer is a key in the answers object and nothing more: the product
 * gates nothing on them (steps.ts). What they are FOR is the reference's own
 * reason — the person names what they came for, and the first-run door on
 * Home leads with it.
 */

export function WelcomeScreen({ name, answers, save, advance }: ScreenProps & { name: string }) {
  const t = useTranslations("onboarding");
  return (
    <>
      <Title>{t("welcomeTitle", { name })}</Title>
      <Lead>{t("welcomeLead")}</Lead>
      <div className="mt-8 flex flex-wrap gap-3">
        {OPTIONS.source.map((s) => (
          <Chip key={s} selected={answers.source === s} onClick={() => save({ source: s })}>
            {t(`src_${s}`)}
          </Chip>
        ))}
      </div>
      <StepActions onContinue={advance} ready={ready("welcome", answers)} />
    </>
  );
}

export function GoalsScreen({ answers, save, advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  return (
    <>
      <Title>{t("goalsTitle")}</Title>
      <Lead>{t("goalsLead")}</Lead>
      <div className="mt-8 flex flex-col gap-3">
        {OPTIONS.goals.map((g) => (
          <ChoiceCard
            key={g}
            selected={(answers.goals ?? []).includes(g)}
            onClick={() => save({ goals: toggle(answers.goals, g, OPTIONS.goals) })}
            title={t(`goal_${g}`)}
            line={t(`goal_${g}_line`)}
          />
        ))}
      </div>
      <StepActions onBack={back} onContinue={advance} ready={ready("goals", answers)} />
    </>
  );
}

export function WorkScreen({ answers, save, advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  return (
    <>
      <Title>{t("workTitle")}</Title>
      <Lead>{t("workLead")}</Lead>
      <div className="mt-6 flex flex-wrap gap-3">
        {OPTIONS.work.map((w) => (
          <Chip key={w} selected={answers.work === w} onClick={() => save({ work: w })}>
            {t(`work_${w}`)}
          </Chip>
        ))}
      </div>
      <p className="mt-8 text-base text-fg-muted">{t("levelLead")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        {OPTIONS.level.map((l) => (
          <Chip key={l} selected={answers.level === l} onClick={() => save({ level: l })}>
            {t(`level_${l}`)}
          </Chip>
        ))}
      </div>
      <StepActions onBack={back} onContinue={advance} ready={ready("work", answers)} />
    </>
  );
}

const PLACE_ICON: Record<(typeof OPTIONS.places)[number], React.ReactNode> = {
  meetings: <IconMic width={14} height={14} />,
  email: <IconMail width={14} height={14} />,
  chat: <IconSend width={14} height={14} />,
  docs: <IconFileText width={14} height={14} />,
  notes: <IconPencil width={14} height={14} />,
  code: <span aria-hidden className="text-xs font-semibold">{"</>"}</span>,
  calendar: <IconCalendar width={14} height={14} />,
  other: <IconUsers width={14} height={14} />,
};

export function PlacesScreen({ answers, save, advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  return (
    <>
      <Title>{t("placesTitle")}</Title>
      <Lead>{t("placesLead")}</Lead>
      <div className="mt-8 flex flex-wrap gap-3">
        {OPTIONS.places.map((p) => (
          <Chip
            key={p}
            icon={PLACE_ICON[p]}
            selected={(answers.places ?? []).includes(p)}
            onClick={() => save({ places: toggle(answers.places, p, OPTIONS.places) })}
          >
            {t(`place_${p}`)}
          </Chip>
        ))}
      </div>
      <StepActions onBack={back} onContinue={advance} ready={ready("places", answers)} />
    </>
  );
}

export function DataScreen({ answers, save, advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  const pick = (v: NonNullable<Answers["voiceprint"]>) => save({ voiceprint: v });
  return (
    <>
      <Title>{t("dataTitle")}</Title>
      <div className="mt-8 flex flex-col gap-3">
        <ChoiceCard selected={answers.voiceprint === "keep"} onClick={() => pick("keep")} title={t("data_keep")} line={t("data_keep_line")} />
        <ChoiceCard selected={answers.voiceprint === "none"} onClick={() => pick("none")} title={t("data_none")} line={t("data_none_line")} />
      </div>
      {/* CONSEQUENCE — where the choice can be changed, and the one promise
          the product can make about the data (it trains nothing) */}
      <p className="mt-4 text-sm leading-6 text-fg-muted">{t("dataFoot")}</p>
      <StepActions onBack={back} onContinue={advance} ready={ready("data", answers)} />
    </>
  );
}
