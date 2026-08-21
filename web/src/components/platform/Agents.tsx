"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCard, ModelInfo } from "@/api/types";
import { Link } from "@/i18n/routing";
import { PlatformShell } from "./PlatformShell";
import { PageHeader, Section } from "@/components/scaffold";
import { Card, Chip } from "@/components/ui";

const glyphs: Record<string, string> = {
  chart: "⌁", clipboard: "▤", badge: "▣", shield: "♢", briefcase: "▱", message: "◌", search: "⌕",
};
const DEFAULT_AGENT_TOOLS = ["search_transcripts", "read_window", "get_call", "list_related_calls"];

/** The browse surface sends only a saved handle back to Home; core resolves instructions on every ask. */
export function Agents() {
  const t = useTranslations("agents");
  const [agents, setAgents] = useState<AgentCard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scope, setScope] = useState<"user" | "org">("user");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [tools, setTools] = useState<string[]>(DEFAULT_AGENT_TOOLS);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.agents().then(setAgents).catch(() => setAgents([]));
    void api.models().then((result) => setModels(result.models)).catch(() => setModels([]));
    void api.assistantTools().then(setAvailableTools).catch(() => setAvailableTools([]));
  }, []);

  async function create() {
    if (!name.trim() || !instructions.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const agent = await api.createAgent({
        level: scope, name, description, instructions,
        model: model || null, tools,
      });
      setAgents((current) => current ? [...current, agent] : [agent]);
      setCreating(false);
      setName("");
      setDescription("");
      setInstructions("");
      setScope("user");
      setModel("");
      setTools(DEFAULT_AGENT_TOOLS);
    } catch {
      setError(t("createFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PlatformShell>
      <div className="w-full">
        <div className="mx-auto w-full max-w-content px-5 pb-16 pt-5 md:px-10 md:pt-4">
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle")}
            actions={
              <button type="button" className="btn-primary h-10 min-h-0 px-4 text-sm" onClick={() => setCreating(true)}>
                + {t("create")}
              </button>
            }
          />
          <Section title={t("myAgents")}>
            {agents === null ? null : agents.length === 0 ? (
              <Card><p className="text-sm text-fg-muted">{t("empty")}</p></Card>
            ) : (
              <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
                {agents.map((agent) => (
                  <Link
                    key={agent.id}
                    href={{ pathname: "/", query: { agent: agent.handle } }}
                    className="group flex min-h-36 gap-5 rounded-2xl border border-transparent p-3 text-start transition-colors hover:border-border hover:bg-surface"
                  >
                    <span className={`grid h-20 w-20 shrink-0 place-items-center rounded-3xl text-2xl ${agent.color === "orange" ? "bg-warning-soft text-warning" : agent.color === "lime" ? "bg-success-soft text-success" : "bg-accent-soft text-accent"}`} aria-hidden>
                      {glyphs[agent.icon] ?? "✦"}
                    </span>
                    <span className="min-w-0 pt-1">
                      <span className="block text-base font-semibold text-fg group-hover:text-accent">{agent.name}</span>
                      <span className="mt-2 block text-sm leading-6 text-fg-muted">{agent.description}</span>
                      <span className="mt-3 flex items-center gap-2">
                        <Chip tone={agent.level === "system" ? "info" : "accent"}>{t(agent.level)}</Chip>
                        <span className="text-xs text-fg-subtle">{t("toolCount", { count: agent.tools.length })}</span>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Section>
          {creating ? (
            <div className="fixed inset-0 z-50 grid place-items-center bg-fg/20 p-5" role="dialog" aria-modal="true" aria-label={t("createTitle")}>
              <form
                className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"
                onSubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <h2 className="text-lg font-semibold text-fg">{t("createTitle")}</h2>
                <p className="mt-1 text-sm leading-6 text-fg-muted">{t("createHint")}</p>
                <label className="mt-4 block text-sm font-medium text-fg" htmlFor="agent-name">{t("name")}</label>
                <input id="agent-name" className="input mt-1 h-10 w-full" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
                <label className="mt-3 block text-sm font-medium text-fg" htmlFor="agent-description">{t("description")}</label>
                <input id="agent-description" className="input mt-1 h-10 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
                <label className="mt-3 block text-sm font-medium text-fg" htmlFor="agent-instructions">{t("instructions")}</label>
                <textarea id="agent-instructions" className="input mt-1 min-h-28 w-full resize-y py-2" value={instructions} onChange={(event) => setInstructions(event.target.value)} />
                <fieldset className="mt-3">
                  <legend className="text-sm font-medium text-fg">{t("scope")}</legend>
                  <div className="mt-1 flex gap-2">
                    {(["user", "org"] as const).map((level) => (
                      <button key={level} type="button" className={`tap h-8 rounded-full border px-3 text-xs ${scope === level ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted"}`} onClick={() => setScope(level)}>
                        {t(level)}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="mt-3 block text-sm font-medium text-fg" htmlFor="agent-model">{t("model")}</label>
                <select id="agent-model" className="input mt-1 h-10 w-full" value={model} onChange={(event) => setModel(event.target.value)}>
                  <option value="">{t("inheritModel")}</option>
                  {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
                <fieldset className="mt-3">
                  <legend className="text-sm font-medium text-fg">{t("tools")}</legend>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">{t("toolsHint")}</p>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {availableTools.map((tool) => {
                      const checked = tools.includes(tool);
                      return (
                        <label key={tool} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs text-fg">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setTools((current) => checked ? current.filter((item) => item !== tool) : [...current, tool])}
                          />
                          <span>{tool.replaceAll("_", " ")}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-sm" onClick={() => setCreating(false)}>{t("cancel")}</button>
                  <button type="submit" className="btn-primary h-9 min-h-0 px-3 text-sm" disabled={!name.trim() || !instructions.trim() || saving}>{saving ? t("saving") : t("create")}</button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </PlatformShell>
  );
}
