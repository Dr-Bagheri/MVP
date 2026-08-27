"use client";

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { WorkflowRunDetail, WorkflowStepRunRecord } from "@/api/types";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { PageContainer, PageHeader } from "@/components/scaffold";
import { Card, Chip, EmptyState } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";

/**
 * M41 P1 — one run's ledger: every step, its status, its cost, and — for
 * the run's OWNER only — what it produced.
 *
 * The absence is LABELLED (the W-surface rule): an admin looking at a
 * member's run sees "output visible to the run's owner" where the owner
 * sees the produce, because a blank panel reads as broken and a deliberate
 * absence recorded only at the site of the absence is invisible to the
 * person about to ask about it. The wire makes the two distinguishable by
 * KEY PRESENCE — `output` absent means the wall filtered it; a step that
 * made nothing (a notify) has no output key either, so the sentence only
 * renders on steps that COULD produce (ask/search/extract).
 *
 * The page POLLS while the run is live: a run is the one thing on this
 * platform that changes by itself, and a ledger that only updates on
 * reload teaches people to hammer reload.
 */

const STATUS_TONE = {
  running: "info", waiting: "warning", done: "success",
  failed: "danger", refused: "danger", cancelled: "neutral", expired: "warning",
} as const;

const STEP_TONE = {
  running: "info", done: "success", failed: "danger",
  skipped: "neutral", refused: "danger",
} as const;

export default function WorkflowRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("workflows");
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await api.workflowRun(id);
        if (!live) return;
        setDetail(next);
        if (next.run.status === "running" || next.run.status === "waiting") {
          timer = setTimeout(() => void load(), 2500);
        }
      } catch {
        if (live) setMissing(true);
      }
    };
    void load();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [id]);

  useCrumbTitle(detail?.run.workflow);

  /**
   * P3/W14 — the decision, ON THE RUN. Rendered only where all three hold:
   * the step recorded a PROPOSAL (its output carries one — and outputs are
   * owner-only, so a viewer who can see it IS the person entitled to
   * decide), no decision exists yet, and the run is still alive. The
   * refusal path (someone else pressing anyway) is core's 403; this is
   * affordance, never the wall.
   */
  const decide = async (stepId: string, decision: "approve" | "reject") => {
    if (deciding) return;
    setDeciding(true);
    try {
      await api.decideWorkflowRun(id, stepId, decision);
      setDetail(await api.workflowRun(id));
    } catch {
      /* already decided elsewhere, or not ours to decide — reload shows
         the truth either way */
      setDetail(await api.workflowRun(id).catch(() => null));
    } finally {
      setDeciding(false);
    }
  };

  const columns: Column<WorkflowStepRunRecord>[] = [
    {
      key: "step",
      header: t("colStep"),
      headClassName: "text-start",
      className: "font-medium text-fg",
      cell: (step) => <span dir="ltr" className="font-mono text-xs">{step.step_id}</span>,
    },
    {
      key: "status",
      header: t("colStatus"),
      headClassName: "text-start",
      cell: (step) => (
        <Chip tone={STEP_TONE[step.status] ?? "neutral"}>
          {t(`status_${step.status}` as "status_done")}
          {step.failure_code ? ` · ${step.failure_code}` : ""}
        </Chip>
      ),
    },
    {
      key: "cost",
      header: t("colCost"),
      headClassName: "text-start",
      className: "text-fg-muted",
      cell: (step) =>
        step.model_cost ? (
          <span dir="ltr" className="font-mono text-xs">
            {step.model_cost.model ?? ""}
            {typeof step.model_cost.tokens_in === "number"
              ? ` · ${step.model_cost.tokens_in}/${step.model_cost.tokens_out ?? 0}`
              : ""}
          </span>
        ) : null,
    },
    {
      key: "output",
      header: t("colOutput"),
      headClassName: "text-start",
      className: "max-w-96",
      cell: (step) => {
        const proposal = step.output as { proposal?: string; payload?: Record<string, unknown> } | undefined;
        const pending = proposal?.proposal !== undefined
          && step.decision === undefined
          && detail !== null
          && (detail.run.status === "waiting" || detail.run.status === "running");
        if (pending) {
          return (
            <div className="space-y-2">
              <p className="text-xs text-fg">
                {t(`proposal_${proposal!.proposal}` as "proposal_add_tags")}
                <span dir="auto" className="ms-2 font-medium">
                  {Array.isArray(proposal!.payload?.tags)
                    ? (proposal!.payload!.tags as string[]).join("، ")
                    : String(proposal!.payload?.title ?? "")}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-primary h-7 min-h-0 px-3 text-xs"
                  disabled={deciding}
                  onClick={() => void decide(step.step_id, "approve")}
                >
                  {t("approve")}
                </button>
                <button
                  type="button"
                  className="btn-secondary h-7 min-h-0 px-3 text-xs"
                  disabled={deciding}
                  onClick={() => void decide(step.step_id, "reject")}
                >
                  {t("reject")}
                </button>
              </div>
            </div>
          );
        }
        if (step.decision !== undefined && proposal?.proposal !== undefined) {
          return (
            <div className="space-y-1">
              <Chip tone={step.decision === "approve" ? "success" : "neutral"}>
                {step.decision === "approve" ? t("decidedApprove") : t("decidedReject")}
              </Chip>
            </div>
          );
        }
        if (step.output !== undefined) {
          const text = typeof step.output === "string"
            ? step.output
            : JSON.stringify(step.output, null, 1);
          return (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-2 text-xs leading-5 text-fg" dir="auto">
              {text.slice(0, 4000)}
            </pre>
          );
        }
        /* the labelled absence: only on steps that could have produced
           and are DONE — a notify's nothing is a different nothing */
        if (step.status === "done" && step.agent_run_id !== null) {
          return <span className="text-xs text-fg-subtle">{t("outputHidden")}</span>;
        }
        return null;
      },
    },
  ];

  return (
    <PlatformShell>
      <PageContainer>
        {missing ? (
          <Card><EmptyState text={t("runMissing")} /></Card>
        ) : detail === null ? null : (
          <>
            <PageHeader
              title={detail.run.workflow}
              subtitle={t("runSubtitle", { trigger: detail.run.trigger_kind })}
            />
            <div className="mb-4 flex items-center gap-3">
              <Chip tone={STATUS_TONE[detail.run.status] ?? "neutral"}>
                {t(`status_${detail.run.status}` as "status_done")}
              </Chip>
              {detail.run.failure_code ? (
                <span dir="ltr" className="font-mono text-xs text-fg-muted">
                  {detail.run.failure_code}
                </span>
              ) : null}
            </div>
            <div className="rounded-lg border border-border bg-surface">
              {detail.steps.length === 0 ? (
                <EmptyState text={t("runNoSteps")} />
              ) : (
                <DataTable
                  rows={detail.steps}
                  rowKey={(step) => `${step.step_id}:${step.iteration}`}
                  columns={columns}
                />
              )}
            </div>
          </>
        )}
      </PageContainer>
    </PlatformShell>
  );
}
