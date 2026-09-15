"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { SeedJobKind, SeedJobStart, SeedJobView } from "@/api/types";
import { Overlay } from "./Overlay";
import { DIALOG_BODY } from "./tasks/panelStyle";
import { IconCheck } from "@/components/icons";
import { digits } from "@/lib/format";

/**
 * THE SEED IN PROGRESS (M52, 2026-09-09) — the modal that stands over the
 * Demo tab for the four minutes a seed takes.
 *
 * Before this the button read "Seeding…" and nothing else moved, which is
 * indistinguishable from a page that has hung; a second press met a 409 from
 * the door. So the seed is a JOB now: the
 * POST answers at once with a job id and the list of stages the engine has
 * promised to announce, this modal polls that job every two seconds, and
 * what it draws is what core reports — the stage the seed is actually on,
 * never a guess about how far along four minutes ought to be.
 *
 * NOT DISMISSIBLE WHILE RUNNING. There is no close button, Escape and the
 * scrim are inert, and the form behind it is inert with them: a person who
 * closes this and presses create again is exactly the incident. It is also
 * why `beforeunload` warns from the first second — the job id lives in this
 * component and nowhere else, and for a create the finished poll will carry
 * the presenter's password, ONCE. A reload mid-seed would leave a finished
 * organisation whose password nobody will ever see.
 *
 * The three ends are three different nothings (rule 12): DONE turns into the
 * credentials panel (the caller renders it, because it is the same panel the
 * tab has always shown); FAILED shows the seed's own sentence with a close;
 * UNKNOWN — core answered 404, which after a 202 means the process restarted
 * underneath the job — says so plainly, and says where to look.
 */

export type SeedJobEnd =
  | { status: "done"; view: SeedJobView }
  | { status: "failed"; message: string }
  | { status: "unknown" };

type Phase = { status: "running"; view: SeedJobView | null } | SeedJobEnd;

/** After this many consecutive poll failures that are not a 404, the seed
    is reported as unreachable rather than polled for ever. */
const POLL_FAILURE_LIMIT = 15;

export function DemoSeedModal({
  kind, name, job, pollMs = 2000, onSettled, onClose, renderDone,
}: {
  kind: SeedJobKind;
  name: string;
  job: SeedJobStart;
  /** the poll interval — a prop so a test can shorten it, never a knob */
  pollMs?: number;
  /** called ONCE when the job reaches an end, before anything is rendered
      for it — the tab re-reads its list here */
  onSettled?: (end: SeedJobEnd) => void;
  /** only ever reachable from an end state: the running modal has no way out */
  onClose: () => void;
  /** what a finished job shows — the credentials panel, for a create */
  renderDone: (view: SeedJobView, close: () => void) => ReactNode;
}) {
  const t = useTranslations("platformRoot");
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>({ status: "running", view: null });
  /* the last picture the poll drew, kept so a failure shows WHERE it stopped */
  const [lastView, setLastView] = useState<SeedJobView | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const settledRef = useRef(false);
  /* read through refs inside the poll: the translator and the callback are
     new functions on every render, and a poll effect keyed on them would
     restart its timer on every clock tick — and never fire */
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const tRef = useRef(t);
  tRef.current = t;

  /* the clock counts from the press, on this machine — a server timestamp
     would show the skew between two clocks as time the seed never spent */
  useEffect(() => {
    const startedAt = Date.now();
    const tick = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000,
    );
    return () => window.clearInterval(tick);
  }, []);

  /* the poll: one request in flight at a time, the next scheduled only after
     the last has answered, so a slow BFF cannot pile requests behind itself */
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;

    const settle = (end: SeedJobEnd) => {
      if (cancelled || settledRef.current) return;
      settledRef.current = true;
      onSettledRef.current?.(end);
      setPhase(end);
    };
    const fallback = () => tRef.current("demoSeedFailed");

    const poll = async () => {
      if (cancelled) return;
      try {
        const view = await api.demoSeedJob(job.job_id);
        if (cancelled) return;
        failures = 0;
        setLastView(view);
        if (view.status === "done") {
          settle({ status: "done", view });
          return;
        }
        if (view.status === "failed") {
          settle({ status: "failed", message: view.error?.message ?? fallback() });
          return;
        }
        setPhase({ status: "running", view });
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof BffError && cause.status === 404) {
          settle({ status: "unknown" });
          return;
        }
        failures += 1;
        if (failures >= POLL_FAILURE_LIMIT) {
          settle({
            status: "failed",
            message: cause instanceof BffError ? (cause.detail ?? fallback()) : fallback(),
          });
          return;
        }
      }
      timer = window.setTimeout(() => void poll(), pollMs);
    };

    timer = window.setTimeout(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [job.job_id, pollMs]);

  /* a reload would take the job id — and, for a create, the only copy of
     the password that is about to arrive — with no warning at all */
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const running = phase.status === "running";
  const title = kind === "create" ? t("demoSeedingTitle") : t("demoReseedingTitle", { name });
  const stages = lastView?.stages ?? job.stages;
  const doneCount = phase.status === "done" ? stages.length : (lastView?.done_stages ?? 0);
  const activeStage = phase.status === "running" ? (phase.view?.stage ?? null) : null;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const clock = digits(`${mm}:${ss}`, locale);

  /* the way out exists only at an end; while running, Escape and the scrim
     reach a function that does nothing, which is the rule made structural */
  const dismiss = running ? () => {} : onClose;

  return (
    <Overlay onClose={dismiss} label={title} size="md">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-fg" data-testid="demo-seed-title">
          {phase.status === "done" && kind === "create" ? t("demoReadyTitle") : title}
        </h2>
        {running ? (
          <span
            className="ltr shrink-0 font-mono text-sm tabular-nums text-fg-muted"
            aria-label={t("demoElapsed")}
            data-testid="demo-seed-clock"
            aria-live="off"
          >
            {clock}
          </span>
        ) : null}
      </div>

      <div className={DIALOG_BODY}>
        {phase.status === "done" ? (
          <div>{renderDone(phase.view, onClose)}</div>
        ) : (
          <>
            <div>
              {/* a CONSEQUENCE, said while it can still be acted on: the page
                  that closes loses the seed's only handle */}
              <p className="text-sm leading-6 text-fg-muted" role="status">
                {running ? t("demoSeedingKeepOpen") : null}
                {phase.status === "failed" ? (
                  <span className="text-danger">{phase.message}</span>
                ) : null}
                {phase.status === "unknown" ? (
                  <span className="text-danger">{t("demoSeedUnknownJob")}</span>
                ) : null}
              </p>
            </div>

            <div>
              <ol className="space-y-1.5" aria-busy={running} data-testid="demo-seed-stages">
                {[...stages, "done"].map((stage, index) => {
                  /* the "done" row only ever ticks on a finished job, and a
                     finished job renders the other branch — so here it is
                     never ticked, which is what a failure should look like */
                  const isDone = stage !== "done" && index < doneCount;
                  const isActive = running && stage !== "done" && stage === activeStage;
                  return (
                    <li
                      key={stage}
                      aria-current={isActive ? "step" : undefined}
                      data-stage={stage}
                      data-state={isDone ? "done" : isActive ? "active" : "pending"}
                      className={`flex items-center gap-2.5 text-sm ${
                        isDone ? "text-fg-muted" : isActive ? "font-semibold text-fg" : "text-fg-subtle"
                      }`}
                    >
                      <StageMark state={isDone ? "done" : isActive ? "active" : "pending"} />
                      <span>{t(`demoStage_${stage}`)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {running ? null : (
              <div className="flex justify-end">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  {t("demoSeedClose")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Overlay>
  );
}

/** The three states of a stage row, drawn so they differ without colour. */
function StageMark({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <IconCheck width={12} height={12} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
    </span>
  );
}
