"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { useWorkflowCopy, useWorkflowTemplateCopy } from "@/lib/workflowName";
import type { AuthoredWorkflow, StarterWorkflow, User, WorkflowCard } from "@/api/types";
import { Link } from "@/i18n/routing";
import { SectionTabs } from "./sectionTabs";
import { PlatformShell } from "./PlatformShell";
import { WorkflowBuilder } from "./WorkflowBuilder";
import { WorkflowTile } from "./WorkflowTile";
import { PageContainer, SkeletonCards } from "@/components/scaffold";
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

  /*
   * TWO HALVES, ONE PAGE (user directive, 2026-09-04: "add a sub menu on the
   * top in workflow as well with name Active Workflow and second Workflow
   * library, and add the workflows that are in the library there and remove
   * them from the workflow page").
   *
   * They had been stacked: what this organization RUNS, then a shelf of what
   * it could install, on one scroll. The two answer different questions — "is
   * my mail workflow on?" and "what else could I have?" — and a shelf under a
   * list teaches people to stop scrolling before they reach it.
   */
  const [tab, setTab] = useState<"active" | "library">("active");
  /*
   * And the library sorts by WHAT STARTS a workflow (the second row the
   * directive asks for). The dimension comes from the producer — `trigger_
   * event` is on the starters wire — rather than from a category invented
   * here: a made-up taxonomy is a promise the server never made, and it would
   * silently mis-file the first starter core adds.
   */
  const [kind, setKind] = useState<string>("all");
  const workflowsEpoch = useRefreshEpoch("workflows");
  useEffect(() => {
    void api.workflows().then(setWorkflows).catch(() => setWorkflows([]));
    /* try/catch AND .catch — a client without the method throws
       synchronously, and that must degrade the same way a rejection does
       (the agent overview panel's precedent, deleted 2026-09-03) */
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
  /* the filter row's options are the triggers actually PRESENT on the shelf,
     so a tab never opens onto nothing — and never hides a starter under a
     name this file guessed */
  const libraryKinds = [...new Set(library.map((s) => s.trigger_event ?? "manual"))];
  const shown = kind === "all"
    ? library
    : library.filter((s) => (s.trigger_event ?? "manual") === kind);
  const libraryReady = me !== null && (!isAdmin || authored !== null);

  return (
    <PlatformShell>
      <>
        <PageContainer>
          {/* ROW 1 (R3, user ruling 2026-09-05): the section tabs, and the
              page's one create button at the END of the same row — the tasks
              and meetings pages' shape. It stood in its own row above. */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <SectionTabs
              label={t("sectionsLabel")}
              active={tab}
              onSelect={setTab}
              tabs={[
              { key: "active", label: t("activeTitle"),
                count: workflows === null ? undefined : workflows.length + (authored ?? []).length },
              { key: "library", label: t("libraryTitle"),
                count: libraryReady ? library.length : undefined },
              ]}
            />
            {isAdmin ? (
              <button type="button" className="btn btn-primary" onClick={() => setEditing(null)}>
                {t("createWorkflow")}
              </button>
            ) : null}
          </div>
          {tab === "library" ? null : workflows === null ? (
            <SkeletonCards count={2} height="h-56" />
          ) : workflows.length === 0 ? (
            <EmptyState text={t("empty")} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/*
                The two shipped templates first, then whatever this
                organization has authored — one grid, one visual language
                (user directive, 2026-08-28: "any new workflow must have half
                the size of the email and meeting calendar button with same
                style"). A separate list underneath was the previous shape and
                it read as a different KIND of thing, which these are not: a
                workflow somebody wrote is a workflow.
              */}
              {workflows.map((workflow) => (
                <Link
                  key={workflow.id}
                  href={`/workflows/${workflow.slug}`}
                  /* one element, so there is no dead margin inside the card
                     and no second focus stop competing with the first */
                  className="group flex min-h-56 flex-col rounded-2xl border border-border bg-surface p-7 transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  <WorkflowTile icon={workflow.icon} color={workflow.color} />
                  {/* THROUGH THE CATALOGUE, like every other list on this
                      page. These two rendered the wire's English straight,
                      so the product's flagship workflows introduced
                      themselves in English on a Persian screen. */}
                  <h2 className="mt-7 text-xl font-semibold text-fg group-hover:text-accent">
                    {templateCopy(workflow).name}
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">
                    {templateCopy(workflow).description}
                  </p>
                </Link>
              ))}

              {(authored ?? []).map((row) => (
                <Link
                  key={row.id}
                  href={`/workflows/${row.handle}`}
                  /* HALF the height of a template card and the same
                     everything else: same corner, same border, same hover,
                     same tile — the size says "smaller", not "lesser" */
                  className="group flex min-h-28 flex-col justify-center rounded-2xl border border-border bg-surface p-7 transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  <span className="flex items-center gap-4">
                    <WorkflowTile icon="sparkles" color="violet" size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-fg group-hover:text-accent">
                        {/* shipped starters localize; an org's own name renders as written */}
                        {workflowCopy(row).name}
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-subtle">
                        {row.enabled ? tb("enabled") : tb("disabled")}
                        {row.current_version === null
                          ? ` · ${tb("unpublished")}`
                          : ` · ${tb("versionN", { n: String(row.current_version) })}`}
                      </span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/*
            The LIBRARY (user directive, 2026-08-28: "make all the workflows
            that you put in skill real in workflow section, so anyone else can
            use them for real later") — every shipped starter, each a link to
            its own page, where the install lives. The list comes off the
            wire (`GET /v1/workflows/starters`, derived from the registry
            itself) so a starter added in core is on this shelf without
            anybody editing this file; the NAMES localize through the same
            `useWorkflowCopy` path every installed starter uses.
          */}
          {tab === "library" ? (
            <section>
              {/* the shelf's explanatory line is GONE (user directive,
                  2026-09-04). It described what a card obviously does — each
                  opens on its own page and installs from there — which is a
                  sentence the first click teaches better than any paragraph. */}
              {/* the SECOND row: what starts them. Only when there is more
                  than one kind on the shelf — a filter with a single option
                  is a control that cannot change anything. */}
              {libraryKinds.length > 1 ? (
                <SectionTabs
                  label={t("libraryKindLabel")}
                  active={kind}
                  onSelect={setKind}
                  className="mb-5"
                  tabs={[
                    { key: "all", label: t("libraryKindAll"), count: library.length },
                    ...libraryKinds.map((k) => ({
                      key: k,
                      label: t(`libraryKind_${k.replace(".", "_")}`),
                      count: library.filter((s) => (s.trigger_event ?? "manual") === k).length,
                    })),
                  ]}
                />
              ) : null}
              {!libraryReady ? (
                <SkeletonCards count={2} height="h-28" />
              ) : shown.length === 0 ? (
                <EmptyState text={t("libraryEmpty")} />
              ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {shown.map((starter) => {
                  const copy = workflowCopy({
                    handle: starter.handle,
                    name: starter.name,
                    description: starter.description,
                  });
                  return (
                    <Link
                      key={starter.handle}
                      href={`/workflows/${starter.handle}`}
                      /* the authored card's own skin — half a template's
                         height, same corner, same border, same hover */
                      className="group flex min-h-28 flex-col justify-center rounded-2xl border border-border bg-surface p-7 transition-colors hover:border-border-strong hover:bg-surface-2"
                    >
                      <span className="flex items-center gap-4">
                        <WorkflowTile icon="sparkles" color="violet" size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-base font-semibold text-fg group-hover:text-accent">
                            {copy.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-fg-subtle">
                            {copy.description}
                          </span>
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
              )}
            </section>
          ) : null}

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
