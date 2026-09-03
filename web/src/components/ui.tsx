"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import type { CallStatus } from "@/api/types";

/** Shared primitives — one visual system across every screen. */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  // padding lives in `.card` now (density pass) — don't re-apply it here
  return <div className={`card ${className}`}>{children}</div>;
}

/**
 * REMOVED (2026-08-27). This was a SECOND page header — same title, no
 * hairline — so exactly one screen's title block was a different shape from
 * every other screen's, which is the divergence the user pointed at ("not
 * any part should be different"). The scaffold's `PageHeader` is the one,
 * and re-exported here so the old import path keeps working rather than
 * becoming a reason to write a third.
 */
export { PageHeader } from "@/components/scaffold";


/** 2026-08-24 cleanup #8: an empty table offers the VERB, not just the
    fact — pass `action` (usually a Link styled as the primary button). */
export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="py-16 text-center text-sm text-fg-muted">
      <p>{text}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
};

/** Status is never carried by color alone — always a dot + a label. */
export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className={`chip ${TONE[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

const STATUS_TONE: Record<CallStatus, Tone> = {
  recording: "info",
  processing: "info",
  linking: "info",
  summarizing: "info",
  ready: "success",
  failed: "danger",
};

/**
 * `status` is `string` on the wire so that a later migration adding a value
 * cannot crash a client — so this must not treat the union as exhaustive. An
 * unknown status falls back to a neutral chip; the bare lookup rendered an
 * unstyled one, which is a silent break rather than a graceful degrade.
 */
export function StatusChip({ status, label }: { status: string; label: string }) {
  /* cleanup #4 (2026-08-24): READY is the normal state, so it gets the
     QUIETEST rendering — a plain dot and muted word, no chip fill. Color
     stays for the states worth noticing (pipeline motion, failure). */
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
        {label}
      </span>
    );
  }
  return <Chip tone={STATUS_TONE[status as CallStatus] ?? "neutral"}>{label}</Chip>;
}

/**
 * A labelled form control.
 *
 * **The hint is a DESCRIPTION, not part of the name.** It used to render inside
 * the `<label>`, which meant the accessible name of every hinted control was
 * the label *plus the whole hint* — «نام کاربری۳ تا ۳۲ نویسه: حروف کوچک
 * لاتین، رقم و زیرخط…» announced on every focus, and again in any list of form
 * fields. Visually identical, wrong for everyone who does not look at it.
 *
 * So the hint moved out of the label and is attached with `aria-describedby`:
 * name and description are separate things, and assistive tech presents them
 * differently on purpose — the name identifies the field, the description is
 * offered after it.
 *
 * The control is cloned to carry the `describedby` id. If `children` is not a
 * single element (a fragment, several controls) the hint still renders and the
 * association is skipped rather than guessed — a wrong `aria-describedby`
 * pointing at the wrong control is worse than none.
 *
 * Found by FE1 through a failing `getByLabelText` exact match, which is the
 * only way anyone was going to notice.
 */
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const hintId = useId();
  const describedChild =
    hint && isValidElement(children)
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
          "aria-describedby": [
            (children.props as { "aria-describedby"?: string })["aria-describedby"],
            hintId,
          ]
            .filter(Boolean)
            .join(" "),
        })
      : children;

  return (
    <div className="block">
      <label className="block">
        {/*
          THE LABEL SITS OVER THE FIELD'S TEXT, not over its border (user
          directive, 2026-09-03: "the title on top of them is a little behind
          the start point of the dropdown, keep a little ahead").
          `.input` pads its contents by 13px, so a label flush to the control's
          outer edge starts 13px BEFORE the first character under it — the
          column reads as two edges rather than one. The inset is the field's
          own padding, so the two line up by construction and stay lined up if
          that number ever moves.
          A theme rule, applied here because `Field` is where a label goes
          above a control everywhere in the platform.
        */}
        <span className="mb-1.5 block ps-field-text text-sm font-medium text-fg">{label}</span>
        {describedChild}
      </label>
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
