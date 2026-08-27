"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AuthoredWorkflow, User } from "@/api/types";
import { SettingsPane } from "@/components/platform/SettingsPane";
import { PageHeader } from "@/components/scaffold";
import { Card, Chip, EmptyState } from "@/components/ui";
import { SelectMenu } from "@/components/rowActions";
import { notify } from "@/lib/notify";
import {
  AUTO_APPLY_ELIGIBLE,
  WORKFLOW_EVENTS,
  WORKFLOW_PROPOSAL_KINDS,
} from "@echo/core/vocabulary";

/**
 * M41 P5 — THE BUILDER: an admin authors and publishes a workflow without
 * touching SQL.
 *
 * The editor is a structured FORM over the graph — steps as ordered cards,
 * each with its kind's own fields — not a canvas. That is a deliberate v1
 * shape: the VALIDATOR is the product here (publish refuses invalid graphs
 * naming the step and the rule, and this page surfaces that sentence
 * verbatim), and a form cannot express anything the grammar forbids.
 * Validation lives in exactly one place, on the server; this page never
 * pre-judges a graph, because two validators is two opinions.
 *
 * The starter preset is the §10 shape adapted to the shipped kinds — a
 * seed to edit, not a template to trust.
 */

interface StepDraft {
  id: string;
  kind: string;
  [key: string]: unknown;
}

const KINDS = ["search", "extract", "decide", "foreach", "ask", "propose", "wait", "apply", "notify"] as const;
const SCOPES = ["calls", "transcript", "summaries", "directory"] as const;
const SCHEMAS = ["topics_v1", "decisions_v1", "action_items_v1"] as const;

function starterSteps(): StepDraft[] {
  /* the follow-ups starter: pinned in spirit to core's corpus FULL_GRAPH —
     search → extract → decide → foreach(ask) → notify, no writes, so it
     publishes under `assist` and runs on any org untouched */
  return [
    { id: "s1", kind: "search", scope: "calls", limit: 5 },
    { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1" },
    { id: "s3", kind: "decide", on: "s2.topics.length", gt: 0, then: "s4", else: "s6" },
    { id: "s4", kind: "foreach", over: "{{s2.topics}}", max: 3, do: "s5" },
    { id: "s5", kind: "ask", instruction: "دربارهٔ «{{s4.item}}» یک جملهٔ کوتاه بنویس." },
    { id: "s6", kind: "notify", card: "workflow_result" },
  ];
}

function cleanStep(step: StepDraft): Record<string, unknown> {
  /* only the keys this kind owns travel — an empty optional stays ABSENT,
     because the validator refuses unknown keys and treats "" as a value */
  const keep: Record<string, readonly string[]> = {
    search: ["scope", "of", "limit"],
    fetch: ["source_kind", "of"],
    ask: ["instruction", "agent", "from"],
    extract: ["instruction", "agent", "from", "schema"],
    decide: ["on", "gt", "gte", "lt", "lte", "eq", "ne", "contains", "then", "else"],
    foreach: ["over", "max", "do"],
    propose: ["proposal", "from", "call"],
    apply: ["from"],
    notify: ["card"],
    wait: ["on"],
  };
  const out: Record<string, unknown> = { id: step.id, kind: step.kind };
  for (const key of keep[step.kind] ?? []) {
    const value = step[key];
    if (value === undefined || value === "") continue;
    if ((key === "limit" || key === "max" || key === "gt" || key === "gte"
      || key === "lt" || key === "lte") && typeof value === "string") {
      const n = Number(value);
      if (!Number.isNaN(n)) { out[key] = n; continue; }
    }
    out[key] = value;
  }
  return out;
}

export default function WorkflowBuilderPage() {
  const t = useTranslations("builder");
  const tAdmin = useTranslations("admin");
  const [me, setMe] = useState<User | null>(null);
  const [list, setList] = useState<AuthoredWorkflow[] | null>(null);
  const [selected, setSelected] = useState<AuthoredWorkflow | null>(null);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [maxAutonomy, setMaxAutonomy] = useState("assist");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  /** the server's refusal, verbatim — it names the step and the rule */
  const [publishError, setPublishError] = useState<string | null>(null);
  const [rules, setRules] = useState<{ kind: string; allowed: boolean }[]>([]);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
  }, []);
  useEffect(() => {
    if (!isAdmin) return;
    void api.authoredWorkflows().then(setList).catch(() => setList([]));
    void api.autoApplyRules().then(setRules).catch(() => setRules([]));
  }, [isAdmin]);

  async function open(workflow: AuthoredWorkflow) {
    setSelected(workflow);
    setPublishError(null);
    if (workflow.current_version_id) {
      try {
        const { graph, max_autonomy } = await api.workflowGraph(workflow.id);
        const parsed = graph as { steps?: StepDraft[] };
        setSteps(parsed.steps ?? []);
        setMaxAutonomy(max_autonomy);
        return;
      } catch { /* fall through to the starter */ }
    }
    setSteps(starterSteps());
    setMaxAutonomy("assist");
  }

  async function create() {
    if (busy || newName.trim() === "") return;
    setBusy(true);
    try {
      const workflow = await api.createAuthoredWorkflow({ name: newName.trim() });
      setNewName("");
      setList(await api.authoredWorkflows());
      await open(workflow);
    } catch {
      notify(t("createFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (busy || !selected) return;
    setBusy(true);
    setPublishError(null);
    try {
      const graph = { entry: steps[0]?.id ?? "s1", steps: steps.map(cleanStep) };
      const { version } = await api.publishWorkflow(selected.id, { graph, max_autonomy: maxAutonomy });
      notify(t("published", { version: String(version) }));
      setList(await api.authoredWorkflows());
    } catch (cause) {
      /* the refusal names the step and the rule — core's sentence IS the
         diagnostic, so it renders verbatim rather than paraphrased */
      const detail = (cause as { detail?: string; message?: string });
      setPublishError(detail.detail || detail.message || t("publishFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(workflow: AuthoredWorkflow) {
    if (busy) return;
    setBusy(true);
    try {
      await api.patchWorkflow(workflow.id, { enabled: !workflow.enabled });
      setList(await api.authoredWorkflows());
    } finally {
      setBusy(false);
    }
  }

  async function setTrigger(workflow: AuthoredWorkflow, value: string) {
    await api.patchWorkflow(workflow.id, { trigger_event: value === "" ? null : value });
    setList(await api.authoredWorkflows());
  }

  function patchStep(index: number, key: string, value: unknown) {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, [key]: value } : step)));
  }
  function addStep() {
    setSteps((prev) => [...prev, { id: `s${prev.length + 1}`, kind: "search", scope: "calls" }]);
  }
  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  if (me !== null && !isAdmin) {
    return (
      <SettingsPane activeSlug="workflows">
        <PageHeader title={t("title")} />
        <Card>
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{tAdmin("adminOnlyNote")}</p>
        </Card>
      </SettingsPane>
    );
  }

  const field = (index: number, key: string, placeholder: string, dirLtr = false) => (
    <input
      className="input h-8 min-h-0 py-0 text-xs"
      dir={dirLtr ? "ltr" : undefined}
      placeholder={placeholder}
      value={String(steps[index]?.[key] ?? "")}
      onChange={(event) => patchStep(index, key, event.target.value)}
    />
  );

  return (
    <SettingsPane activeSlug="workflows" width="wide">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* ── the list ──────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="input h-9 min-h-0 w-56 py-0 text-sm"
          placeholder={t("newName")}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
        />
        <button className="btn-secondary h-9 min-h-0 px-3 text-sm" disabled={busy} onClick={() => void create()}>
          {t("create")}
        </button>
      </div>

      {list === null ? null : list.length === 0 ? (
        <Card className="mb-4"><EmptyState text={t("empty")} /></Card>
      ) : (
        <ul className="mb-6 divide-y divide-border rounded-lg border border-border bg-surface">
          {list.map((workflow) => (
            <li key={workflow.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-start text-sm font-medium text-fg hover:text-accent"
                onClick={() => void open(workflow)}
              >
                {workflow.name}
              </button>
              <Chip tone={workflow.current_version === null ? "warning" : "success"}>
                {workflow.current_version === null
                  ? t("unpublished")
                  : t("versionN", { n: String(workflow.current_version) })}
              </Chip>
              {/* the EVENT trigger — none, or the shipped fact */}
              <SelectMenu
                className="h-8 min-h-0 w-44 py-0 text-xs"
                ariaLabel={t("trigger")}
                value={workflow.trigger_event ?? ""}
                onChange={(value: string) => void setTrigger(workflow, value)}
                options={[
                  { value: "", label: t("triggerNone") },
                  /* core's own list — one spelling, no mirror to drift */
                  ...WORKFLOW_EVENTS.map((event) => ({
                    value: event, label: t("triggerSummarized"),
                  })),
                ]}
              />
              <button
                type="button"
                className={`tap h-8 rounded-full border px-3 text-xs ${workflow.enabled
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-fg-muted"}`}
                disabled={busy}
                onClick={() => void toggleEnabled(workflow)}
              >
                {workflow.enabled ? t("enabled") : t("disabled")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── the editor ────────────────────────────────────────────────── */}
      {selected ? (
        <Card className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="h-section">{t("editing", { name: selected.name })}</h2>
            <div className="flex items-center gap-2">
              <SelectMenu
                className="h-8 min-h-0 w-40 py-0 text-xs"
                ariaLabel={t("ceiling")}
                value={maxAutonomy}
                onChange={setMaxAutonomy}
                options={[
                  { value: "watch", label: t("ceiling_watch") },
                  { value: "assist", label: t("ceiling_assist") },
                  { value: "act", label: t("ceiling_act") },
                ]}
              />
              <button className="btn-primary h-8 min-h-0 px-3 text-xs" disabled={busy} onClick={() => void publish()}>
                {t("publish")}
              </button>
            </div>
          </div>

          {publishError ? (
            /* the validator's sentence, verbatim — it names step + rule */
            <p role="alert" dir="ltr" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
              {publishError}
            </p>
          ) : null}

          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={index} className="rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-fg-subtle">{index + 1}</span>
                  <input
                    className="input h-8 min-h-0 w-20 py-0 font-mono text-xs"
                    dir="ltr"
                    aria-label={t("stepId")}
                    value={step.id}
                    onChange={(event) => patchStep(index, "id", event.target.value)}
                  />
                  <SelectMenu
                    className="h-8 min-h-0 w-32 py-0 text-xs"
                    ariaLabel={t("stepKind")}
                    value={step.kind}
                    onChange={(value: string) => patchStep(index, "kind", value)}
                    options={KINDS.map((kind) => ({ value: kind, label: kind }))}
                  />
                  <button
                    type="button"
                    className="ms-auto text-xs text-fg-muted underline-offset-2 hover:text-danger hover:underline"
                    onClick={() => removeStep(index)}
                  >
                    {t("removeStep")}
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {step.kind === "search" ? (<>
                    <SelectMenu className="h-8 min-h-0 py-0 text-xs" ariaLabel="scope"
                      value={String(step.scope ?? "calls")}
                      onChange={(value: string) => patchStep(index, "scope", value)}
                      options={SCOPES.map((scope) => ({ value: scope, label: scope }))} />
                    {field(index, "of", "of — {{trigger.call_id}}", true)}
                  </>) : null}
                  {step.kind === "extract" ? (<>
                    <SelectMenu className="h-8 min-h-0 py-0 text-xs" ariaLabel="schema"
                      value={String(step.schema ?? "topics_v1")}
                      onChange={(value: string) => patchStep(index, "schema", value)}
                      options={SCHEMAS.map((schema) => ({ value: schema, label: schema }))} />
                    {field(index, "from", "from — {{s1}}", true)}
                    {field(index, "instruction", t("instructionHint"))}
                  </>) : null}
                  {step.kind === "ask" ? (<>
                    {field(index, "instruction", t("instructionHint"))}
                    {field(index, "from", "from — {{s1}}", true)}
                  </>) : null}
                  {step.kind === "decide" ? (<>
                    {field(index, "on", "on — s2.topics.length", true)}
                    {field(index, "gt", "gt — 0", true)}
                    {field(index, "then", "then — s4", true)}
                    {field(index, "else", "else — s6 | __end", true)}
                  </>) : null}
                  {step.kind === "foreach" ? (<>
                    {field(index, "over", "over — {{s2.topics}}", true)}
                    {field(index, "max", "max — 3", true)}
                    {field(index, "do", "do — s5", true)}
                  </>) : null}
                  {step.kind === "propose" ? (<>
                    <SelectMenu className="h-8 min-h-0 py-0 text-xs" ariaLabel="proposal"
                      value={String(step.proposal ?? "add_tags")}
                      onChange={(value: string) => patchStep(index, "proposal", value)}
                      options={WORKFLOW_PROPOSAL_KINDS.map((kind) => ({ value: kind, label: kind }))} />
                    {field(index, "from", "from — {{s2.topics}}", true)}
                    {field(index, "call", "call — {{trigger.call_id}}", true)}
                  </>) : null}
                  {step.kind === "apply" ? field(index, "from", "from — s3 (the propose)", true) : null}
                  {step.kind === "wait" ? (
                    <span className="text-xs text-fg-muted">{t("waitNote")}</span>
                  ) : null}
                  {step.kind === "notify" ? (
                    <input className="input h-8 min-h-0 py-0 font-mono text-xs" dir="ltr" readOnly value="workflow_result" />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-secondary h-8 min-h-0 px-3 text-xs" onClick={addStep}>
              {t("addStep")}
            </button>
            <button
              className="text-xs text-fg-muted underline-offset-2 hover:underline"
              onClick={() => setSteps(starterSteps())}
            >
              {t("starter")}
            </button>
          </div>
        </Card>
      ) : null}

      {/* ── the standing decisions (W13/W17) ─────────────────────────── */}
      <Card>
        <h2 className="h-section">{t("autoTitle")}</h2>
        <p className="mt-1 text-sm leading-7 text-fg-muted">{t("autoNote")}</p>
        <ul className="mt-3 space-y-2">
          {AUTO_APPLY_ELIGIBLE.map((kind) => {
            const rule = rules.find((r) => r.kind === kind);
            const on = rule?.allowed === true;
            return (
              <li key={kind} className="flex items-center gap-3">
                <span dir="ltr" className="font-mono text-xs text-fg">{kind}</span>
                <button
                  type="button"
                  className={`tap h-7 rounded-full border px-3 text-xs ${on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-muted"}`}
                  disabled={busy}
                  onClick={() => {
                    void api.setAutoApplyRule(kind, !on)
                      .then(() => api.autoApplyRules().then(setRules))
                      .catch(() => notify(t("autoFailed"), "warn"));
                  }}
                >
                  {on ? t("autoOn") : t("autoOff")}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </SettingsPane>
  );
}
