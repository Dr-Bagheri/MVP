"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Select } from "@/components/Select";
import { IconMic, IconPencil, IconPlus } from "@/components/icons";
import { digits } from "@/lib/format";
import { startMicMeter, type MicMeterState } from "@/lib/micMeter";
import { useDictation } from "@/lib/dictation";
import { isBindableKey, pushToTalkKey, pushToTalkLabel, pushToTalkServer, setPushToTalkKey, subscribePushToTalk } from "@/lib/pushToTalk";
import { usePushToTalk } from "@/lib/usePushToTalk";
import { useSyncExternalStore } from "react";
import { Chip, Lead, StepActions, Title } from "./bits";
import {
  OPTIONS, SPEED_RATIO, SPEAKING_WPM, TYPING_HOURS, TYPING_WPM, hoursSavedPerWeek, toggle,
  type Answers,
} from "./steps";
import { ScenePlane } from "./Illustrations";

/**
 * THE SET-UP AND LEARN SCREENS — the ones with a live control in the middle.
 *
 * Each is the product's OWN mechanism wearing the reference's card, never a
 * second implementation: the microphone bars are `startMicMeter` (the
 * enrolment panel's meter), the key is `pushToTalk` (the settings card's
 * binding and the composer's listener), the dictation is `useDictation` (the
 * composer's). A lesson that used a lookalike would teach a control that does
 * not exist.
 */

/** the number of bars in the microphone's meter — the reference's twelve */
const METER_BARS = 12;

/* ── the microphone ──────────────────────────────────────────────────────── */

export function MicScreen({ answers, save, advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const [level, setLevel] = useState(0);
  const [denied, setDenied] = useState(false);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [device, setDevice] = useState<string>(answers.micDevice ?? "");
  const [picking, setPicking] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  /* open the chosen microphone and meter it; a change of device reopens */
  useEffect(() => {
    let live = true;
    const open = async () => {
      stopRef.current?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (!navigator.mediaDevices?.getUserMedia) { setDenied(true); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: device ? { deviceId: { exact: device } } : true,
        });
        if (!live) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        setDenied(false);
        stopRef.current = startMicMeter(stream, (state: MicMeterState) => setLevel(state.level));
        /* labels are blank until a grant — refresh the list after it */
        if (navigator.mediaDevices.enumerateDevices) {
          const all = await navigator.mediaDevices.enumerateDevices();
          if (live) {
            setDevices(all.filter((d) => d.kind === "audioinput")
              .map((d, i) => ({ id: d.deviceId, label: d.label || `${t("micFallback")} ${digits(i + 1, locale)}` })));
          }
        }
      } catch {
        if (live) setDenied(true);
      }
    };
    void open();
    return () => {
      live = false;
      stopRef.current?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` and the locale are stable; the device is the input
  }, [device]);

  const lit = Math.round(level * METER_BARS);

  return (
    <>
      <Title>{t("micTitle")}</Title>
      <Lead>{t("micLead")}</Lead>
      <div className="card mt-8">
        <p className="text-base font-semibold text-fg">{t("micAsk")}</p>
        <div className="well mt-4 flex items-center justify-center gap-2 py-8" role="meter" aria-valuemin={0} aria-valuemax={METER_BARS} aria-valuenow={lit} aria-label={t("micDevice")}>
          {Array.from({ length: METER_BARS }, (_, i) => (
            <span
              key={i}
              data-lit={i < lit ? "1" : "0"}
              className={`block h-16 w-4 rounded-full transition-colors duration-100 ${i < lit ? "bg-accent" : "bg-surface-2"}`}
            />
          ))}
        </div>
        {denied ? <p role="alert" className="mt-3 text-sm text-danger">{t("micDenied")}</p> : null}
        {picking ? (
          <div className="mt-4">
            <Select
              ariaLabel={t("micDevice")}
              value={device}
              onChange={(next) => { setDevice(next); save({ micDevice: next }); }}
              options={devices.map((d) => ({ value: d.id, label: d.label }))}
              placeholder={t("micDevice")}
            />
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPicking((p) => !p)}>
            {t("micChange")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => { save({ micOk: true }); advance(); }}
          >
            {t("micYes")}
          </button>
        </div>
      </div>
      <StepActions onBack={back} />
    </>
  );
}

/* ── the languages ───────────────────────────────────────────────────────── */

export function LanguagesScreen({ answers, save, advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  /* the UI language is the first guess; a person who opened the Persian
     product speaks Persian, which is not a fact the reference had to guess */
  const chosen = answers.languages ?? [locale];
  const rest = OPTIONS.languages.filter((l) => !chosen.includes(l));

  return (
    <>
      <Title>{t("languagesTitle")}</Title>
      <Lead>{t("languagesLead")}</Lead>
      <div className="card mt-8">
        <p className="text-base font-semibold text-fg">{t("languagesSelected")}</p>
        <div className="well mt-4 flex flex-wrap items-center justify-center gap-2 py-8">
          {chosen.map((l) => (
            <Chip
              key={l}
              selected
              onClick={() => { const next = toggle(chosen, l, OPTIONS.languages); if (next.length > 0) save({ languages: next }); }}
            >
              {t(`lang_${l}`)}
            </Chip>
          ))}
          <button
            type="button"
            className="btn-secondary px-3"
            aria-label={t("languagesAdd")}
            aria-expanded={adding}
            onClick={() => setAdding((a) => !a)}
          >
            <IconPlus width={14} height={14} />
          </button>
        </div>
        {adding && rest.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {rest.map((l) => (
              <Chip key={l} selected={false} onClick={() => save({ languages: toggle(chosen, l, OPTIONS.languages) })}>
                {t(`lang_${l}`)}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="mt-6 flex justify-end">
          <button type="button" className="btn-primary" onClick={() => { if (answers.languages === undefined) save({ languages: chosen }); advance(); }}>
            {t("continue")}
          </button>
        </div>
      </div>
      <StepActions onBack={back} />
    </>
  );
}

/* ── the keyboard shortcut ───────────────────────────────────────────────── */

export function HotkeyScreen({ save, advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  const key = useSyncExternalStore(subscribePushToTalk, pushToTalkKey, pushToTalkServer);
  const [capturing, setCapturing] = useState(key === null);
  const [held, setHeld] = useState(false);
  const [refused, setRefused] = useState(false);

  /* the capture — the settings card's own rule: the first key struck is the
     key, unless it is one that writes */
  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.key === "Escape") { setCapturing(false); return; }
      if (!isBindableKey(event.code)) { setRefused(true); return; }
      setPushToTalkKey(event.code);
      save({ hotkey: event.code });
      setRefused(false);
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, save]);

  /* the test: the real listener, at a priority above every product surface,
     so a hold here lights the key and nothing else */
  usePushToTalk({
    onPress: () => setHeld(true),
    onRelease: () => setHeld(false),
    priority: 3,
    enabled: !capturing && key !== null,
  });

  const label = pushToTalkLabel(key);

  return (
    <>
      <Title>{t("hotkeyTitle")}</Title>
      <Lead>{t("hotkeyLead")}</Lead>
      <div className="card mt-8">
        <p className="text-base font-semibold text-fg">{t("hotkeyAsk")}</p>
        <div className="well mt-4 flex items-center justify-center gap-3 py-8">
          {capturing ? (
            <span className="text-base text-fg-muted" role="status">{t("hotkeyPress")}</span>
          ) : label === null ? (
            <span className="text-base text-fg-muted">{t("hotkeyNone")}</span>
          ) : (
            <kbd
              data-held={held ? "1" : "0"}
              className={`inline-flex min-h-control min-w-[4rem] items-center justify-center rounded-md px-4 text-lg font-semibold transition-colors ${
                held ? "bg-accent text-on-accent" : "bg-surface text-fg shadow-card"
              }`}
            >
              {label}
            </kbd>
          )}
        </div>
        {refused ? <p role="alert" className="mt-3 text-sm text-danger">{t("hotkeyRefused")}</p> : null}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { setRefused(false); setCapturing((c) => !c); }}
          >
            <IconPencil width={14} height={14} />
            {capturing ? t("hotkeyCancel") : label === null ? t("hotkeyChoose") : t("hotkeyChange")}
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => { setRefused(false); setCapturing(true); }}>
              {t("hotkeyNo")}
            </button>
            <button type="button" className="btn-primary" disabled={key === null} onClick={() => { save({ hotkey: key }); advance(); }}>
              {t("hotkeyYes")}
            </button>
          </div>
        </div>
      </div>
      <StepActions onBack={back} />
    </>
  );
}

/* ── the message lesson ──────────────────────────────────────────────────── */

export function DictateScreen({ save, advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const [draft, setDraft] = useState("");
  const key = useSyncExternalStore(subscribePushToTalk, pushToTalkKey, pushToTalkServer);
  const onText = useCallback((text: string) => {
    setDraft((d) => (d ? `${d} ${text}` : text));
    save({ dictated: true });
  }, [save]);
  const dictation = useDictation(locale === "fa" ? "fa-IR" : "en-US", onText);
  usePushToTalk({ onPress: dictation.start, onRelease: dictation.stop, priority: 3 });

  return (
    <>
      <Title>{t("dictateTitle")}</Title>
      <Lead>{t("dictateLead")}</Lead>
      {/* the mock room: a header, one message from a colleague, the box */}
      <div className="card mt-8 p-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-fg">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent" aria-hidden>
            <IconMic width={14} height={14} />
          </span>
          {t("dictateApp")}
        </div>
        <div className="px-4 pt-10 pb-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-lg font-bold text-fg" aria-hidden>
              {t("dictateFrom").slice(0, 1)}
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">{t("dictateFrom")}</p>
              <p className="text-sm text-fg">{t("dictateMessage")}</p>
            </div>
          </div>
          <div className="mt-6 flex items-end gap-2">
            <textarea
              className="input min-h-[5.5rem] flex-1 resize-none py-3"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); if (e.target.value.trim()) save({ dictated: true }); }}
              placeholder={key === null && dictation.status !== "listening" ? t("dictateNoKey") : t("dictatePlaceholder")}
              aria-label={t("dictateApp")}
            />
            <button
              type="button"
              className={`btn btn-icon-lg shrink-0 ${dictation.status === "listening" ? "animate-pulse bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}
              aria-label={t("dictateMic")}
              aria-pressed={dictation.status === "listening"}
              onClick={dictation.toggle}
            >
              <IconMic width={18} height={18} />
            </button>
          </div>
          {dictation.status === "unsupported" ? (
            <p role="alert" className="mt-3 text-sm text-fg-muted">{t("dictateUnsupported")}</p>
          ) : null}
        </div>
      </div>
      <StepActions onBack={back} onContinue={advance} ready />
    </>
  );
}

/* ── the two «look what you get» screens ─────────────────────────────────── */

/**
 * THE SPEED AND THE SAVINGS WEAR THE QUESTIONS' ANATOMY (user directive,
 * 2026-09-16: "the two — faster and more hours — have different styles;
 * change them and make them like the previous pages, same design, style and
 * alignments"). They had been the reference's dark stage — inverted ink, a
 * 6xl figure in the middle of the screen, their own button coat — the one
 * place in the flow drawn in a second language, and the person who walked
 * ten screens of one design met two of another at the end. Now they are
 * split screens like the four questions before the microphone: a Title, one
 * line, the figures in the flow's own card, the Back / Continue pair; the
 * end side carries the picture, and on the speed screen the picture is where
 * the headline ratio lives, the way the plane carried it. The dark stage
 * left OnboardingFrame with them — a layout with no screen is a second
 * design waiting to come back.
 */
export function FasterScreen({ advance, back }: ScreenProps) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  return (
    <>
      <Title>{t("fasterTitle")}</Title>
      <Lead>{t("fasterLead")}</Lead>
      <div className="card mt-8 flex flex-col gap-5">
        <div>
          <p className="text-xs font-semibold text-fg-muted">{t("fasterTyping")}</p>
          <div className="mt-2 inline-block rounded-md bg-surface-2 px-4 py-2 text-base font-semibold text-fg">
            {t("fasterWpm", { n: digits(TYPING_WPM, locale) })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-fg-muted">{t("fasterVoice")}</p>
          <div className="mt-2 rounded-md bg-accent px-4 py-2 text-base font-semibold text-on-accent">
            {t("fasterWpm", { n: digits(SPEAKING_WPM, locale) })}
          </div>
        </div>
      </div>
      <StepActions onBack={back} onContinue={advance} ready />
    </>
  );
}

/** the speed screen's end side: the plane, and the ratio it is flying at */
export function FasterPicture() {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-full max-w-xs"><ScenePlane /></div>
      <p className="mt-4 text-4xl font-bold leading-tight text-fg">
        {t("fasterBig", { n: digits(SPEED_RATIO, locale) })}
        <span className="ms-3 text-accent">{t("fasterBigWord")}</span>
      </p>
      <p className="mt-3 text-base font-semibold text-fg-muted">{t("fasterThan")}</p>
    </div>
  );
}

export function SavingsScreen({ answers, save, back, finish }: ScreenProps & { finish: () => void }) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const hours = answers.typingHoursPerDay ?? TYPING_HOURS.default;
  const saved = hoursSavedPerWeek(hours);
  return (
    <>
      <Title>{t("savingsTitle")}</Title>
      {/* the figure is the title's second line, in the title's own size —
          a number twice the size of the heading over it was the dark
          stage's habit, not this flow's */}
      <p className="mt-2 text-3xl font-bold leading-tight text-fg" aria-live="polite">
        {t("savingsHours", { n: digits(saved, locale) })}
        <span className="ms-2 text-accent">{t("savingsWeek")}</span>
      </p>
      <div className="card mt-8">
        <label className="block">
          <span className="block text-base font-semibold text-fg">{t("savingsSlider")}</span>
          <input
            type="range"
            min={TYPING_HOURS.min}
            max={TYPING_HOURS.max}
            step={1}
            value={hours}
            onChange={(e) => save({ typingHoursPerDay: Number(e.target.value) })}
            className="mt-4 w-full accent-[rgb(var(--accent))]"
            dir="ltr"
          />
          <span className="mt-2 block text-base text-fg">{t("savingsHoursDay", { n: digits(hours, locale) })}</span>
        </label>
      </div>
      {/* CONSTRAINT — the figure is an estimate, and the line says on what */}
      <p className="mt-4 text-sm leading-6 text-fg-muted">{t("savingsNote")}</p>
      <StepActions onBack={back} onContinue={finish} ready label={t("finish")} />
    </>
  );
}

export interface ScreenProps {
  answers: Answers;
  save: (patch: Answers) => void;
  advance: () => void;
  back: () => void;
}
