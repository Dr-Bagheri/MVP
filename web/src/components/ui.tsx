"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import type { CallStatus, CallScope } from "@/api/types";

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

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-fg">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-16 text-center text-sm text-fg-muted">{text}</div>
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
  return <Chip tone={STATUS_TONE[status as CallStatus] ?? "neutral"}>{label}</Chip>;
}

export function ScopeChip({ scope, label }: { scope: CallScope; label: string }) {
  return <Chip tone={scope === "org" ? "accent" : "neutral"}>{label}</Chip>;
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
        <span className="mb-1.5 block text-sm font-medium text-fg">{label}</span>
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

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" dir="ltr">
      <div
        className="h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
