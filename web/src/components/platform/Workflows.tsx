"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { notify } from "@/lib/notify";
import type { AuthoredWorkflow, User, WorkflowCard } from "@/api/types";
import { Link } from "@/i18n/routing";
import { AssistantMenu } from "./AssistantMenu";
import { PlatformShell } from "./PlatformShell";
import { WorkflowBuilder } from "./WorkflowBuilder";
import { WorkflowTile } from "./WorkflowTile";
import { MenuLayout, PageContainer, PageHeader, Section } from "@/components/scaffold";
import { Chip, EmptyState } from "@/components/ui";

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
 *  - **The engine list + starter installs** and **Recent runs** → removed
 *    from this page only; they live in git at `1b7d015`
 *    (`git show 1b7d015:web/src/components/platform/Workflows.tsx`) with the
 *    message keys they used, and should be restored from there rather than
 *    re-derived.
 *
 * ── BACK, for admins only (2026-08-28) ─────────────────────────────────────
 *
 * The BUILDER returned as a modal behind the header's **Create workflow**
 * button, and the authored list came back UNDER the two templates. Both are
 * admin-only, and the gate is `api.me()` — a member sees the page exactly as
 * it was. The authored list reads `authoredWorkflows()` rather than
 * `engineWorkflows()`: only that one carries the version number and the
 * enabled flag the row shows, and only it lists a DRAFT (a workflow with no
 * published version yet) — which is precisely the row someone comes back to
 * finish.
 *
 * The org-wide standing decisions (W13/W17 auto-apply) are NOT here, and that
 * is not an oversight: "remove the rest of the workflow page for now, use
 * them later in their own place" was a direct instruction, and a settings
 * block governing every workflow is not a thing to bring back in behind a
 * builder. It lives in git at `1b7d015` with the rest.
 */
export function Workflows() {
  const t = useTranslations("workflows");
  const tb = useTranslations("builder");
  const [workflows, setWorkflows] = useState<WorkflowCard[] | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [authored, setAuthored] = useState<AuthoredWorkflow[] | null>(null);
  /** `undefined` = closed; `null` = a new workflow; a row = editing it */
  const [editing, setEditing] = useState<AuthoredWorkflow | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  const workflowsEpoch = useRefreshEpoch("workflows");
  useEffect(() => {
    void api.workflows().then(setWorkflows).catch(() => setWorkflows([]));
  }, [workflowsEpoch]);

  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const loadAuthored = useCallback(() => {
    if (!isAdmin) return;
    void api.authoredWorkflows().then(setAuthored).catch(() => setAuthored([]));
  }, [isAdmin]);

  useEffect(loadAuthored, [loadAuthored]);

  async function toggleEnabled(row: AuthoredWorkflow) {
    if (busy) return;
    setBusy(true);
    try {
      await api.patchWorkflow(row.id, { enabled: !row.enabled });
      setAuthored(await api.authoredWorkflows());
    } catch {
      notify(tb("toggleFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="workflows" />}>
        <PageContainer>
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle")}
            actions={isAdmin ? (
              <button
                type="button"
                className="btn-primary h-9 min-h-0 px-4 text-sm"
                onClick={() => setEditing(null)}
              >
                {t("createWorkflow")}
              </button>
            ) : undefined}
          />
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

          {/* ── the authored catalogue, admins only ─────────────────────── */}
          {isAdmin ? (
            <Section title={tb("automationTitle")} description={tb("automationHint")}>
              {authored === null ? null : authored.length === 0 ? (
                <p className="text-sm text-fg-muted">{tb("automationEmpty")}</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                  {authored.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <button
                        type="button"
                        aria-label={tb("edit", { name: row.name })}
                        className="min-w-0 flex-1 truncate text-start text-sm font-medium text-fg hover:text-accent"
                        onClick={() => setEditing(row)}
                      >
                        {row.name}
                      </button>
                      <Chip tone={row.current_version === null ? "warning" : "success"}>
                        {row.current_version === null
                          ? tb("unpublished")
                          : tb("versionN", { n: String(row.current_version) })}
                      </Chip>
                      <button
                        type="button"
                        aria-pressed={row.enabled}
                        className={`tap h-8 rounded-full border px-3 text-xs ${row.enabled
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-fg-muted"}`}
                        disabled={busy}
                        onClick={() => void toggleEnabled(row)}
                      >
                        {row.enabled ? tb("enabled") : tb("disabled")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

            </Section>
          ) : null}
        </PageContainer>
      </MenuLayout>

      {editing !== undefined ? (
        <WorkflowBuilder
          workflow={editing}
          onClose={() => setEditing(undefined)}
          onSaved={loadAuthored}
        />
      ) : null}
    </PlatformShell>
  );
}
