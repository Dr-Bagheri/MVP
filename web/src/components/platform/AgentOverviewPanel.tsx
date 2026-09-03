"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCard, AgentWorkflowLink } from "@/api/types";
import { Link } from "@/i18n/routing";
import { Icon } from "@/components/icons";
import { Switch } from "@/components/Switch";
import { AGENT_STARTER_HANDLES } from "@/lib/agentStarters";
import { SEEDED_STARTERS, useWorkflowCopy } from "@/lib/workflowName";
import { agentColorClasses, agentIconName, toolDescription, useAgentCopy } from "./agentAppearance";

/**
 * M47 — the overview that comes up WITH a picked agent (the user's ask, from
 * Sana's Sales-agent screen): who the agent is, the workflows it carries,
 * and what it can reach — rendered in the hub beside the conversation the
 * agent will hold.
 *
 * Three rules shape it:
 *
 *  - **It sits in the flow, never over it.** The AssistantPane overlay
 *    taught what a covering layer does to the thing it duplicates; this
 *    panel takes column space above the thread and gives it back when
 *    collapsed. The workflow list scrolls in its own box.
 *
 *  - **Picking a workflow NAVIGATES.** Workflows run from their own page —
 *    the standing rule — so each row is a link to `/workflows/<handle>`,
 *    not a run button that would start spend from a briefing card.
 *
 *  - **The kinds of nothing stay distinct.** `null` = still loading (the
 *    panel claims nothing — a "no workflows" sentence during loading is the
 *    "—"-tile bug wearing new copy); `[]` = truly none; a failed fetch says
 *    it failed instead of impersonating an agent with no workflows.
 *
 * ── The org's INSTALLED workflows are attachable from here ────────────────
 *
 * User report, 2026-08-29: "i can not choose the already installed workflow
 * in the agent, make that ones selectable". The panel offered exactly two
 * things — what the agent already carries, and starter workflows the org has
 * NOT installed — so the one set in between, the workflows the organization
 * actually runs, was the only set with no door. Installing a starter a
 * second time to reach it is not an answer.
 *
 * The write is `setAgentWorkflows`, the producer's WHOLE-SET contract, and
 * the answer is adopted rather than assumed: **save-then-adopt, never
 * optimistic** (the preferences ruling). A refusal therefore leaves the
 * ticks exactly as the server last stated them, with a line saying nothing
 * was saved — instead of a checkbox that moved and a database that did not.
 *
 * The union with `attachedRows` is load-bearing and is AgentEditor's rule,
 * not a nicety: a workflow attached but no longer listed (unpublished since)
 * must still render, or the next whole-set write silently detaches a row
 * nobody touched.
 */
export function AgentOverviewPanel({
  agent,
  defaultCollapsed = false,
}: {
  agent: AgentCard;
  /** the active conversation starts it folded — the thread owns that screen */
  defaultCollapsed?: boolean;
}) {
  /* shipped agents localize; an org's own words render as written */
  const copy = useAgentCopy()(agent);
  const t = useTranslations("agents");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [workflows, setWorkflows] = useState<AgentWorkflowLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** the org's installed workflows — what an arranger may tick */
  const [offers, setOffers] = useState<AgentWorkflowLink[]>([]);
  /** `null` = the role has not answered yet; the arrangement UI waits for it
      rather than briefly rendering the member's read-only shape at an admin */
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setWorkflows(null);
    setFailed(false);
    /* try/catch AND .catch — a client without the method throws
       synchronously, and that must degrade the same way a rejection does */
    try {
      void api.agentWorkflows(agent.id)
        .then((rows) => { if (alive) setWorkflows(rows); })
        .catch(() => { if (alive) setFailed(true); });
    } catch {
      setFailed(true);
    }
    return () => { alive = false; };
  }, [agent.id]);

  /* `me()` is a CACHED read in the client, so asking here costs nothing the
     shell has not already paid — and the alternative, threading `isAdmin`
     down from the hub, would put the gate two files from the wall it
     mirrors. Every one of these degrades to "not an arranger": a panel that
     cannot establish a role must not offer a write. */
  useEffect(() => {
    let alive = true;
    try {
      void api.me()
        .then((who) => {
          if (alive) setIsAdmin(who?.role === "admin" || who?.role === "owner");
        })
        .catch(() => { if (alive) setIsAdmin(false); });
    } catch {
      setIsAdmin(false);
    }
    return () => { alive = false; };
  }, []);

  /**
   * May this person arrange THIS agent's workflows?
   *
   * Read off db/0124's `agent_workflow_write` policy rather than guessed:
   * an org agent and a SYSTEM agent both require `echo.actor_is_admin()`
   * (0124 widened the policy for system agents precisely so the three
   * shipped platform agents could carry an org's workflows at all — the
   * agent is shared, the arrangement is per-org), while a user agent
   * requires `a.user_id = echo.actor_id()`.
   *
   * A user-level agent reaching this panel is always the caller's own —
   * `assistant_agent_read` returns no one else's — which is the same
   * reasoning the agent editor states for its own gate.
   *
   * Deliberately NOT the editor's `editable`: that answers "may I rewrite
   * this agent's persona", where a system agent is nobody's to edit. These
   * are different questions and 0124 gives them different answers.
   *
   * `isAdmin === null` is the role still in flight, and it answers NO. A
   * panel that offered the write first and withdrew it on the answer would
   * be asserting a permission it has not yet been told about.
   */
  const canArrange =
    isAdmin === null ? false : agent.level === "user" ? true : isAdmin;

  /**
   * The installed catalogue: the engine's published list, plus the builder's
   * drafts — the same two the agent editor merges, and for the same reason
   * (one union by id; they overlap on everything published).
   *
   * Fetched ONLY for someone who can arrange. A reader never sees this list
   * — their panel shows what the agent carries — so asking for it on their
   * behalf is a request whose answer is discarded, and in the admin-gated
   * case a guaranteed 403 in their console on every agent pick.
   */
  useEffect(() => {
    if (!canArrange) return;
    let alive = true;
    const take = (rows: { id: string; handle: string; name: string }[]) => {
      if (alive) setOffers((current) => mergeOffers(current, rows));
    };
    try {
      void api.engineWorkflows().then(take).catch(() => { /* none installed is a real state */ });
    } catch { /* a client without the method — the list simply stays empty */ }
    if (isAdmin) {
      /* the builder's list is admin-gated server-side; only an admin asks */
      try {
        void api.authoredWorkflows().then(take).catch(() => { /* same */ });
      } catch { /* same */ }
    }
    return () => { alive = false; };
  }, [canArrange, isAdmin]);

  /**
   * The whole set, written and then ADOPTED.
   *
   * Nothing moves on screen until the server has answered, so a refusal
   * leaves the ticks reading exactly what the database holds. The
   * alternative — flip now, reconcile later — puts a checkbox and a row in
   * disagreement for as long as the request takes, and permanently if it
   * fails.
   */
  async function arrange(workflowId: string, attach: boolean) {
    if (!canArrange || saving || workflows === null) return;
    const next = attach
      ? [...workflows.map((row) => row.id), workflowId]
      : workflows.map((row) => row.id).filter((id) => id !== workflowId);
    setSaving(true);
    setSaveFailed(false);
    try {
      setWorkflows(await api.setAgentWorkflows(agent.id, next));
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const toolCopy = useMemo<Record<string, unknown>>(() => {
    try {
      const raw = t.raw("tool");
      return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [t]);

  /* shipped-starter names localize exactly as they do on /workflows */
  const workflowCopy = useWorkflowCopy();

  /*
   * START A RECORDING WHEN I USE THIS AGENT (db/0143, user directive).
   *
   * The person's own switch, not the agent's: a shipped agent belongs to
   * nobody, and two colleagues may reasonably want opposite answers. Same
   * shape as the workflow switch — the surface holds the microphone, so the
   * flag is read here and nowhere in the worker.
   */
  const [recordAgents, setRecordAgents] = useState<readonly string[] | null>(null);
  useEffect(() => {
    void api.me()
      .then((who) => setRecordAgents(who?.record_on_agents ?? []))
      .catch(() => setRecordAgents(null));
  }, []);
  const recordsOnUse = (recordAgents ?? []).includes(agent.handle);

  async function toggleRecordOnUse() {
    if (recordAgents === null) return;
    const next = recordsOnUse
      ? recordAgents.filter((h) => h !== agent.handle)
      : [...recordAgents, agent.handle];
    /* adopt the server's answer — it dedupes and bounds the set */
    const updated = await api.updateAssistant({ record_on_agents: [...next] })
      .catch(() => null);
    if (updated) setRecordAgents(updated.record_on_agents ?? []);
  }

  /**
   * The agent's SEVEN STARTER OPTIONS (user directive, 2026-08-28) — a
   * static catalogue lookup by the agent's handle, no wire involved.
   *
   * DEDUPED BY HANDLE against the attached list: a starter the org has
   * installed AND attached to this agent already renders above as an
   * attached workflow, and the same handle twice would read as two
   * different workflows. While the attached list is still loading the
   * whole options block stays hidden (see the render condition) — deduping
   * against an unknown list would flash a row and then remove it.
   *
   * The SEEDED_STARTERS filter cannot drop a real option (the parity
   * tests pin catalogue completeness); it only keeps a drifted mirror
   * from rendering a nameless link.
   */
  const starterOptions = useMemo(() => {
    const offered = AGENT_STARTER_HANDLES[agent.handle] ?? [];
    /* deduped against BOTH lists now. A starter the org has already
       installed belongs in the installed list, where it can be ticked —
       leaving it here too would show one handle as two different workflows,
       one of them a link that says "go install this" about something that
       is installed. */
    const known = new Set([
      ...(workflows ?? []).map((workflow) => workflow.handle),
      ...offers.map((offer) => offer.handle),
    ]);
    return offered.filter(
      (handle) => !known.has(handle) && SEEDED_STARTERS[handle] !== undefined,
    );
  }, [agent.handle, workflows, offers]);

  /**
   * The installed rows this panel offers: the catalogue, UNION anything the
   * agent already carries that the catalogue no longer lists.
   *
   * The union is the half that matters. `setAgentWorkflows` writes the whole
   * set, so a row that is attached but missing from this list would be
   * dropped by the next tick of any other row — a detach nobody asked for,
   * from a control nobody touched.
   */
  const installedRows = useMemo(() => {
    const listed = new Set(offers.map((row) => row.id));
    const extras = (workflows ?? []).filter((row) => !listed.has(row.id));
    return [...offers, ...extras].sort((a, b) => a.name.localeCompare(b.name));
  }, [offers, workflows]);

  const attachedIds = useMemo(
    () => new Set((workflows ?? []).map((row) => row.id)),
    [workflows],
  );

  return (
    <section
      aria-label={t("overviewLabel")}
      className="mx-auto mb-3 w-full max-w-content rounded-3xl border border-border bg-surface/80 text-start shadow-sm"
    >
      <div className="flex items-center gap-4 p-4">
        {/* NOT a control: the agent's identity mark, an aria-hidden 48px well
            carrying its colour and icon. What is pressable on this row is the
            collapse button at its end; dressing a face as a button offers a
            press that goes nowhere. */}
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${agentColorClasses(agent.color)}`} aria-hidden>
          <Icon name={agentIconName(agent.icon)} size="xl" />
        </span>
        <span className="min-w-0 flex-1">
          {/*
            THE LEVEL CHIP IS GONE (user directive, 2026-08-29: "remove the
            .system for all agents"). It labelled where an agent came from —
            a fact about our catalogue, not about what the agent does — and
            every shipped agent carried the same word, so the column of
            identical chips distinguished nothing.
          */}
          <span className="text-base font-semibold text-fg">{copy.name}</span>
          {collapsed ? null : (
            <>
              <span className="mt-1 block text-sm leading-5 text-fg-muted">{copy.description}</span>
              {/* the knowledge sentence belongs under the NAME: it is a fact
                  about this agent, and as a column heading it read like a
                  section of settings */}
              <span className="mt-1 block text-xs leading-5 text-fg-subtle">{t("knowledgeIntro")}</span>
              {recordAgents === null ? null : (
                <span className="mt-2 flex items-center gap-2">
                  {/* the theme's switch at its compact size (2026-09-03) —
                      the 20x36 track this panel drew by hand is `size="sm"`
                      now, and its bg-success/bg-bg pair joins every other
                      switch on accent and a white knob */}
                  <Switch
                    size="sm"
                    checked={recordsOnUse}
                    label={t("recordOnUse")}
                    onChange={() => void toggleRecordOnUse()}
                  />
                  <span className="text-xs text-fg-muted">{t("recordOnUse")}</span>
                </span>
              )}
            </>
          )}
        </span>
        {/* 2026-09-03: `.btn btn-sm` — the theme's compact control. This was
            a hand-rolled 32px pill, the same one the agent editor's back
            button wore two files away; the guard could not see either,
            because neither spells a centring class. `.btn` composes `.tap`
            and draws no border, so the edge is explicit. */}
        <button
          type="button"
          className="btn btn-sm shrink-0 border border-border text-fg-muted hover:border-border-strong hover:text-fg"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? t("expand") : t("collapse")}
        </button>
      </div>

      {collapsed ? null : (
        <div className="grid gap-5 border-t border-border p-4 sm:grid-cols-2">
          <div>
            {/*
              Audit finding, 2026-09-02: this heading and its two twins in the
              right column wore `text-xs uppercase tracking-wide`, and the
              labels are joined Persian («گردش‌کارها», «ابزارها»). The theme
              says it in prose seventeen lines above `.table-head`
              (globals.css): letter-spacing breaks joined script, and uppercase
              does nothing to it while shouting on the English half. The
              scaffold's own role for a group label is `text-group-label`
              (11px, "group labels, table headers"), which is what every other
              one in the product wears — SectionMenu, SpeakersDirectory, the
              call detail's field labels.
            */}
            <h3 className="text-group-label font-medium text-fg-subtle">{t("overviewWorkflows")}</h3>
            {/*
              ONE list, two shapes.

              An arranger gets the org's installed workflows with a tick each,
              because for them the arrangement IS the list: ticked = carried.
              A second, separate "what it carries" list above it would print
              every attached workflow twice — one handle rendering as two
              different workflows, the thing the starter menu is deduped to
              avoid one block down.

              Everyone else gets what this panel always showed: the workflows
              the agent carries, each a link to its own page. Read-only is the
              ABSENCE of the controls (the M44 pill's rule), not disabled
              boxes beside live ones — with one line saying whose job the
              arranging is, so "not for you" cannot read as "never thought
              of".
            */}
            {failed ? (
              <p className="mt-2 text-sm text-fg-muted">{t("overviewWorkflowsFailed")}</p>
            ) : workflows === null ? null : canArrange ? (
              installedRows.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">{t("overviewNoWorkflows")}</p>
              ) : (
                <>
                  <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
                    {installedRows.map((row) => {
                      const checked = attachedIds.has(row.id);
                      /* the label targets the input BY ID rather than
                         wrapping the row, so the handle beside it can be a
                         real link: a link inside a label toggles the box on
                         its way to navigating */
                      const boxId = `agent-workflow-${row.id}`;
                      return (
                        <li
                          key={row.id}
                          className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                        >
                          <input
                            id={boxId}
                            type="checkbox"
                            checked={checked}
                            disabled={saving}
                            onChange={() => void arrange(row.id, !checked)}
                          />
                          <label
                            htmlFor={boxId}
                            className="min-w-0 flex-1 truncate text-sm text-fg"
                          >
                            {/* see the read-only list below: a shipped
                                starter renders in the reader's language */}
                            {workflowCopy(row).name}
                          </label>
                          <Link
                            href={`/workflows/${row.handle}`}
                            className="shrink-0 text-xs text-fg-subtle hover:text-accent"
                            dir="ltr"
                          >
                            {row.handle}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs leading-5 text-fg-subtle">{t("overviewInstalledHint")}</p>
                  {/* the tick still shows what the SERVER holds, which is
                      true — this says why, rather than leaving a change that
                      silently did not happen */}
                  {saveFailed ? (
                    <p role="alert" className="mt-1 text-xs leading-5 text-danger">
                      {t("overviewAttachFailed")}
                    </p>
                  ) : null}
                </>
              )
            ) : workflows.length === 0 ? (
              <>
                <p className="mt-2 text-sm text-fg-muted">{t("overviewNoWorkflows")}</p>
                <p className="mt-2 text-xs leading-5 text-fg-subtle">{t("overviewArrangeAdminOnly")}</p>
              </>
            ) : (
              <>
                <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
                  {workflows.map((workflow) => (
                    <li key={workflow.id}>
                      <Link
                        href={`/workflows/${workflow.handle}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
                      >
                        {/*
                          A SHIPPED starter renders in the reader's language wherever it
   appears. These rows come from echo.workflow, whose `name` is the
   Persian the starter was seeded with — so rendering the stored
   string put Persian names in the English UI, directly above a
   catalogue list that localized correctly. `workflowCopy` returns the
   stored words untouched for a workflow an org authored, and the
   catalogue's words for one we shipped.
                        */}
                        <span className="truncate">{workflowCopy(workflow).name}</span>
                        <span className="shrink-0 text-xs text-fg-subtle" dir="ltr">{workflow.handle}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs leading-5 text-fg-subtle">{t("overviewHint")}</p>
                <p className="mt-1 text-xs leading-5 text-fg-subtle">{t("overviewArrangeAdminOnly")}</p>
              </>
            )}

          </div>
          <div>
            {/*
              THE RIGHT COLUMN now holds the starter menu, which used to sit
              under the workflows list and left this side empty once the
              knowledge sentence moved up to the name (user directive). Tools
              stay here as a quiet footer: they are reference, not a heading.
            */}
            {starterOptions.length > 0 && (workflows !== null || failed) ? (
              <>
                {/* group-label role, same reason as the workflows heading */}
                <h3 className="text-group-label font-medium text-fg-subtle">{t("overviewStarters")}</h3>
                <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                  {starterOptions.map((handle) => {
                    const seeded = SEEDED_STARTERS[handle]!;
                    const copyFor = workflowCopy({
                      handle, name: seeded.name, description: seeded.description,
                    });
                    return (
                      <li key={handle}>
                        <Link
                          href={`/workflows/${handle}`}
                          title={copyFor.description}
                          className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent"
                        >
                          <span className="truncate">{copyFor.name}</span>
                          <span className="shrink-0 text-xs text-fg-subtle" dir="ltr">{handle}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
            {/*
              THE TOOL CHIPS, now under a heading of their own (user, looking
              at this block: "explain to me what are these? steps? tools?").
              They are TOOLS — the functions this agent may call while it
              answers — and they sat directly under the starter list's
              sentence with nothing between them, so the sentence read as
              their caption and called them ready-made workflows. That
              sentence is gone and this heading is why the question does not
              come back: an unlabelled row of chips borrows the meaning of
              whatever text is above it.
            */}
            {agent.tools.length > 0 ? (
              <>
                {/* group-label role, same reason as the workflows heading */}
                <h3 className="mt-4 text-group-label font-medium text-fg-subtle">
                  {t("overviewTools")}
                </h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {agent.tools.map((tool) => (
                  <li
                    key={tool}
                    className="chip border border-border text-xs text-fg-muted"
                    title={toolDescription(toolCopy, tool)}
                  >
                    {tool.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
              </>
            ) : null}
            {/*
              "Web search OFF" is gone (user directive, 2026-08-29). It
              stated the absence of a capability on every agent that lacks
              one, which is most of them — and an absence announced
              everywhere says nothing anywhere.
              
              The ON line stays: that one is a real fact about what this
              agent can reach, and it is worth knowing before you ask it
              something. Removing both would have been the tidier edit and
              the worse one.
            */}
            {agent.web ? (
              <p className="mt-2 text-xs text-fg-muted">{t("webOn")}</p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/** union by id — the engine catalogue and the builder's list overlap on
    every published workflow, and two rows for one workflow would be two
    checkboxes writing the same id */
function mergeOffers(
  current: AgentWorkflowLink[],
  incoming: { id: string; handle: string; name: string }[],
): AgentWorkflowLink[] {
  const seen = new Set(current.map((row) => row.id));
  const added = incoming
    .filter((row) => !seen.has(row.id))
    .map(({ id, handle, name }) => ({ id, handle, name }));
  return added.length === 0 ? current : [...current, ...added];
}
