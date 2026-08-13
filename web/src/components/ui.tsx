"use client";

import type { ReactNode } from "react";
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

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-fg">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-fg-muted">{hint}</span> : null}
    </label>
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
