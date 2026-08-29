"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCard, AgentWorkflowLink, ModelInfo } from "@/api/types";
import { Link } from "@/i18n/routing";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ui";
import {
  AGENT_COLOR_CHOICES, AGENT_ICON_CHOICES,
  agentColorClasses, agentIconName, agentLevelTone, toolDescription,
} from "./agentAppearance";

/**
 * M47 — the agent editor, Sana's four-step shape kept honest to our wire:
 * Persona / Knowledge / Workflows / Visibility.
 *
 * What the reference has that we deliberately do NOT:
 *  - a per-agent FILE store. Our agent's knowledge is the records the person
 *    can already reach under their own access (RLS is the wall) — the
 *    Knowledge step says so instead of rendering a picker that cannot work.
 *  - a movable visibility. The wire has no level patch, so for an existing
 *    agent the level renders as a FACT, not a control.
 *
 * The two contract facts this file is built around:
 *
 *  **Instructions are write-only from here.** The list wire never carries
 *  them ("a card in the browser is an affordance, not a source of prompt
 *  text" — core's own comment) and there is no detail GET. So the box starts
 *  EMPTY for an existing agent, says exactly what that means, and the PATCH
 *  includes `instructions` only when something was typed — absent = keep,
 *  the platform's patch contract. An editor that showed an empty box and
 *  saved it would silently erase instructions nobody saw.
 *
 *  **The save is a DIFF.** Only fields whose value differs from the card go
 *  into the PATCH (the org-form precedent: type-and-revert sends nothing,
 *  and a stale page cannot clobber fields it never touched). The workflow
 *  set is the one whole-set write, because that is the producer's contract.
 *
 * Read-only (a member on an org agent, anyone on a system one) is the
 * ABSENCE of controls, not disabled controls beside live ones (the M44
 * pill's rule) — the same four tabs render the same facts as plain text.
 */

const STEPS = ["persona", "knowledge", "workflows", "visibility"] as const;
type Step = (typeof STEPS)[number];

/** the create default — db/0015's four domain tools, same as the old modal */
const DEFAULT_AGENT_TOOLS = ["search_transcripts", "read_window", "get_call", "list_related_calls"];

/** order-independent set equality — the diff must not read a re-order as a change */
function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((entry) => set.has(entry));
}

export function AgentEditor({
  agent,
  isAdmin,
  onClose,
  onSaved,
}: {
  /** `null` = create a new agent */
  agent: AgentCard | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (agent: AgentCard) => void;
}) {
  const t = useTranslations("agents");
  const [step, setStep] = useState<Step>("persona");

  /*
   * The affordance mirrors the wall, never widens it: RLS answers not-found
   * for a PATCH a member sends at an org agent, so the editor must not offer
   * the form that produces that request. A user-level agent in the list is
   * always the caller's own.
   */
  const editable = agent === null || (agent.level === "user" ? true : agent.level === "org" ? isAdmin : false);

  /*
   * ATTACHING A WORKFLOW IS A DIFFERENT QUESTION FROM EDITING A PERSONA, and
   * db/0124 answers them differently. `editable` asks "may I rewrite what this
   * agent IS" — for a system agent that is nobody, which is the whole point of
   * a shipped agent. `agent_workflow_write` asks only who may change the SET a
   * card carries: system and org rows require an admin, a user row requires
   * its owner.
   *
   * Gating the workflows step on `editable` collapsed the two, so an admin
   * could not attach a workflow to meetings, mail or prep from this editor —
   * exactly the complaint that sent the overview panel to `canArrange`
   * (2026-08-29 user directive: "i can not choose the already installed
   * workflow in the agent"). Same derivation as the panel's, deliberately, so
   * the two surfaces cannot answer the same question differently.
   *
   * `isAdmin === null` is the role still in flight and answers NO: offering a
   * write before being told about the permission and withdrawing it on the
   * answer is worse than waiting.
   */
  const canArrange =
    agent === null ? true : isAdmin === null ? false : agent.level === "user" ? true : isAdmin;

  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  /** always starts empty — see the header: write-only, empty = keep */
  const [instructions, setInstructions] = useState("");
  /** RAW wire strings, so an untouched legacy spelling (`chart`, `sparkles`)
      diffs as unchanged and is never re-sent under a normalized name */
  const [icon, setIcon] = useState(agent?.icon ?? "sparkle");
  const [color, setColor] = useState(agent?.color ?? "violet");
  const [model, setModel] = useState<string | null>(agent?.model ?? null);
  const [tools, setTools] = useState<string[]>(agent?.tools ?? DEFAULT_AGENT_TOOLS);
  const [web, setWeb] = useState(agent?.web ?? false);
  const [level, setLevel] = useState<"user" | "org">("user");

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  /** the workflows this person may attach (published for everyone; drafts too for admins) */
  const [offers, setOffers] = useState<AgentWorkflowLink[]>([]);
  /** what the agent carries now — the PUT's diff base, and the read-only tab's rows */
  const [attachedRows, setAttachedRows] = useState<AgentWorkflowLink[]>([]);
  const [originalAttached, setOriginalAttached] = useState<string[]>([]);
  const [attached, setAttached] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.models().then((result) => setModels(result.models)).catch(() => setModels([]));
    void api.assistantTools().then(setAvailableTools).catch(() => setAvailableTools([]));
    void api.engineWorkflows()
      .then((rows) => setOffers((current) => mergeOffers(current, rows)))
      .catch(() => { /* no published workflows is a real state, not an error to render */ });
    if (isAdmin) {
      /* the builder's list carries drafts — rows only an admin may see */
      void api.authoredWorkflows()
        .then((rows) => setOffers((current) => mergeOffers(current, rows)))
        .catch(() => { /* same */ });
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!agent) return;
    let alive = true;
    void api.agentWorkflows(agent.id)
      .then((rows) => {
        if (!alive) return;
        setAttachedRows(rows);
        setAttached(new Set(rows.map((row) => row.id)));
        setOriginalAttached(rows.map((row) => row.id));
      })
      .catch(() => { /* the tab renders its empty state; the save diff stays empty-vs-empty (no PUT) */ });
    return () => { alive = false; };
  }, [agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by id: a re-created card object must not refetch

  const toolCopy = useMemo<Record<string, unknown>>(() => {
    try {
      const raw = t.raw("tool");
      return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [t]);
  const colorNames = useMemo<Record<string, unknown>>(() => {
    try {
      const raw = t.raw("colorName");
      return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [t]);

  /**
   * The Workflows tab lists offers ∪ attached. The union is load-bearing for
   * the whole-set PUT: an attached workflow missing from this person's offer
   * list (e.g. unpublished since) must still RENDER, or saving the set would
   * silently detach a row nobody touched — the lost-update the models
   * allow-list recorded, arriving here through the list instead of the write.
   */
  const workflowRows = useMemo(() => {
    const seen = new Set(offers.map((row) => row.id));
    const extras = attachedRows.filter((row) => !seen.has(row.id));
    return [...offers, ...extras].sort((a, b) => a.name.localeCompare(b.name));
  }, [offers, attachedRows]);

  const offeredIds = useMemo(() => new Set(offers.map((row) => row.id)), [offers]);

  const createReady = name.trim() !== "" && instructions.trim() !== "";

  async function save() {
    // A person who may only arrange workflows still saves; the persona block
    // below stays behind `editable`, so relaxing this door widens nothing.
    if (saving || (!editable && !canArrange)) return;
    if (agent === null && !createReady) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      let card = agent;
      if (agent === null && editable) {
        card = await api.createAgent({
          level, name, instructions,
          description: description || undefined,
          model, tools, icon, color, web,
        });
      } else if (editable) {
        /* THE DIFF — exactly the fields the person changed, nothing else */
        const patch: Parameters<typeof api.updateAgent>[1] = {};
        if (name !== agent.name) patch.name = name;
        if (description !== agent.description) patch.description = description;
        if (instructions.trim() !== "") patch.instructions = instructions;
        if (model !== agent.model) patch.model = model;
        if (!sameMembers(tools, agent.tools)) patch.tools = tools;
        if (icon !== agent.icon) patch.icon = icon;
        if (color !== agent.color) patch.color = color;
        if (web !== agent.web) patch.web = web;
        if (Object.keys(patch).length > 0) {
          card = await api.updateAgent(agent.id, patch);
        }
      }
      if (card && !sameMembers([...attached], originalAttached)) {
        /* whole set, the producer's contract — and the answer is adopted as
           the new base, so a second save without touching anything sends
           nothing */
        const rows = await api.setAgentWorkflows(card.id, [...attached]);
        setAttachedRows(rows);
        setAttached(new Set(rows.map((row) => row.id)));
        setOriginalAttached(rows.map((row) => row.id));
      }
      if (card) {
        setSaved(true);
        setInstructions("");
        onSaved(card);
      }
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);
  const stepLabel: Record<Step, string> = {
    persona: t("stepPersona"),
    knowledge: t("stepKnowledge"),
    workflows: t("stepWorkflows"),
    visibility: t("stepVisibility"),
  };

  /* the model select's option list; the CURRENT model may be absent from the
     catalogue (saved while offered, barred since) — it renders as itself
     rather than letting the select silently show the first option as chosen
     (FE3's select rule: a value matching no option renders a DIFFERENT one).
     The diff means it is never SENT unless the person picks something else. */
  const modelUnoffered = agent?.model != null && !models.some((entry) => entry.id === agent.model);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="tap h-8 rounded-full border border-border px-3 text-xs text-fg-muted hover:border-border-strong hover:text-fg" onClick={onClose}>
          {t("backToAgents")}
        </button>
        <h2 className="text-lg font-semibold text-fg">
          {agent === null ? t("createTitle") : t("editTitle")}
        </h2>
        {agent ? (
          <>
            <Chip tone={agentLevelTone(agent.level)}>{t(agent.level)}</Chip>
            <Link
              href={{ pathname: "/assistant", query: { agent: agent.handle } }}
              className="ms-auto text-sm font-medium text-accent hover:underline"
            >
              {t("startConversation")}
            </Link>
          </>
        ) : null}
      </div>

      {!editable && agent ? (
        <p className="mt-3 text-sm leading-6 text-fg-muted">
          {agent.level === "system" ? t("readOnlySystem") : t("readOnlyOrg")}
        </p>
      ) : null}

      {/* the stepper — free navigation, aria-current marks the pane on screen */}
      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label={agent === null ? t("createTitle") : t("editTitle")}>
        {STEPS.map((candidate, index) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={step === candidate}
            aria-current={step === candidate ? "step" : undefined}
            className={`tap flex h-9 items-center gap-2 rounded-full border px-4 text-sm transition-colors ${
              step === candidate
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
            }`}
            onClick={() => setStep(candidate)}
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-surface-2 text-xs" aria-hidden>
              {index + 1}
            </span>
            {stepLabel[candidate]}
          </button>
        ))}
      </div>

      <div className="card mt-4">
        {step === "persona" ? (
          editable ? (
            <div className="max-w-2xl">
              <label className="block text-sm font-medium text-fg" htmlFor="agent-name">{t("name")}</label>
              <input
                id="agent-name"
                className="input mt-1 h-12 w-full text-lg font-semibold"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus={agent === null}
              />
              <div className="mt-4 flex flex-wrap gap-8">
                <fieldset>
                  <legend className="text-sm font-medium text-fg">{t("icon")}</legend>
                  <div className="mt-2 grid grid-cols-7 gap-1.5">
                    {AGENT_ICON_CHOICES.map((choice) => {
                      const active = agentIconName(icon) === choice;
                      return (
                        <button
                          key={choice}
                          type="button"
                          aria-label={choice}
                          aria-pressed={active}
                          className={`tap grid h-10 w-10 place-items-center rounded-xl border transition-colors ${
                            active ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted hover:border-border-strong"
                          }`}
                          onClick={() => setIcon(choice)}
                        >
                          <Icon name={choice} size="lg" />
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-sm font-medium text-fg">{t("color")}</legend>
                  <div className="mt-2 flex gap-1.5">
                    {AGENT_COLOR_CHOICES.map((choice) => {
                      const active = agentColorClasses(color) === agentColorClasses(choice);
                      const label = colorNames[choice];
                      return (
                        <button
                          key={choice}
                          type="button"
                          aria-label={typeof label === "string" ? label : choice}
                          aria-pressed={active}
                          className={`tap grid h-10 w-10 place-items-center rounded-xl border transition-colors ${
                            active ? "border-accent" : "border-border hover:border-border-strong"
                          }`}
                          onClick={() => setColor(choice)}
                        >
                          <span className={`h-6 w-6 rounded-lg ${agentColorClasses(choice)}`} aria-hidden />
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
              <label className="mt-4 block text-sm font-medium text-fg" htmlFor="agent-description">{t("description")}</label>
              <input id="agent-description" className="input mt-1 h-10 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
              <label className="mt-4 block text-sm font-medium text-fg" htmlFor="agent-instructions">{t("instructions")}</label>
              <textarea
                id="agent-instructions"
                className="input mt-1 min-h-32 w-full resize-y py-2"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                aria-describedby="agent-instructions-note"
              />
              <p id="agent-instructions-note" className="mt-1 text-xs leading-5 text-fg-muted">
                {agent === null ? t("createHint") : t("instructionsWriteOnly")}
              </p>
              <label className="mt-4 block text-sm font-medium text-fg" htmlFor="agent-model">{t("model")}</label>
              <select
                id="agent-model"
                className="input mt-1 h-10 w-full max-w-sm"
                value={model ?? ""}
                onChange={(event) => setModel(event.target.value === "" ? null : event.target.value)}
              >
                <option value="">{t("inheritModel")}</option>
                {modelUnoffered ? (
                  <option value={agent!.model!}>{`${agent!.model!} — ${t("modelUnavailable")}`}</option>
                ) : null}
                {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="flex items-start gap-5">
              <span className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl ${agentColorClasses(agent!.color)}`} aria-hidden>
                <Icon name={agentIconName(agent!.icon)} size="xl" />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-fg">{agent!.name}</p>
                <p className="mt-1 text-sm leading-6 text-fg-muted">{agent!.description}</p>
                <p className="mt-3 text-sm text-fg-muted">
                  <span className="font-medium text-fg">{t("model")}: </span>
                  {agent!.model ?? t("inheritModel")}
                </p>
              </div>
            </div>
          )
        ) : null}

        {step === "knowledge" ? (
          <div className="max-w-2xl">
            <p className="text-sm leading-6 text-fg-muted">{t("knowledgeIntro")}</p>
            {editable ? (
              <>
                <fieldset className="mt-4">
                  <legend className="text-sm font-medium text-fg">{t("tools")}</legend>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">{t("toolsHint")}</p>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {availableTools.map((tool) => {
                      const checked = tools.includes(tool);
                      return (
                        <label key={tool} className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-2 text-xs text-fg">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            onChange={() => setTools((current) => checked ? current.filter((item) => item !== tool) : [...current, tool])}
                          />
                          <span>
                            <span className="block font-medium">{tool.replaceAll("_", " ")}</span>
                            <span className="mt-0.5 block leading-4 text-fg-muted">{toolDescription(toolCopy, tool)}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="mt-4 flex items-start gap-2 rounded-lg border border-border px-2.5 py-2 text-sm text-fg">
                  <input type="checkbox" className="mt-1" checked={web} onChange={() => setWeb((current) => !current)} />
                  <span>
                    <span className="block font-medium">{t("webSearch")}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-fg-muted">{t("webSearchHint")}</span>
                  </span>
                </label>
              </>
            ) : (
              <>
                <ul className="mt-4 space-y-1.5">
                  {agent!.tools.map((tool) => (
                    <li key={tool} className="rounded-lg border border-border px-2.5 py-2 text-xs text-fg">
                      <span className="block font-medium">{tool.replaceAll("_", " ")}</span>
                      <span className="mt-0.5 block leading-4 text-fg-muted">{toolDescription(toolCopy, tool)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-fg-muted">{agent!.web ? t("webOn") : t("webOff")}</p>
              </>
            )}
          </div>
        ) : null}

        {step === "workflows" ? (
          <div className="max-w-2xl">
            <p className="text-sm leading-6 text-fg-muted">{t("workflowsIntro")}</p>
            {workflowRows.length === 0 ? (
              <p className="mt-4 text-sm text-fg-muted">
                {t("workflowsEmpty")}{" "}
                <Link href="/workflows" className="text-accent hover:underline">{t("workflowsBuildLink")}</Link>
              </p>
            ) : (
              <div className="mt-4 grid gap-1.5">
                {workflowRows.map((row) => {
                  const checked = attached.has(row.id);
                  const body = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{row.name}</span>
                        <span className="block text-xs text-fg-subtle" dir="ltr">{row.handle}</span>
                      </span>
                      {!offeredIds.has(row.id) ? (
                        <Chip tone="neutral">{t("workflowUnlisted")}</Chip>
                      ) : null}
                    </>
                  );
                  return canArrange ? (
                    <label key={row.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setAttached((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })}
                      />
                      {body}
                    </label>
                  ) : checked ? (
                    <Link key={row.id} href={`/workflows/${row.handle}`} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 hover:border-accent">
                      {body}
                    </Link>
                  ) : null;
                })}
                {!canArrange && attachedRows.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t("overviewNoWorkflows")}</p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {step === "visibility" ? (
          <div className="max-w-2xl">
            {agent === null ? (
              <fieldset>
                <legend className="text-sm font-medium text-fg">{t("scope")}</legend>
                <div className="mt-2 grid gap-2">
                  <label className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${level === "user" ? "border-accent bg-accent-soft/40" : "border-border"}`}>
                    <input type="radio" name="agent-level" className="mt-0.5" checked={level === "user"} onChange={() => setLevel("user")} />
                    <span>
                      <span className="block font-medium text-fg">{t("visibilityUser")}</span>
                    </span>
                  </label>
                  {/*
                    Org-wide creation is an admin door (org-wide prompt surface
                    is org configuration — the M29 org-skill precedent, the
                    same gate Workflows uses). Listed and disabled with the
                    reason for members, rather than hidden: "not for you" and
                    "never thought of" are different facts.
                  */}
                  <label className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${level === "org" ? "border-accent bg-accent-soft/40" : "border-border"} ${isAdmin ? "" : "opacity-60"}`}>
                    <input type="radio" name="agent-level" className="mt-0.5" disabled={!isAdmin} checked={level === "org"} onChange={() => setLevel("org")} />
                    <span>
                      <span className="block font-medium text-fg">{t("visibilityOrg")}</span>
                      {!isAdmin ? (
                        <span className="mt-0.5 block text-xs leading-5 text-fg-muted">{t("visibilityOrgAdminOnly")}</span>
                      ) : null}
                    </span>
                  </label>
                </div>
              </fieldset>
            ) : (
              <div>
                <Chip tone={agentLevelTone(agent.level)}>{t(agent.level)}</Chip>
                {/* no level control on an existing agent: the wire has no
                    level patch, and a control with no wire is a lie */}
                <p className="mt-3 text-sm leading-6 text-fg-muted">{t("visibilityFixed")}</p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-4 flex items-center gap-2">
        {stepIndex > 0 ? (
          <button type="button" className="btn-secondary h-9 min-h-0 px-4 text-sm" onClick={() => setStep(STEPS[stepIndex - 1]!)}>
            {t("back")}
          </button>
        ) : null}
        <span className="flex-1" />
        {saved ? <span className="text-sm text-success">{t("saved")}</span> : null}
        {(step === "workflows" ? canArrange : editable) && (agent !== null || step === "visibility") ? (
          <button
            type="button"
            className={`h-9 min-h-0 px-4 text-sm ${step === "visibility" ? "btn-primary" : "btn-secondary"}`}
            disabled={saving || (agent === null && !createReady)}
            onClick={() => void save()}
          >
            {saving ? t("saving") : t("save")}
          </button>
        ) : null}
        {stepIndex < STEPS.length - 1 ? (
          <button type="button" className="btn-primary h-9 min-h-0 px-4 text-sm" onClick={() => setStep(STEPS[stepIndex + 1]!)}>
            {t("continue")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** union by id — engine and authored lists overlap on published workflows */
function mergeOffers(
  current: AgentWorkflowLink[],
  incoming: { id: string; handle: string; name: string }[],
): AgentWorkflowLink[] {
  const seen = new Set(current.map((row) => row.id));
  const added = incoming
    .filter((row) => !seen.has(row.id))
    .map(({ id, handle, name }) => ({ id, handle, name }));
  return [...current, ...added];
}
