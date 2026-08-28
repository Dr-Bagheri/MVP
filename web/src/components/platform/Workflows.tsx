"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { ConnectorItem, ConnectorProvider, ConnectorStatus, User, WorkflowCard, WorkflowRunRecord } from "@/api/types";
import { notify } from "@/lib/notify";
import { Chip } from "@/components/ui";
import { Pagination, usePaged } from "@/components/Pagination";
import { useRouter } from "@/i18n/routing";
import { AssistantMenu } from "./AssistantMenu";
import { PlatformShell } from "./PlatformShell";
import { WorkflowBuilder } from "./WorkflowBuilder";
import { MenuLayout, PageHeader, Section } from "@/components/scaffold";
import { Card } from "@/components/ui";

type ItemSource = "calendar" | "mail";

const glyphs: Record<string, string> = { calendar: "▣", send: "↗", sparkles: "✦" };

/** M30's real manual workflow catalogue. */
export function Workflows() {
  const t = useTranslations("workflows");
  const locale = useLocale() as "fa" | "en";
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowCard[] | null>(null);
  const [connections, setConnections] = useState<ConnectorStatus[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [provider, setProvider] = useState<Record<string, ConnectorProvider>>({});
  const [items, setItems] = useState<Record<string, ConnectorItem[]>>({});
  const [loadingSource, setLoadingSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** the Create-workflow modal (0072; user directive 2026-08-20) */
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: "", description: "", source_kind: "calendar_event" as "calendar_event" | "mail_message", instructions: "",
  });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** M41 P1 — the run ledger strip (own runs; admins also the org's). */
  const [runs, setRuns] = useState<WorkflowRunRecord[] | null>(null);
  const [runBusy, setRunBusy] = useState<string | null>(null);
  /** M41: the ENGINE catalogue - the only rows Run can honestly offer.
      The template cards above are the OLD assistant flow; pressing Run on
      one of those was a 404 wearing a button (the first live report). */
  const [engine, setEngine] = useState<{ id: string; handle: string; name: string; description: string }[] | null>(null);
  /** the builder + starter installs are admin surfaces on THIS page now
      (user directive 2026-08-27: everything workflow lives here) */
  const [me, setMe] = useState<User | null>(null);
  const [installBusy, setInstallBusy] = useState<string | null>(null);
  const [builderEpoch, setBuilderEpoch] = useState(0);

  useEffect(() => {
    void api.workflowRuns().then(setRuns).catch(() => setRuns([]));
    void api.engineWorkflows().then(setEngine).catch(() => setEngine([]));
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  /** core's STARTER_WORKFLOWS handles (workflow-authoring.ts) — spelled here
      because that module is server-only (node:crypto). A drift is harmless
      in the safe direction: the button re-offers an installed starter and
      the press lands core's named 409, surfaced as "already installed". */
  const STARTERS = [
    { key: "followups", handle: "wf-starter-followups" },
    { key: "autotag", handle: "wf-starter-autotag" },
  ] as const;
  const missingStarters = engine === null ? [] : STARTERS.filter(
    (starter) => !engine.some((workflow) => workflow.handle === starter.handle));

  function refreshEngine() {
    void api.engineWorkflows().then(setEngine).catch(() => {});
    void api.workflowRuns().then(setRuns).catch(() => {});
  }

  /** one press: create + publish + enable on the server, then the shelf
      refreshes — the engine section stops being empty. */
  async function installStarter(key: string) {
    if (installBusy) return;
    setInstallBusy(key);
    try {
      await api.installStarter(key);
      notify(t("starterInstalled"));
      refreshEngine();
      setBuilderEpoch((epoch) => epoch + 1);
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status === 409) { notify(t("starterAlready")); refreshEngine(); }
      else notify(t("starterFailed"), "warn");
    } finally {
      setInstallBusy(null);
    }
  }

  /**
   * Press Run — the ENGINE's manual trigger (M41), not the source-picker
   * flow above it. A refusal is a NAMED sentence from core (a workflow
   * needing un-runnable kinds says which), surfaced verbatim: the refusal
   * copy is core's alone.
   */
  async function runNow(handle: string): Promise<void> {
    if (runBusy) return;
    setRunBusy(handle);
    try {
      const { run_id } = await api.runWorkflow(handle);
      router.push({ pathname: "/workflows/runs/[id]", params: { id: run_id } } as never);
    } catch (cause) {
      const detail = (cause as { detail?: string }).detail;
      notify(detail || t("runFailed"), "warn");
    } finally {
      setRunBusy(null);
    }
  }

  /* the ledger pages like every other table — `slice(0, 12)` was a silent
     truncation wearing the costume of a list (the 13th run simply was not
     there, and nothing on screen said so) */
  const { page: runPage, setPage: setRunPage, pageCount: runPages, visible: visibleRuns } = usePaged(runs ?? []);

  const workflowsEpoch = useRefreshEpoch("workflows");
  useEffect(() => {
    void Promise.all([api.workflows(), api.connectors()])
      .then(([nextWorkflows, nextConnections]) => {
        setWorkflows(nextWorkflows);
        setConnections(nextConnections);
      })
      .catch(() => {
        setWorkflows([]);
        setConnections([]);
      });
  }, [workflowsEpoch]);

  const connected = useMemo(
    () => (connections ?? []).filter((connection) => connection.status === "connected"),
    [connections],
  );

  async function connect(nextProvider: ConnectorProvider) {
    setError(null);
    try {
      window.location.assign(await api.connectorAuthorization(nextProvider, locale));
    } catch {
      setError(t("connectFailed"));
    }
  }

  async function loadItems(workflow: WorkflowCard, selected: ConnectorProvider) {
    const source: ItemSource = workflow.source_kind === "calendar_event" ? "calendar" : "mail";
    const key = `${workflow.slug}:${selected}`;
    if (items[key]) return;
    setLoadingSource(key);
    try {
      const loaded = await api.connectorItems(selected, source);
      setItems((current) => ({ ...current, [key]: loaded }));
    } catch {
      setError(t("sourceLoadFailed"));
    } finally {
      setLoadingSource(null);
    }
  }

  async function chooseWorkflow(workflow: WorkflowCard) {
    setError(null);
    setOpen((current) => current === workflow.slug ? null : workflow.slug);
    const selected = provider[workflow.slug] ?? connected[0]?.provider;
    if (!selected) return;
    setProvider((current) => ({ ...current, [workflow.slug]: selected }));
    await loadItems(workflow, selected);
  }

  async function changeProvider(workflow: WorkflowCard, selected: ConnectorProvider) {
    setProvider((current) => ({ ...current, [workflow.slug]: selected }));
    setError(null);
    await loadItems(workflow, selected);
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (createBusy || !draft.name.trim() || !draft.instructions.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await api.createWorkflow({
        name: draft.name.trim(),
        description: draft.description.trim(),
        source_kind: draft.source_kind,
        instructions: draft.instructions.trim(),
      });
      setWorkflows((current) => [...(current ?? []), created]);
      setCreating(false);
      setDraft({ name: "", description: "", source_kind: "calendar_event", instructions: "" });
    } catch (cause) {
      // 403 = not an org admin — creation is org configuration (M29 shape)
      const status = (cause as { status?: number }).status;
      setCreateError(status === 403 ? t("createAdminOnly") : t("createFailed"));
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="workflows" />}>
        <div className="mx-auto w-full max-w-content px-5 pb-16 pt-5 md:px-10 md:pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <PageHeader title={t("title")} subtitle={t("subtitle")} />
            <button
              type="button"
              className="btn-primary h-10 min-h-0 px-4 text-sm"
              onClick={() => { setCreateError(null); setCreating(true); }}
            >
              {t("create")}
            </button>
          </div>
          {/* CONNECTED ACCOUNTS — always visible (user question 2026-08-27:
              "how to connect the email and calendar, where to do it"). The
              connect door used to appear only inside an opened card; a
              door someone has to already know about is not an answer.
              `not_configured` is a claim about the PRODUCT (operator OAuth
              credentials absent), rendered as such — never as a broken
              button. */}
          <Section title={t("connectionsTitle")}>
            <p className="-mt-2 mb-3 text-sm leading-6 text-fg-muted">{t("connectionsHint")}</p>
            {connections === null ? null : (
              <div className="flex flex-wrap gap-2">
                {(["google", "microsoft"] as const).map((entry) => {
                  const state = connections.find((connection) => connection.provider === entry);
                  if (!state || !state.configured) {
                    return (
                      <span key={entry} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs text-fg-subtle">
                        {t("notConfigured", { provider: t(entry) })}
                      </span>
                    );
                  }
                  if (state.status === "connected") {
                    return (
                      <span key={entry} className="inline-flex h-9 items-center gap-2 rounded-full border border-accent bg-accent-soft px-3 text-xs text-accent">
                        {t("connectedAs", { provider: t(entry) })}
                        {state.account_label ? (
                          <span dir="ltr" className="font-medium">{state.account_label}</span>
                        ) : null}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={entry}
                      type="button"
                      className="btn-secondary h-9 min-h-0 px-3 text-xs"
                      onClick={() => void connect(entry)}
                    >
                      {state.status === "expired" || state.status === "revoked"
                        ? t("reconnect", { provider: t(entry) })
                        : t("connect", { provider: t(entry) })}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title={t("featured")}>
            {workflows === null || connections === null ? null : workflows.length === 0 ? (
              <Card><p className="text-sm text-fg-muted">{t("empty")}</p></Card>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                {workflows.map((workflow) => {
                  const selected = provider[workflow.slug] ?? connected[0]?.provider;
                  const key = selected ? `${workflow.slug}:${selected}` : "";
                  const sourceItems = key ? items[key] ?? [] : [];
                  const isOpen = open === workflow.slug;
                  const sourceLabel = workflow.source_kind === "calendar_event" ? t("calendarSource") : t("mailSource");
                  return (
                    <Card key={workflow.id} className="flex min-h-64 flex-col p-6">
                      <span className={`grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-2xl text-accent ${workflow.color === "coral" ? "bg-danger-soft text-danger" : ""}`} aria-hidden>
                        {glyphs[workflow.icon] ?? "✦"}
                      </span>
                      <h2 className="mt-8 text-xl font-semibold text-fg">{workflow.name}</h2>
                      <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">{workflow.description}</p>
                      <div className="mt-auto pt-6">
                        <button type="button" className="btn-primary h-10 min-h-0 px-4 text-sm" onClick={() => void chooseWorkflow(workflow)}>
                          {t("use")}
                        </button>
                      </div>
                      {isOpen ? (
                        <div className="mt-5 border-t border-border pt-4">
                          {connected.length === 0 ? (
                            <div>
                              <p className="text-sm text-fg-muted">{t("connectRequired", { source: sourceLabel })}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {(["google", "microsoft"] as const).map((entry) => {
                                  const state = connections.find((connection) => connection.provider === entry);
                                  return (
                                    <button
                                      key={entry}
                                      type="button"
                                      disabled={!state?.configured}
                                      className="btn-secondary h-9 min-h-0 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-55"
                                      onClick={() => void connect(entry)}
                                    >
                                      {state?.configured ? t("connect", { provider: t(entry) }) : t("notConfigured", { provider: t(entry) })}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div>
                              {/* ALWAYS disclosed, even with one provider: the
                                  implicit connected[0] choice was invisible,
                                  and an undisclosed default reads as "the
                                  options don't work" (user report, 2026-08-20) */}
                              {connected.length > 0 ? (
                                <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t("provider")}>
                                  {connected.map((connection) => (
                                    <button
                                      key={connection.provider}
                                      type="button"
                                      className={`tap h-8 rounded-full border px-3 text-xs ${selected === connection.provider ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted hover:text-fg"}`}
                                      onClick={() => void changeProvider(workflow, connection.provider)}
                                    >
                                      {t(connection.provider)}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              <p className="mb-2 text-xs font-medium text-fg-subtle">{t("chooseSource", { source: sourceLabel })}</p>
                              {loadingSource === key ? (
                                <p className="text-sm text-fg-muted">{t("sourceLoading")}</p>
                              ) : sourceItems.length === 0 ? (
                                <p className="text-sm text-fg-muted">{t("sourceEmpty", { source: sourceLabel })}</p>
                              ) : (
                                <SourcePicker
                                  items={sourceItems}
                                  fallbackLabel={sourceLabel}
                                  /* `/assistant`, NOT `/`. The hub moved off `/` when
                                     the dashboard took the landing page (2026-08-25)
                                     and this launcher kept pushing at the old address:
                                     the route still resolved, so every reachability
                                     check stayed green while picking an email landed on
                                     a briefing screen that reads none of these params
                                     and ran nothing. `run=1` starts it — choosing the
                                     item IS the instruction. */
                                  onPick={(item) => router.push({
                                    pathname: "/assistant",
                                    query: {
                                      workflow: workflow.slug,
                                      connectorProvider: selected,
                                      sourceId: item.id,
                                      run: "1",
                                    },
                                  })}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </Card>
                  );
                })}
              </div>
            )}
            {error ? <p role="status" className="mt-4 text-sm text-danger">{error}</p> : null}
          </Section>

          {/* M41 - the ENGINE: workflows the org published for running.
              Run lives HERE and only here; the cards above are the older
              guided flow through the assistant. */}
          <Section title={t("engineTitle")}>
            {engine === null ? null : engine.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("engineEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {engine.map((workflow) => (
                  <li key={workflow.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{workflow.name}</span>
                      {workflow.description ? (
                        <span className="block truncate text-xs text-fg-muted">{workflow.description}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary h-8 min-h-0 px-3 text-xs"
                      disabled={runBusy !== null}
                      onClick={() => void runNow(workflow.handle)}
                    >
                      {runBusy === workflow.handle ? t("runStarting") : t("runNow")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {isAdmin && missingStarters.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs text-fg-subtle">{t("starterHint")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {missingStarters.map((starter) => (
                    <button
                      key={starter.key}
                      type="button"
                      className="btn-secondary h-9 min-h-0 px-3 text-xs"
                      disabled={installBusy !== null}
                      onClick={() => void installStarter(starter.key)}
                    >
                      {installBusy === starter.key
                        ? t("starterInstalling")
                        : t(`starter_${starter.key}` as "starter_followups")}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </Section>

          {/* M41 P1 — the ledger strip: what ran, for whom, how it ended.
              RLS decides whose rows arrive; the screen adds nothing. */}
          <Section title={t("runsTitle")}>
            {runs === null ? null : runs.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("runsEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {visibleRuns.map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      className="tap flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2"
                      onClick={() => router.push({ pathname: "/workflows/runs/[id]", params: { id: run.id } } as never)}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{run.workflow}</span>
                      <Chip tone={run.status === "done" ? "success"
                        : run.status === "running" || run.status === "waiting" ? "info"
                        : run.status === "cancelled" ? "neutral" : "danger"}>
                        {t(`status_${run.status}` as "status_done")}
                      </Chip>
                      {run.failure_code ? (
                        <span dir="ltr" className="font-mono text-[11px] text-fg-subtle">{run.failure_code}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Pagination page={runPage} pageCount={runPages} onPage={setRunPage} />
          </Section>

          {/* M41 P5 — THE BUILDER, on this page (2026-08-27): author,
              publish, pause, auto-apply — members never see the section. */}
          {isAdmin ? (
            <WorkflowBuilder epoch={builderEpoch} onChanged={refreshEngine} />
          ) : null}
        </div>
      </MenuLayout>

      {creating ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("create")}
          onClick={() => !createBusy && setCreating(false)}
        >
          <form
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitCreate}
          >
            <h2 className="text-lg font-semibold text-fg">{t("create")}</h2>
            <p className="mt-1 text-xs text-fg-muted">{t("createHint")}</p>

            <label className="mt-4 block text-sm font-semibold text-fg" htmlFor="wf-name">{t("createName")}</label>
            <input
              id="wf-name"
              className="input mt-1 h-9 min-h-0 w-full text-sm"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />

            <label className="mt-3 block text-sm font-semibold text-fg" htmlFor="wf-desc">{t("createDescription")}</label>
            <input
              id="wf-desc"
              className="input mt-1 h-9 min-h-0 w-full text-sm"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />

            <p className="mt-3 text-sm font-semibold text-fg">{t("createSource")}</p>
            <div className="mt-1 flex gap-2" role="group" aria-label={t("createSource")}>
              {(["calendar_event", "mail_message"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={draft.source_kind === kind}
                  className={`tap h-8 rounded-full border px-3 text-xs ${draft.source_kind === kind ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted hover:text-fg"}`}
                  onClick={() => setDraft((d) => ({ ...d, source_kind: kind }))}
                >
                  {kind === "calendar_event" ? t("calendarSource") : t("mailSource")}
                </button>
              ))}
            </div>

            <label className="mt-3 block text-sm font-semibold text-fg" htmlFor="wf-inst">{t("createInstructions")}</label>
            <textarea
              id="wf-inst"
              rows={5}
              className="input mt-1 min-h-0 w-full resize-y text-sm"
              value={draft.instructions}
              onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
              aria-describedby="wf-inst-hint"
            />
            <p id="wf-inst-hint" className="mt-1 text-xs text-fg-subtle">{t("createInstructionsHint")}</p>

            {createError ? <p role="alert" className="mt-3 text-sm text-danger">{createError}</p> : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary h-9 min-h-0 px-4 text-sm"
                onClick={() => setCreating(false)}
                disabled={createBusy}
              >
                {t("createCancel")}
              </button>
              <button
                type="submit"
                className="btn-primary h-9 min-h-0 px-4 text-sm disabled:opacity-50"
                disabled={createBusy || !draft.name.trim() || !draft.instructions.trim()}
              >
                {createBusy ? t("createSaving") : t("createSave")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </PlatformShell>
  );
}

/**
 * The source list a workflow runs ON — ten per page like every other table.
 * Its own component because `usePaged` is a hook and the list renders inside
 * a map over the workflow cards.
 */
function SourcePicker({
  items,
  fallbackLabel,
  onPick,
}: {
  items: ConnectorItem[];
  fallbackLabel: string;
  onPick: (item: ConnectorItem) => void;
}) {
  const { page, setPage, pageCount, visible } = usePaged(items);
  return (
    <>
      <ul className="space-y-1">
        {visible.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="tap flex w-full flex-col rounded-lg px-2 py-2 text-start hover:bg-surface-2"
              onClick={() => onPick(item)}
            >
              <span className="truncate text-sm font-medium text-fg">{item.title}</span>
              <span className="truncate text-xs text-fg-muted">{item.subtitle || item.occurred_at || fallbackLabel}</span>
            </button>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageCount={pageCount} onPage={setPage} />
    </>
  );
}
