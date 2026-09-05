"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AuthoredWorkflow } from "@/api/types";
import { SelectMenu } from "@/components/rowActions";
import { IconArrowDown, IconArrowUp, IconClose, IconPlus, IconTrash } from "@/components/icons";
import { digits } from "@/lib/format";
import { notify } from "@/lib/notify";
import {
  EXECUTABLE_STEP_KINDS,
  EXTRACT_SCHEMA_NAMES,
  FETCH_SOURCE_KINDS,
  WORKFLOW_EVENTS,
  WORKFLOW_PROPOSAL_KINDS,
  WORKFLOW_STEP_KINDS,
  WORKFLOW_TRIGGER_KINDS,
} from "@echo/core/vocabulary";

/**
 * M41 P5 — THE BUILDER, as a composable editor (user directive, 2026-08-28:
 * "give it structure way that can be played with like a puzzle and make
 * another shape out of it").
 *
 * The shape is the reference the user handed over: a centred modal with a
 * TRIGGER selector card at the top, an ordered list of STEP cards under it,
 * a `+` sitting ON the connector line between any two cards, and one Save
 * at the foot. The previous version was a flat form appended to a page —
 * every step was a row, the only way to add one was at the end, and nothing
 * could be moved. A graph you cannot re-order is not a graph; it is a list.
 *
 * ── What this surface does NOT do ───────────────────────────────────────
 * It never judges a graph. Composition rules (which binding resolves, which
 * jump goes forward, whether `apply` is behind its `propose`) live in
 * `core/src/api/workflow-graph.ts` and nowhere else — publish refuses,
 * naming the step and the rule, and that sentence renders VERBATIM below.
 * Two validators is two opinions, and the second one always goes stale.
 *
 * The one thing the editor DOES construct rather than ask for is
 * `foreach.do`: the validator requires it to name the immediately following
 * step, so the field is derived from the step's position and shown
 * read-only. That is construction, not validation — there is exactly one
 * legal value and making a person retype it after every re-order is how a
 * puzzle stops being one.
 *
 * ── The top-right corner is EMPTY, and the ceiling is gone ──────────────
 * The reference puts a MODEL picker there; we have no per-workflow model
 * field, so for a while the autonomy ceiling stood in. Then the user ruled
 * the dial out of the product entirely (2026-08-28): every workflow
 * publishes at "assist" — reads and proposes, writes wait for a human —
 * with no control anywhere. The wire field survives because versions carry
 * it; the choice does not.
 */

/* ── the draft ───────────────────────────────────────────────────────── */

export interface StepDraft {
  id: string;
  kind: string;
  [key: string]: unknown;
}

const SCOPES = ["calls", "transcript", "summaries", "directory"] as const;
/* both lists come from the producer: a hand-kept copy here is a picker that
   offers what publish refuses, which is the drift shape this repo pays for */
const SCHEMAS = EXTRACT_SCHEMA_NAMES;
const FETCH_KINDS = FETCH_SOURCE_KINDS;
const DECIDE_OPS = ["gt", "gte", "lt", "lte", "eq", "ne", "contains"] as const;
/** the four ops the validator requires a NUMBER on the left of */
const NUMERIC_OPS: readonly string[] = ["gt", "gte", "lt", "lte"];


/**
 * The kinds the executor can actually run today, as a set. `fetch` is in the
 * vocabulary and the validator accepts it, but it is NOT in
 * `EXECUTABLE_STEP_KINDS` — the connector poller it needs is deferred. It
 * stays offered here (it publishes; a version holding it is a real, legal
 * version) with the consequence written on the card, because "the option is
 * missing" and "the option exists and the server will refuse the run" are
 * different facts and only one of them is true.
 */
const RUNNABLE = new Set<string>(EXECUTABLE_STEP_KINDS);

/**
 * Which triggers this build can actually SET. `patchWorkflow` carries one
 * trigger field — `trigger_event` — so `manual` (no event) and `event` are
 * configurable and `schedule`/`signal` are not: they exist in the run
 * ledger's vocabulary because runs can arrive that way, not because this
 * screen can arrange one. They are listed and disabled with the reason,
 * rather than hidden, so the absence reads as "not yet" instead of "never
 * thought of".
 */
const TRIGGER_SETTABLE: Record<string, boolean> = {
  manual: true, event: true, schedule: false, signal: false,
};

/**
 * The keys each kind owns — the client's promise not to send junk, mirroring
 * `STEP_KEYS` in the validator. The server refuses an unknown key outright,
 * so a drift here surfaces as a named refusal rather than a silent write.
 */
const OWNED_KEYS: Record<string, readonly string[]> = {
  search: ["scope", "of", "limit"],
  fetch: ["source_kind", "of"],
  ask: ["instruction", "agent", "from", "web", "tools"],
  extract: ["instruction", "agent", "from", "schema", "tools"],
  decide: ["on", ...DECIDE_OPS, "then", "else"],
  foreach: ["over", "max", "do"],
  propose: ["proposal", "from", "call", "to", "subject", "message"],
  apply: ["from"],
  notify: ["card"],
  wait: ["on"],
};

/** what a fresh step of each kind starts as — every required key present */
function defaultsFor(kind: string): Record<string, unknown> {
  switch (kind) {
    case "search": return { scope: "calls", limit: 5 };
    case "fetch": return { source_kind: "calendar_event" };
    case "ask": return { instruction: "" };
    case "extract": return { schema: "topics_v1" };
    case "decide": return { on: "", gt: "0", then: "", else: "__end" };
    case "foreach": return { max: 3 };
    case "propose": return { proposal: WORKFLOW_PROPOSAL_KINDS[0] };
    case "notify": return { card: "workflow_result" };
    case "wait": return { on: "decision" };
    default: return {};
  }
}

/** `s1`, `s2`, … — the smallest free number, so a delete frees its id */
function nextId(steps: StepDraft[]): string {
  const taken = new Set(steps.map((step) => step.id));
  for (let n = 1; n <= steps.length + 1; n += 1) {
    if (!taken.has(`s${n}`)) return `s${n}`;
  }
  return `s${steps.length + 1}`;
}

/**
 * One step, reduced to what may travel: only the keys its kind owns, and an
 * empty optional stays ABSENT — the validator refuses unknown keys and reads
 * `""` as a value rather than as nothing.
 *
 * `next` is the step that follows in the array: `foreach.do` must name it,
 * so it is written from position rather than carried in the draft.
 */
export function cleanStep(step: StepDraft, next?: StepDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { id: step.id, kind: step.kind };
  for (const key of OWNED_KEYS[step.kind] ?? []) {
    if (step.kind === "foreach" && key === "do") {
      if (next) out.do = next.id;
      continue;
    }
    const value = step[key];
    if (value === undefined || value === null || value === "") continue;
    /* `web: false` is "no web", which is the same fact as an absent key —
       and the absent key is the one that cannot be mistaken for a choice */
    if (key === "web") {
      if (value === true) out.web = true;
      continue;
    }
    if (typeof value === "string"
      && (key === "limit" || key === "max" || NUMERIC_OPS.includes(key))) {
      const n = Number(value);
      if (!Number.isNaN(n)) { out[key] = n; continue; }
    }
    out[key] = value;
  }
  return out;
}

/** the graph as the publish route wants it: `entry` is the first step's id */
export function buildGraph(steps: StepDraft[]): { entry: string; steps: Record<string, unknown>[] } {
  return {
    entry: steps[0]?.id ?? "",
    steps: steps.map((step, index) => cleanStep(step, steps[index + 1])),
  };
}

/* ── binding values, split so a person picks a source and types a path ── */

/** `{{s2.topics}}` → `{ source: "s2", path: "topics" }` (braces optional) */
function splitBinding(raw: unknown, braced: boolean): { source: string; path: string } {
  if (typeof raw !== "string" || raw.trim() === "") return { source: "", path: "" };
  const trimmed = raw.trim();
  const inner = braced
    ? (/^\{\{\s*([^{}]+?)\s*\}\}$/.exec(trimmed)?.[1] ?? "")
    : trimmed;
  if (inner === "") return { source: "", path: "" };
  const dot = inner.indexOf(".");
  return dot < 0
    ? { source: inner, path: "" }
    : { source: inner.slice(0, dot), path: inner.slice(dot + 1) };
}

function joinBinding(source: string, path: string, braced: boolean): string | undefined {
  if (source === "") return undefined;
  const inner = path.trim() === "" ? source : `${source}.${path.trim()}`;
  return braced ? `{{${inner}}}` : inner;
}

/**
 * The follow-ups starter, pinned in spirit to core's own corpus graph:
 * search → extract → decide → foreach(ask) → notify. No writes, so it
 * publishes under `assist` and gives a first-time author something already
 * shaped to take apart.
 */
function starterSteps(): StepDraft[] {
  return [
    { id: "s1", kind: "search", scope: "calls", limit: 5 },
    { id: "s2", kind: "extract", from: "{{s1}}", schema: "topics_v1" },
    { id: "s3", kind: "decide", on: "s2.topics.length", gt: "0", then: "s4", else: "s6" },
    { id: "s4", kind: "foreach", over: "{{s2.topics}}", max: 3, do: "s5" },
    { id: "s5", kind: "ask", instruction: "دربارهٔ «{{s4.item}}» یک جملهٔ کوتاه بنویس." },
    { id: "s6", kind: "notify", card: "workflow_result" },
  ];
}

/* ── the modal ───────────────────────────────────────────────────────── */

export function WorkflowBuilder({
  workflow = null,
  onClose,
  onSaved,
}: {
  /** the row being edited; `null` opens a brand-new workflow */
  workflow?: AuthoredWorkflow | null;
  onClose: () => void;
  /** the catalogue changed — the page behind refetches its own list */
  onSaved?: () => void;
}) {
  const t = useTranslations("builder");
  const locale = useLocale();

  const [name, setName] = useState(workflow?.name ?? "");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<string>(
    workflow ? (workflow.trigger_event ? "event" : "manual") : "");
  const [event, setEvent] = useState<string>(workflow?.trigger_event ?? WORKFLOW_EVENTS[0]);
  const [enabled, setEnabled] = useState(workflow?.enabled ?? false);
  /*
   * ASSIST, always (user directive, 2026-08-28: "remove watch and act from
   * everywhere in the platform … only put assist in the background, does not
   * need to show this"). The wire field stays — versions carry it — but no
   * control offers a choice, and a version opened for editing republishes at
   * assist whatever its old ceiling said.
   */
  const maxAutonomy = "assist";
  const [steps, setSteps] = useState<StepDraft[]>([]);
  /** the trigger menu is OPEN; closed, the section is one selector card */
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  /** the server's refusal, verbatim — it names the step and the rule */
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * The row this modal is writing to. It starts as the edited workflow and
   * becomes the CREATED one after the first save, so a publish refusal
   * followed by a fix publishes into the same workflow instead of leaving a
   * trail of empty twins behind every failed attempt.
   */
  const created = useRef<string | null>(workflow?.id ?? null);
  const savedName = useRef(workflow?.name ?? "");

  useEffect(() => {
    if (!workflow?.current_version_id) return;
    let live = true;
    void api.workflowGraph(workflow.id)
      .then(({ graph, max_autonomy }) => {
        if (!live) return;
        const parsed = graph as { steps?: StepDraft[] };
        setSteps(parsed.steps ?? []);
        /* max_autonomy deliberately unread: assist is the platform's one
           behaviour now, and re-adopting a stored "act" would resurrect a
           choice the product no longer offers */
        void max_autonomy;
      })
      .catch(() => { /* an unreadable version leaves an empty canvas, not a lie */ });
    return () => { live = false; };
  }, [workflow]);

  useEffect(() => {
    const onKey = (keyEvent: KeyboardEvent) => {
      /* a dropdown inside the editor listens for Escape too; closing the
         whole editor because someone dismissed a select would throw away
         everything they had arranged */
      if (keyEvent.key !== "Escape") return;
      if (document.querySelector('[role="listbox"]')) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* ── the puzzle moves ───────────────────────────────────────────────── */

  function patchStep(index: number, key: string, value: unknown) {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, [key]: value } : step)));
  }

  /** a new kind means a new set of fields; only the id survives */
  function changeKind(index: number, kind: string) {
    setSteps((prev) => prev.map((step, i) => (
      i === index ? { id: step.id, kind, ...defaultsFor(kind) } : step)));
  }

  function insertStep(at: number) {
    setSteps((prev) => {
      const fresh: StepDraft = { id: nextId(prev), kind: "search", ...defaultsFor("search") };
      return [...prev.slice(0, at), fresh, ...prev.slice(at)];
    });
  }

  function moveStep(index: number, by: -1 | 1) {
    setSteps((prev) => {
      const to = index + by;
      if (to < 0 || to >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(to, 0, moved!);
      return copy;
    });
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  /* ── saving ─────────────────────────────────────────────────────────── */

  async function save() {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      let target = created.current;
      if (target === null) {
        const row = await api.createAuthoredWorkflow(
          description.trim() === "" ? { name } : { name, description });
        target = row.id;
        created.current = target;
        savedName.current = row.name;
      } else if (name.trim() !== savedName.current) {
        await api.patchWorkflow(target, { name });
        savedName.current = name.trim();
      }
      const { version } = await api.publishWorkflow(target, {
        graph: buildGraph(steps),
        max_autonomy: maxAutonomy,
      });
      await api.patchWorkflow(target, {
        enabled,
        /* an unanswered trigger question SAYS nothing rather than saying
           "manual" on the author's behalf */
        ...(trigger === "" ? {} : { trigger_event: trigger === "event" ? event : null }),
      });
      notify(t("savedV", { version: digits(version, locale) }));
      onSaved?.();
      onClose();
    } catch (cause) {
      const detail = cause as { detail?: string; message?: string };
      setRefusal(detail.detail || detail.message || t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  /* ── small render helpers ───────────────────────────────────────────── */

  const label = (text: string, children: ReactNode) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-fg-subtle">{text}</span>
      {children}
    </label>
  );

  const textField = (
    index: number, key: string, text: string,
    opts: { ltr?: boolean; placeholder?: string; numeric?: boolean } = {},
  ) => label(text, (
    <input
      className="input text-xs"
      dir={opts.ltr ? "ltr" : undefined}
      inputMode={opts.numeric ? "numeric" : undefined}
      placeholder={opts.placeholder}
      value={String(steps[index]?.[key] ?? "")}
      onChange={(changeEvent) => patchStep(index, key, changeEvent.target.value)}
    />
  ));

  const select = (
    index: number, key: string, text: string,
    options: { value: string; label: string; disabled?: boolean }[],
    fallback = "",
  ) => label(text, (
    <SelectMenu
      className="text-xs"
      ariaLabel={`${text} — ${steps[index]?.id ?? ""}`}
      value={String(steps[index]?.[key] ?? fallback)}
      onChange={(value: string) => patchStep(index, key, value)}
      options={options}
    />
  ));

  /**
   * A binding, as two halves a person can actually answer: WHICH earlier
   * step (offered, never remembered) and WHICH field of it (typed, because
   * the shapes live in the server's schema registry and a copy of them here
   * would be a second spelling that rots).
   *
   * `braced` is false for `decide.on`, which the grammar takes as a bare
   * path — the same two halves, one less pair of braces.
   */
  /**
   * **What this model step may REACH.**
   *
   * Not a caution slider — a blast-radius one. A step whose output is read
   * by the person who asked for it may look things up; a step whose output
   * is addressed to somebody else may not, because retrieval plus an
   * outward-facing message is how a stranger's email reaches into our
   * records. The server refuses `read` on any graph that drafts mail, so
   * this control is where that refusal stops being a surprise at save time.
   */
  const toolsField = (index: number) => {
    const step = steps[index]!;
    const none = step.tools === "none";
    return (
      <div className="rounded-lg border border-border bg-surface-2/40 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-fg">{t("toolsLabel")}</span>
          <button
            type="button"
            aria-label={t("toolsLabel")}
            aria-pressed={none}
            /* 2026-09-03: the theme's compact control. Every toggle in this
               editor was a 28px `rounded-full` lozenge — the one shape
               globals.css names as the reason our screens did not match the
               reference at identical colours — and the state classes are all
               that a `.btn btn-sm` needs to keep. */
            className={`btn btn-sm ms-auto border font-medium ${
              none ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted"}`}
            onClick={() => patchStep(index, "tools", none ? "read" : "none")}
          >
            {none ? t("toolsNone") : t("toolsRead")}
          </button>
        </div>
      </div>
    );
  };

  const bindingField = (
    index: number, key: string, text: string, braced = true,
  ) => {
    const step = steps[index];
    if (!step) return null;
    const { source, path } = splitBinding(step[key], braced);
    const sources = [
      { value: "", label: t("bindingNone") },
      { value: "trigger", label: t("bindingTrigger") },
      ...steps.slice(0, index).map((earlier) => ({
        value: earlier.id,
        label: t("bindingStep", { id: earlier.id, kind: t(`kind_${earlier.kind}`) }),
      })),
    ];
    const composed = joinBinding(source, path, braced);
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {label(text, (
          <SelectMenu
            className="text-xs"
            ariaLabel={`${text} — ${step.id}`}
            value={source}
            onChange={(value: string) => patchStep(index, key, joinBinding(value, path, braced) ?? "")}
            options={sources}
          />
        ))}
        {label(t("bindingPath"), (
          <input
            className="input text-xs"
            dir="ltr"
            placeholder={t("bindingPathHint")}
            value={path}
            onChange={(changeEvent) =>
              patchStep(index, key, joinBinding(source, changeEvent.target.value, braced) ?? "")}
          />
        ))}
        {composed ? (
          <p dir="ltr" className="font-mono text-[11px] text-fg-subtle sm:col-span-2">{composed}</p>
        ) : null}
      </div>
    );
  };

  /** a jump target: any LATER step, or the end of the workflow */
  const branchField = (index: number, key: "then" | "else") => select(
    index, key, t(`f_${key}`),
    [
      { value: "", label: t("branchNone") },
      ...steps.slice(index + 1).map((later) => ({
        value: later.id,
        label: t("bindingStep", { id: later.id, kind: t(`kind_${later.kind}`) }),
      })),
      { value: "__end", label: t("endLabel") },
    ],
  );

  function stepFields(step: StepDraft, index: number) {
    switch (step.kind) {
      case "search":
        return (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {select(index, "scope", t("f_scope"),
                SCOPES.map((scope) => ({ value: scope, label: t(`scope_${scope}`) })), "calls")}
              {textField(index, "limit", t("f_limit"), { ltr: true, numeric: true })}
            </div>
            {bindingField(index, "of", t("f_of"))}
          </>
        );
      case "fetch":
        return (
          <>
            {select(index, "source_kind", t("f_sourceKind"),
              FETCH_KINDS.map((kind) => ({ value: kind, label: t(`source_${kind}`) })),
              "calendar_event")}
            {bindingField(index, "of", t("f_of"))}
          </>
        );
      case "ask":
        return (
          <>
            {label(t("f_instruction"), (
              <textarea
                className="input min-h-[88px] py-2 text-xs"
                placeholder={t("instructionHint")}
                value={String(step.instruction ?? "")}
                onChange={(changeEvent) => patchStep(index, "instruction", changeEvent.target.value)}
              />
            ))}
            {bindingField(index, "from", t("f_from"))}
            {textField(index, "agent", t("f_agent"), { ltr: true })}
            {/* the internet option (M41, 2026-08-28): the SAME model with
                OpenRouter's `:online` variant. It is legal on `ask` and on
                nothing else — the validator refuses the key anywhere else —
                so the control exists on exactly one kind of card. */}
            <div className="rounded-lg border border-border bg-surface-2/40 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-fg">{t("webLabel")}</span>
                <button
                  type="button"
                  /* named by WHAT it toggles: a pressed button whose only
                     accessible name is "Off" tells a screen reader nothing */
                  aria-label={t("webLabel")}
                  aria-pressed={step.web === true}
                  /* 2026-09-03: `.btn btn-sm`, the theme's compact control */
                  className={`btn btn-sm ms-auto border font-medium ${
                    step.web === true
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-fg-muted"}`}
                  onClick={() => patchStep(index, "web", step.web !== true)}
                >
                  {step.web === true ? t("webOn") : t("webOff")}
                </button>
              </div>
            </div>
            {toolsField(index)}
          </>
        );
      case "extract":
        return (
          <>
            {select(index, "schema", t("f_schema"),
              SCHEMAS.map((schema) => ({ value: schema, label: t(`schema_${schema}`) })),
              "topics_v1")}
            {bindingField(index, "from", t("f_from"))}
            {toolsField(index)}
            {label(t("f_instruction"), (
              <textarea
                className="input min-h-[64px] py-2 text-xs"
                placeholder={t("instructionHint")}
                value={String(step.instruction ?? "")}
                onChange={(changeEvent) => patchStep(index, "instruction", changeEvent.target.value)}
              />
            ))}
            {textField(index, "agent", t("f_agent"), { ltr: true })}
          </>
        );
      case "decide": {
        const op = DECIDE_OPS.find((candidate) => step[candidate] !== undefined) ?? "";
        return (
          <>
            {bindingField(index, "on", t("f_on"), false)}
            <div className="grid gap-2 sm:grid-cols-2">
              {label(t("f_op"), (
                <SelectMenu
                  className="text-xs"
                  ariaLabel={`${t("f_op")} — ${step.id}`}
                  value={op}
                  onChange={(value: string) => setSteps((prev) => prev.map((current, i) => {
                    if (i !== index) return current;
                    /* one operator at a time: the validator refuses two, and
                       leaving the old key behind is exactly how you get two */
                    const copy: StepDraft = { id: current.id, kind: current.kind };
                    for (const [key, held] of Object.entries(current)) {
                      if (!(DECIDE_OPS as readonly string[]).includes(key)) copy[key] = held;
                    }
                    if (value !== "") copy[value] = "";
                    return copy;
                  }))}
                  options={[
                    { value: "", label: t("opNone") },
                    ...DECIDE_OPS.map((candidate) => ({
                      value: candidate, label: t(`op_${candidate}`),
                    })),
                  ]}
                />
              ))}
              {op === "" ? null : label(t("f_value"), (
                <input
                  className="input text-xs"
                  dir="ltr"
                  value={String(step[op] ?? "")}
                  onChange={(changeEvent) => patchStep(index, op, changeEvent.target.value)}
                />
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {branchField(index, "then")}
              {branchField(index, "else")}
            </div>
          </>
        );
      }
      case "foreach": {
        const body = steps[index + 1];
        return (
          <>
            {bindingField(index, "over", t("f_over"))}
            <div className="grid gap-2 sm:grid-cols-2">
              {textField(index, "max", t("f_max"), { ltr: true, numeric: true })}
              {label(t("f_do"), (
                <input
                  className="input text-xs"
                  dir="ltr"
                  readOnly
                  aria-label={`${t("f_do")} — ${step.id}`}
                  value={body?.id ?? ""}
                />
              ))}
            </div>
            <p className="text-[11px] leading-5 text-fg-muted">
              {body ? t("doDerived") : t("doMissing")}
            </p>
          </>
        );
      }
      case "propose":
        return (
          <>
            {select(index, "proposal", t("f_proposal"),
              WORKFLOW_PROPOSAL_KINDS.map((kind) => ({
                value: kind, label: t(`proposal_${kind}`),
              })), WORKFLOW_PROPOSAL_KINDS[0])}
            {bindingField(index, "from", t("f_from"))}
            {/*
              A mail reply is addressed by HEADERS, so its fields are three
              bindings and no call; everything else is about a call and takes
              one. Showing both sets at once would offer a `call` the server
              refuses on a draft_mail, and a `to` it refuses on the others —
              two dead fields on every card.
            */}
            {step.proposal === "draft_mail" ? (
              <>
                {bindingField(index, "message", t("f_message"))}
                {bindingField(index, "to", t("f_to"))}
                {bindingField(index, "subject", t("f_subject"))}
              </>
            ) : (
              bindingField(index, "call", t("f_call"))
            )}
          </>
        );
      case "apply": {
        const proposals = steps.slice(0, index).filter((earlier) => earlier.kind === "propose");
        return proposals.length === 0
          ? <p className="text-[11px] leading-5 text-fg-muted">{t("applyNone")}</p>
          : select(index, "from", t("f_applyFrom"), [
            { value: "", label: t("branchNone") },
            ...proposals.map((earlier) => ({
              value: earlier.id,
              label: t("bindingStep", { id: earlier.id, kind: t("kind_propose") }),
            })),
          ]);
      }
      case "notify":
        return label(t("f_card"), (
          <input className="input font-mono text-xs" dir="ltr" readOnly
            aria-label={`${t("f_card")} — ${step.id}`} value="workflow_result" />
        ));
      case "wait":
        return (
          <p className="text-[11px] leading-5 text-fg-muted">{t("wait_decision")}</p>
        );
      default:
        return null;
    }
  }

  /** the connector line, with the `+` that inserts a step AT this position */
  const connector = (at: number) => (
    <div className="flex flex-col items-center">
      <span aria-hidden className="h-3 w-px bg-border" />
      <button
        type="button"
        aria-label={t("addStepAt", { position: digits(at + 1, locale) })}
        title={t("addStep")}
        /* 2026-09-03: the theme's 28px icon button. The size was already
           right; the CIRCLE was the invention — and a `+` on a connector line
           is still unmistakably a `+` on a connector line at an 8px corner.
           `.btn` draws no border of its own, so the outline this control is
           made of is stated explicitly. */
        className="btn btn-icon border border-border bg-surface text-fg-muted hover:border-accent hover:text-accent"
        onClick={() => insertStep(at)}
      >
        <IconPlus width={12} height={12} />
      </button>
      <span aria-hidden className="h-3 w-px bg-border" />
    </div>
  );

  const chosenTrigger = trigger === "" ? null : trigger;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={workflow ? t("titleEdit", { name: savedName.current }) : t("title")}
    >
      {/*
        No backdrop-click close, deliberately: this is an editor holding
        unsaved arrangement, and a stray click landing on the dim is not a
        request to throw it away. The ✕ and Escape are the doors.
      */}
      <div className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <header className="flex items-center gap-2 border-b border-border px-5 py-4">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {workflow ? t("titleEdit", { name: savedName.current }) : t("title")}
          </h2>
          <button
            type="button"
            aria-label={t("close")}
            title={t("close")}
            /* 2026-09-03: `.btn btn-icon` — the same ✕ the run dialog wears */
            className="btn btn-icon shrink-0 text-fg-muted hover:bg-surface-2 hover:text-fg"
            onClick={onClose}
          >
            <IconClose width={14} height={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {label(t("nameLabel"), (
            <input
              className="input text-sm"
              placeholder={t("namePlaceholder")}
              value={name}
              onChange={(changeEvent) => setName(changeEvent.target.value)}
            />
          ))}
          {/* description travels only at CREATE: `patchWorkflow` on the
              client carries no description field, and a box that silently
              stops saving after the first save is worse than no box */}
          {workflow === null ? (
            <div className="mt-3">
              {label(t("descriptionLabel"), (
                <input
                  className="input text-sm"
                  placeholder={t("descriptionPlaceholder")}
                  value={description}
                  onChange={(changeEvent) => setDescription(changeEvent.target.value)}
                />
              ))}
            </div>
          ) : null}

          {/* ── trigger ─────────────────────────────────────────────── */}
          {/* group-label role: no tracking on Persian (2026-09-03) */}
          <h3 className="mt-6 text-group-label font-semibold text-fg-subtle">
            {t("triggerTitle")}
          </h3>
          {picking ? (
            <ul className="mt-2 space-y-2">
              {WORKFLOW_TRIGGER_KINDS.map((kind) => {
                const settable = TRIGGER_SETTABLE[kind] === true;
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      disabled={!settable}
                      className={`w-full rounded-xl border p-3 text-start transition-colors ${
                        settable
                          ? "border-border bg-surface-2/40 hover:border-accent"
                          : "border-dashed border-border opacity-60"}`}
                      onClick={() => { setTrigger(kind); setPicking(false); }}
                    >
                      <span className="block text-sm font-medium text-fg">{t(`trigger_${kind}`)}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-fg-muted">
                        {t(`triggerHint_${kind}`)}
                      </span>
                      {/* the reason travels WITH the option: an unexplained
                          disabled row reads as a broken control */}
                      {settable ? null : (
                        <span className="mt-1 block text-xs leading-5 text-warning">
                          {t("triggerUnavailable")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : chosenTrigger === null ? (
            /* the reference's empty selector card: one dashed target that
               says what a trigger IS before asking which one */
            <button
              type="button"
              className="mt-2 w-full rounded-xl border border-dashed border-border p-4 text-start transition-colors hover:border-accent"
              onClick={() => setPicking(true)}
            >
              <span className="block text-sm font-medium text-fg">{t("triggerSelect")}</span>
            </button>
          ) : (
            <div className="well mt-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg">{t(`trigger_${chosenTrigger}`)}</span>
                <button
                  type="button"
                  /* 2026-09-03: `.btn btn-sm`, the theme's compact control */
                  className="btn btn-sm ms-auto border border-border font-medium text-fg-muted hover:text-fg"
                  onClick={() => setPicking(true)}
                >
                  {t("triggerChange")}
                </button>
              </div>
              <p className="mt-0.5 text-xs leading-5 text-fg-muted">
                {t(`triggerHint_${chosenTrigger}`)}
              </p>
              {chosenTrigger === "event" ? (
                <div className="mt-3">
                  {label(t("eventLabel"), (
                    <SelectMenu
                      className="text-xs"
                      ariaLabel={t("eventLabel")}
                      value={event}
                      onChange={setEvent}
                      options={WORKFLOW_EVENTS.map((name_) => ({
                        /* the key DERIVES from the event name. The previous
                           line hardcoded one key for every entry, which read
                           fine with one event and rendered the same sentence
                           twice the day a second landed (user screenshot,
                           2026-08-28: "two same events") */
                        value: name_, label: t(`event_${name_.replace(".", "_")}`),
                      }))}
                    />
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-fg">{t("enabledLabel")}</span>
                <button
                  type="button"
                  aria-label={t("enabledLabel")}
                  aria-pressed={enabled}
                  /* 2026-09-03: `.btn btn-sm`, the theme's compact control */
                  className={`btn btn-sm ms-auto border font-medium ${
                    enabled
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-fg-muted"}`}
                  onClick={() => setEnabled(!enabled)}
                >
                  {enabled ? t("enabled") : t("disabled")}
                </button>
              </div>
            </div>
          )}

          {/* ── steps ───────────────────────────────────────────────── */}
          <div className="mt-6 flex items-center gap-3">
            <h3 className="text-group-label font-semibold text-fg-subtle">
              {t("stepsTitle")}
            </h3>
            {steps.length === 0 ? (
              <button
                type="button"
                className="ms-auto text-[11px] text-fg-muted underline-offset-2 hover:text-accent hover:underline"
                onClick={() => setSteps(starterSteps())}
              >
                {t("starter")}
              </button>
            ) : null}
          </div>

          {steps.length === 0 ? (
            <div className="mt-2 rounded-xl border border-dashed border-border p-4 text-center">
              <p className="text-xs leading-5 text-fg-muted">{t("stepsEmpty")}</p>
              <button
                type="button"
                /* 2026-09-03: `h-9 min-h-0 px-3 text-xs` re-answered the
                   question `.btn` already answers, in a size nothing else in
                   the product uses. `.btn-sm` is the theme's compact one. */
                className="btn-secondary btn-sm mt-3"
                onClick={() => insertStep(0)}
              >
                {t("addStep")}
              </button>
            </div>
          ) : (
            <ol className="mt-2">
              {steps.map((step, index) => (
                /* position AND id: the id alone collides the moment someone
                   types over one to match another — a transient duplicate key
                   is a React warning and a mis-rendered card, on the one
                   field this editor invites people to rewrite */
                <li key={`${index}:${step.id}`}>
                  {connector(index)}
                  <div className="well p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* NOT a control, and it must not be dressed as one
                          (control.guard worklist, 2026-09-03): this is the
                          step's ORDINAL — the number on the card, which
                          nobody presses. It keeps its fixed 24px circle
                          because the ordinals have to line up down the
                          column, and a `.chip` would grow with the digit and
                          shift the row the moment a workflow reached ۱۰. */}
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface text-[11px] text-fg-subtle">
                        {digits(index + 1, locale)}
                      </span>
                      <input
                        className="input w-24 font-mono text-xs"
                        dir="ltr"
                        aria-label={`${t("stepId")} — ${step.id}`}
                        value={step.id}
                        onChange={(changeEvent) => patchStep(index, "id", changeEvent.target.value)}
                      />
                      <div className="w-40">
                        <SelectMenu
                          className="text-xs"
                          ariaLabel={`${t("stepKind")} — ${step.id}`}
                          value={step.kind}
                          onChange={(value: string) => changeKind(index, value)}
                          options={WORKFLOW_STEP_KINDS.map((kind) => ({
                            value: kind, label: t(`kind_${kind}`),
                          }))}
                        />
                      </div>
                      {/* 2026-09-03: the puzzle's three moves are `.btn
                          btn-icon` now — the theme's 28px icon button, the
                          same one the row actions and the ✕ above wear. The
                          `disabled:opacity-30` goes with the geometry: `.btn`
                          owns the disabled face (opacity-50, pointer-events
                          off), and an arrow that dims further than every
                          other disabled control in the product is one more
                          invented shape. */}
                      <div className="ms-auto flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`${t("moveUp")} — ${step.id}`}
                          disabled={index === 0}
                          className="btn btn-icon text-fg-muted hover:bg-surface hover:text-fg"
                          onClick={() => moveStep(index, -1)}
                        >
                          <IconArrowUp width={14} height={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`${t("moveDown")} — ${step.id}`}
                          disabled={index === steps.length - 1}
                          className="btn btn-icon text-fg-muted hover:bg-surface hover:text-fg"
                          onClick={() => moveStep(index, 1)}
                        >
                          <IconArrowDown width={14} height={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`${t("removeStep")} — ${step.id}`}
                          className="btn btn-icon text-fg-muted hover:bg-danger/10 hover:text-danger"
                          onClick={() => removeStep(index)}
                        >
                          <IconTrash width={14} height={14} />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-fg-muted">
                      {t(`kindHint_${step.kind}`)}
                    </p>
                    {RUNNABLE.has(step.kind) ? null : (
                      <p className="mt-2 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-5 text-warning">
                        {t("notRunnable")}
                      </p>
                    )}
                    <div className="mt-3 space-y-2">{stepFields(step, index)}</div>
                  </div>
                </li>
              ))}
              <li>{connector(steps.length)}</li>
            </ol>
          )}
        </div>

        <footer className="border-t border-border px-5 py-4">
          {refusal ? (
            /* core's own sentence — it names the step and the rule, and a
               paraphrase would name neither */
            <p role="alert" dir="ltr"
              className="mb-3 rounded-lg bg-danger/10 px-3 py-2 font-mono text-[11px] leading-5 text-danger">
              {refusal}
            </p>
          ) : null}
          {/* 2026-09-03: a dialog footer is where `.btn-sm` lives. Both of
              these carried `h-9 min-h-0` — a 36px size invented on top of a
              class that already has one, which is how one modal ends up
              disagreeing with the next about how tall a Save is. */}
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
              {t("close")}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
