"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { IconChevronEnd } from "@/components/icons";

/**
 * The flow's small vocabulary, written once: a choice chip, the two text
 * roles, and the Back / Continue pair every screen ends with.
 */

/** an outlined choice that fills with the accent when picked (the reference's chip) */
export function Chip({
  selected, onClick, children, icon,
}: { selected: boolean; onClick: () => void; children: ReactNode; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`btn gap-2 ${selected ? "bg-accent-soft text-accent ring-1 ring-accent" : "bg-surface-2 text-fg hover:bg-border"}`}
    >
      {icon}
      {children}
    </button>
  );
}

/** a card-sized choice with a title and one line — the goals and the data step */
export function ChoiceCard({
  selected, onClick, title, line,
}: { selected: boolean; onClick: () => void; title: string; line: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`card-row w-full text-start transition-shadow ${selected ? "ring-2 ring-accent" : ""}`}
    >
      <span className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
            selected ? "border-accent bg-accent text-on-accent" : "border-border-strong bg-field"
          }`}
        >
          {selected ? "✓" : ""}
        </span>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-fg">{title}</span>
          <span className="mt-1 block text-sm leading-6 text-fg-muted">{line}</span>
        </span>
      </span>
    </button>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <h1 className="text-3xl font-bold leading-tight text-fg">{children}</h1>;
}

/** the one sentence under a title: an ARRIVAL kind, allowed on this surface */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-base leading-7 text-fg-muted">{children}</p>;
}

/**
 * Back above, Continue below — the reference's arrangement. `ready` greys the
 * button until the step has an answer. One coat: the dark stage's inverted
 * pair left with the stage (2026-09-16), so every screen's Continue is the
 * platform's own primary button.
 */
export function StepActions({
  onBack, onContinue, ready = true, label,
}: {
  onBack?: (() => void) | undefined;
  onContinue?: (() => void) | undefined;
  ready?: boolean;
  label?: string | undefined;
}) {
  const t = useTranslations("onboarding");
  return (
    <div className="mt-auto flex flex-col gap-4 pt-10">
      {onContinue ? (
        <button
          type="button"
          className="btn btn-primary w-full max-w-sm"
          disabled={!ready}
          onClick={onContinue}
        >
          {label ?? t("continue")}
        </button>
      ) : null}
      {onBack ? (
        <button
          type="button"
          className="btn btn-ghost w-fit gap-1"
          onClick={onBack}
        >
          <span className="inline-flex -scale-x-100" aria-hidden><IconChevronEnd width={14} height={14} /></span>
          {t("back")}
        </button>
      ) : null}
    </div>
  );
}
