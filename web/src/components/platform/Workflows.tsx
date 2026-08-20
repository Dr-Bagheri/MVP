"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ConnectorItem, ConnectorProvider, ConnectorStatus, WorkflowCard } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { AssistantMenu } from "./AssistantMenu";
import { PlatformShell } from "./PlatformShell";
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
  }, []);

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
                                <ul className="max-h-52 space-y-1 overflow-y-auto">
                                  {sourceItems.map((item) => (
                                    <li key={item.id}>
                                      <button
                                        type="button"
                                        className="tap flex w-full flex-col rounded-lg px-2 py-2 text-start hover:bg-surface-2"
                                        onClick={() => router.push({
                                          pathname: "/",
                                          query: {
                                            workflow: workflow.slug,
                                            connectorProvider: selected,
                                            sourceId: item.id,
                                          },
                                        })}
                                      >
                                        <span className="truncate text-sm font-medium text-fg">{item.title}</span>
                                        <span className="truncate text-xs text-fg-muted">{item.subtitle || item.occurred_at || sourceLabel}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
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
