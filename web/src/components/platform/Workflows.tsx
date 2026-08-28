"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { WorkflowCard } from "@/api/types";
import { Link } from "@/i18n/routing";
import { AssistantMenu } from "./AssistantMenu";
import { PlatformShell } from "./PlatformShell";
import { WorkflowTile } from "./WorkflowTile";
import { MenuLayout, PageHeader } from "@/components/scaffold";
import { EmptyState } from "@/components/ui";

/**
 * The workflow catalogue: two doors, and nothing else (user directive,
 * 2026-08-28 — "make the workflows become two big buttons … the full place
 * must be the button, not just the title").
 *
 * **The whole card is the link.** It used to be the mark and the name only,
 * with a Start button below and a source picker that unfolded underneath —
 * so the page offered to start a workflow before it offered to explain one,
 * and two thirds of a card-shaped target did nothing when pressed. Running
 * now happens from the workflow's OWN page, where the steps it will follow
 * are on screen beside the button.
 *
 * ── PARKED, NOT LOST ────────────────────────────────────────────────────────
 *
 * Five sections left this page in that pass and are meant to come back in
 * places of their own ("use them later in their own place"). Written down
 * because a section that vanishes reads as a section that was deleted:
 *
 *  - **Connected accounts** → moved, in full, to `/integrations`.
 *  - **The source picker** → moved to `WorkflowRunDialog`, opened from the
 *    detail page's ⋯ menu.
 *  - **The engine list + starter installs**, **Recent runs**, and the
 *    **Create-workflow modal** → removed from this page only. `WorkflowBuilder
 *    .tsx` is untouched on disk and still authors, publishes and pauses
 *    workflows; the three inline blocks live in git at `1b7d015`
 *    (`git show 1b7d015:web/src/components/platform/Workflows.tsx`), with the
 *    message keys they used in the same commit — restore both halves from
 *    there rather than re-deriving either.
 */
export function Workflows() {
  const t = useTranslations("workflows");
  const [workflows, setWorkflows] = useState<WorkflowCard[] | null>(null);

  const workflowsEpoch = useRefreshEpoch("workflows");
  useEffect(() => {
    void api.workflows().then(setWorkflows).catch(() => setWorkflows([]));
  }, [workflowsEpoch]);

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="workflows" />}>
        <div className="mx-auto w-full max-w-content px-5 pb-16 pt-5 md:px-10 md:pt-4">
          <PageHeader title={t("title")} subtitle={t("subtitle")} />
          {workflows === null ? null : workflows.length === 0 ? (
            <EmptyState text={t("empty")} />
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {workflows.map((workflow) => (
                <Link
                  key={workflow.id}
                  href={`/workflows/${workflow.slug}`}
                  /* one element, so there is no dead margin inside the card
                     and no second focus stop competing with the first */
                  className="group flex min-h-56 flex-col rounded-2xl border border-border bg-surface p-7 transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  <WorkflowTile icon={workflow.icon} color={workflow.color} />
                  <h2 className="mt-7 text-xl font-semibold text-fg group-hover:text-accent">
                    {workflow.name}
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">
                    {workflow.description}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </MenuLayout>
    </PlatformShell>
  );
}
