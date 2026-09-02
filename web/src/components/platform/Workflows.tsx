"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { useWorkflowCopy, useWorkflowTemplateCopy } from "@/lib/workflowName";
import type { AuthoredWorkflow, StarterWorkflow, User, WorkflowCard } from "@/api/types";
import { Link } from "@/i18n/routing";
import { PlatformShell } from "./PlatformShell";
import { WorkflowBuilder } from "./WorkflowBuilder";
import { WorkflowTile } from "./WorkflowTile";
import { PageContainer, SkeletonCards } from "@/components/scaffold";
import { IconChevronEnd, IconPlus } from "@/components/icons";
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
  /** the shipped LIBRARY — `null` while loading, `[]` when the read failed */
  const [starters, setStarters] = useState<StarterWorkflow[] | null>(null);
  /** `undefined` = closed; `null` = a new workflow; a row = editing it */
  const [editing, setEditing] = useState<AuthoredWorkflow | null | undefined>(undefined);
  /* the meetings page's own filter row; "all" is the resting state */
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  /*
   * `?new=1` opens the builder on arrival — how the section menu's "Create
   * workflow" reaches this page from anywhere else in the assistant (user
   * directive, 2026-08-28: "add create workflow in workflow section as
   * well").
   *
   * Spent ONCE, on a ref rather than in state: a param that survives a
   * re-render would re-open the modal every time this page re-rendered,
   * including after the person closed it. The gate also waits for the
   * identity, because opening a builder for a member who may not save is a
   * dead end with a nice animation.
   */
  const params = useSearchParams();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !isAdmin) return;
    if (params.get("new") !== "1") return;
    opened.current = true;
    setEditing(null);
  }, [params, isAdmin]);

  const workflowCopy = useWorkflowCopy();
  const templateCopy = useWorkflowTemplateCopy();
  const workflowsEpoch = useRefreshEpoch("workflows");
  useEffect(() => {
    void api.workflows().then(setWorkflows).catch(() => setWorkflows([]));
    /* try/catch AND .catch — a client without the method throws
       synchronously, and that must degrade the same way a rejection does
       (the AgentOverviewPanel's own precedent) */
    try {
      void api.workflowStarters().then(setStarters).catch(() => setStarters([]));
    } catch {
      setStarters([]);
    }
  }, [workflowsEpoch]);

  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const loadAuthored = useCallback(() => {
    if (!isAdmin) return;
    void api.authoredWorkflows().then(setAuthored).catch(() => setAuthored([]));
  }, [isAdmin]);

  useEffect(loadAuthored, [loadAuthored]);

  /**
   * The LIBRARY: every shipped starter the org has NOT installed, deduped by
   * HANDLE against the authored list — the same discriminator the agent
   * panel uses, because an installed starter already has a card above and
   * the same handle twice would read as two different workflows.
   *
   * The dedupe source has to have ANSWERED before the section renders (the
   * panel's own rule): for an admin that is the authored list; a member's
   * authored list is never requested (the server would refuse it), so their
   * gate is the identity read alone and the dedupe set is honestly empty —
   * an installed starter's card simply opens as the installed view.
   */
  const installedHandles = new Set((authored ?? []).map((row) => row.handle));
  const library = (starters ?? []).filter((starter) => !installedHandles.has(starter.handle));
  const libraryReady = me !== null && (!isAdmin || authored !== null);

  /*
   * ONE LIST, THE REFERENCE'S ROW (user directive, 2026-09-02: "redesign the
   * whole platform like the tasks and meetings pages with same structure,
   * buttons, fonts, tables").
   *
   * This page was two big 2-column cards, then half-height cards, then a
   * separate "library" section under its own text-lg heading — three shapes
   * for one kind of thing, and the only page in the product whose rows were
   * 224px tall. Every row is the platform's list row now: a mark, a name with
   * one line under it, a state pill, a kebab. The two shipped templates lead,
   * then what this organisation authored, then the library — one list, told
   * apart by the pill and by the line under the name, not by size.
   *
   * The filter row is the meetings page's own device (همه / فعال / خاموش),
   * and it only filters what HAS a state: a shipped template and a library
   * starter are neither on nor off, so they show under «همه» and step aside
   * for the two state filters rather than being counted as one of them.
   */
  type Row =
    | { kind: "template"; key: string; href: string; name: string; description: string; icon: string; color: string }
    | { kind: "authored"; key: string; href: string; name: string; description: string; enabled: boolean }
    | { kind: "library"; key: string; href: string; name: string; description: string };

  const rows: Row[] = [
    ...(workflows ?? []).map((w): Row => ({
      kind: "template", key: w.id, href: `/workflows/${w.slug}`,
      name: templateCopy(w).name, description: templateCopy(w).description,
      icon: w.icon, color: w.color,
    })),
    ...(authored ?? []).map((row): Row => ({
      kind: "authored", key: row.id, href: `/workflows/${row.handle}`,
      name: workflowCopy(row).name,
      description: row.current_version === null
        ? tb("unpublished")
        : tb("versionN", { n: String(row.current_version) }),
      enabled: row.enabled,
    })),
    ...(libraryReady ? library : []).map((starter): Row => {
      const copy = workflowCopy({ handle: starter.handle, name: starter.name, description: starter.description });
      return { kind: "library", key: starter.handle, href: `/workflows/${starter.handle}`, name: copy.name, description: copy.description };
    }),
  ];
  const shown = rows.filter((r) =>
    filter === "all" ? true : r.kind === "authored" && (filter === "on" ? r.enabled : !r.enabled));

  return (
    <PlatformShell>
      <>
        <PageContainer>
          {/* the meetings page's own top row: the filter pills at the start,
              the one action at the end — no page title (the breadcrumb has
              it) and no subtitle paragraph above a list */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label={t("filterLabel")} className="flex items-center gap-1">
              {(["all", "on", "off"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`btn btn-sm font-medium ${
                    filter === f ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  {t(f === "all" ? "filterAll" : f === "on" ? "filterOn" : "filterOff")}
                </button>
              ))}
            </nav>
            {isAdmin ? (
              <button
                type="button"
                className="btn gap-1.5 bg-accent font-semibold text-on-accent"
                onClick={() => setEditing(null)}
              >
                <IconPlus width={14} height={14} />
                {t("createWorkflow")}
              </button>
            ) : null}
          </div>

          <div className="mt-4">
            {workflows === null ? (
              <SkeletonCards count={4} height="h-16" />
            ) : shown.length === 0 ? (
              <EmptyState text={t(filter === "all" ? "empty" : "emptyFiltered")} />
            ) : (
              <ul className="space-y-2">
                {shown.map((row) => (
                  <li key={`${row.kind}:${row.key}`}>
                    <Link
                      href={row.href}
                      className="tile tile-row flex items-center gap-3 p-3.5 transition-colors hover:border-border-strong"
                    >
                      {row.kind === "template"
                        ? <WorkflowTile icon={row.icon} color={row.color} size="sm" />
                        : <WorkflowTile icon="sparkles" color="violet" size="sm" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-fg">{row.name}</span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">{row.description}</span>
                      </span>
                      {/* the STATE, where it exists: a template runs when
                          asked and a library starter is not installed yet —
                          neither is "off", so neither wears a pill that says
                          so. `library` names the shelf instead. */}
                      {row.kind === "authored" ? (
                        <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium ${
                          row.enabled ? "bg-success/10 text-success" : "bg-surface-2 text-fg-subtle"
                        }`}>
                          {row.enabled ? tb("enabled") : tb("disabled")}
                        </span>
                      ) : row.kind === "library" ? (
                        <span className="shrink-0 rounded-lg bg-surface-2 px-2 py-1 text-[11px] font-medium text-fg-muted">
                          {t("libraryChip")}
                        </span>
                      ) : null}
                      <span className="grid h-7 w-7 shrink-0 place-items-center text-fg-subtle" aria-hidden>
                        <IconChevronEnd width={14} height={14} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PageContainer>
      </>

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
