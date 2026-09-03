"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type {
  AuthoredWorkflow, MailDraft, Me, StarterWorkflow, WorkflowCard, WorkflowRunRecord,
} from "@/api/types";
import { Link, useRouter } from "@/i18n/routing";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { WorkflowTile } from "@/components/platform/WorkflowTile";
import { PageContainer } from "@/components/scaffold";
import { Switch } from "@/components/Switch";
import { Avatar } from "@/components/Avatar";
import { Card } from "@/components/ui";
import { Pagination, usePaged } from "@/components/Pagination";
import { ConfirmDialog, KebabMenu, type KebabItem } from "@/components/rowActions";
import {
  Icon, IconPlay, IconRetry, IconToggleOff, IconToggleOn, IconTrash, type IconName,
} from "@/components/icons";
import { digits, formatDate, formatTime } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useWorkflowCopy } from "@/lib/workflowName";
import { WorkflowBuilder } from "@/components/platform/WorkflowBuilder";
import { OFFERED_CONNECTOR_PROVIDERS } from "@echo/core/vocabulary";

/**
 * ONE workflow: what it does, and what it has done.
 *
 * The list at `/workflows` answers "which ones exist"; this answers "what
 * will this one actually do to my inbox before I switch it on", which is the
 * question a person has to answer for themselves before they trust an
 * automation. So the page is two panels: the PROCESS (its trigger and its
 * steps, in order) and the RUNS (what is coming, and what already happened).
 *
 * ── The three things this page refuses to invent ────────────────────────────
 *
 * **The steps.** They are the workflow's promise, and a plausible-looking
 * invented list would be the most convincing lie on the screen. Core is
 * growing `trigger`/`steps` on the card wire; until that lands the two
 * SHIPPED templates read their text from the message catalogue — shipped
 * product content localizes, exactly as system skills' names and starter
 * questions do (`lib/skillName.ts` carries that ruling). A workflow that is
 * neither on the wire nor in the catalogue renders the panel with whatever
 * it does have and one honest line where the steps would be.
 *
 * **The switch.** A toggle that looks live and changes nothing is the defect
 * class this repo tracks, so the four cases are decided in one place
 * (`switchProps`, in the render) and each one renders a control that either
 * genuinely moves something or is not a button at all: db/0115's PERSONAL
 * `auto_draft_replies` on the mail template, the ORG's enabled flag on an
 * engine workflow an admin may move, that same flag read-only for everyone
 * else, and — where no flag is stored anywhere — a pill that says so.
 * Un-migrated is its own case: an ABSENT `auto_draft_replies` is reported as
 * unavailable, never as "off", because "off" is a claim that somebody chose.
 *
 * **The runs.** Rows are matched on `workflow_id`, never on the workflow's
 * NAME: two workflows may share a name, and a name match would quietly
 * attribute one workflow's history to another. Template cards have no
 * engine id, so no `workflow_run` row can belong to them — which is the
 * truth, not a failure to look.
 *
 * ── What "Recents" actually lists ───────────────────────────────────────────
 *
 * Two kinds of thing, merged, newest first (user directive, 2026-08-28: "it
 * must be selectable. when you selected it the draft must come like this
 * already prepared with the email on top of it as well").
 *
 * A mail workflow's whole output is a REPLY DRAFT, and a template writes no
 * run row at all — so on the screen that matters most the runs list was
 * permanently empty while the person had a dozen drafts sitting in the
 * assistant. Drafts are attached only to a MAIL-sourced workflow: they carry
 * no `workflow_id`, so the source kind is the only honest link, and hanging
 * them under a calendar workflow would be a list of things it never did.
 *
 * Both kinds are one list rather than two panels because they answer one
 * question — what has this done lately — and each row carries its own
 * destination: a run opens its run page, a draft opens the conversation it
 * was written in.
 */

/** The engine catalogue's row, as `api.engineWorkflows()` serves it. */
interface EngineWorkflow {
  id: string;
  handle: string;
  name: string;
  description: string;
}

/** One line of the Process panel: a trigger, or a numbered step. */
interface ProcessStep {
  title: string;
  description: string;
}

interface WorkflowProcess {
  trigger?: ProcessStep;
  steps?: ProcessStep[];
}

/** One Recents line, whatever kind of record it came from. */
interface RecentRow {
  key: string;
  title: string;
  /** ISO — the merge sorts on it, so both kinds must supply a real one */
  at: string;
  /** null makes the row a record rather than a link, and nothing else does */
  href: string | null;
}

/**
 * The catalogue entry holding a SHIPPED template's process text, by slug.
 *
 * Two spellings reach the same entry on purpose: `db/0065` seeds the meeting
 * template as `prepare-meetings`, and it is also referred to in full as
 * `prepare-me-for-meetings`. One catalogue entry, both keys accepted, so the
 * page is right whichever spelling a deployment carries — a second copy of
 * the text would be a second thing to keep in step.
 */
/**
 * The one shipped template that owns db/0115's personal switch.
 *
 * Named rather than inlined because it is a JOIN between two things that
 * have no other link — a seeded slug in `db/0065` and a column on
 * `app_user` — and a bare string comparison in the middle of a render would
 * read as a styling condition.
 */
const AUTO_DRAFT_SLUG = "draft-email-replies";
/** the calendar template, whose switch is db/0117's */
/* the SERVER's slug (db/0065 seeds `prepare-meetings`) — I first wrote the
   long form the card's title suggests, and the page answered "no such
   workflow": a slug is data, not a name you can infer from a heading */
const MEETING_PREP_SLUGS: readonly string[] = ["prepare-meetings", "prepare-me-for-meetings"];

/**
 * Which shipped STARTER implements which template.
 *
 * The bridge between the two catalogues: `draft-email-replies` is a
 * `workflow_template` row with product copy, and `wf-starter-mail-reply` is
 * the real graph that does the same job. Installing the starter is what
 * turns the page's prose into a program someone can rearrange.
 */
const STARTER_FOR: Readonly<Record<string, string>> = {
  "draft-email-replies": "wf-starter-mail-reply",
};

const PROCESS_KEY: Readonly<Record<string, string>> = {
  "draft-email-replies": "draft-email-replies",
  "prepare-meetings": "prepare-meetings",
  "prepare-me-for-meetings": "prepare-meetings",
};

function isStep(value: unknown): value is ProcessStep {
  return (
    typeof value === "object" && value !== null
    && typeof (value as ProcessStep).title === "string"
    && typeof (value as ProcessStep).description === "string"
  );
}

/**
 * The process as the SERVER states it.
 *
 * The cast is a deliberate forward-read of two fields landing on core's card
 * wire right now, not a drift someone declined to file: it compiles today
 * against the wire as it is, and starts returning real values the moment
 * core serves them, with no edit here. The shape is checked at runtime
 * because a wire field arriving in some other shape must fall through to the
 * catalogue rather than render `undefined` in a numbered list.
 */
function wireProcess(card: WorkflowCard): WorkflowProcess {
  const wire = card as WorkflowCard & Partial<WorkflowProcess>;
  const steps = Array.isArray(wire.steps) && wire.steps.every(isStep) ? wire.steps : undefined;
  return { trigger: isStep(wire.trigger) ? wire.trigger : undefined, steps };
}


/** a graph step, shape-checked off the wire */
function isGraphStep(value: unknown): value is { id: string; kind: string } {
  return typeof value === "object" && value !== null
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { kind?: unknown }).kind === "string";
}

/**
 * One step, in a sentence, for the read-only Process panel.
 *
 * The instruction is the interesting part of an `ask` or an `extract` and it
 * is the AUTHOR'S OWN WORDS — so it is shown, not summarised. Everything else
 * gets its kind label alone: a `decide`'s operator and a `propose`'s bindings
 * are the editor's business, and a numbered list that tries to narrate them
 * turns into a worse version of the editor.
 */
function describeStep(
  step: { id: string; kind: string } & Record<string, unknown>,
  tb: (key: string, values?: Record<string, string>) => string,
): string {
  const instruction = typeof step.instruction === "string" ? step.instruction.trim() : "";
  if (instruction) return instruction;
  if (step.kind === "fetch" && typeof step.source_kind === "string") {
    return tb(`source_${step.source_kind}`);
  }
  if (step.kind === "propose" && typeof step.proposal === "string") {
    return tb(`proposal_${step.proposal}`);
  }
  return tb(`kind_${step.kind}`);
}

export default function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = use(params);
  const t = useTranslations("workflows");
  const tb = useTranslations("builder");
  const router = useRouter();
  const workflowCopy = useWorkflowCopy();
  const locale = useLocale();

  const [cards, setCards] = useState<WorkflowCard[] | null>(null);
  const [engine, setEngine] = useState<EngineWorkflow[] | null>(null);
  /**
   * Three states, and the middle one is the point: `undefined` while the read
   * is in flight, `null` when it was REFUSED (the caller is not an admin —
   * which is why the switch renders read-only), an array when it was read.
   * Collapsing the refusal into an empty array would make "not yours to see"
   * indistinguishable from "this org has authored none".
   */
  const [authored, setAuthored] = useState<AuthoredWorkflow[] | null | undefined>(undefined);
  /** the shipped LIBRARY — `null` while loading, `[]` when the read failed */
  const [starters, setStarters] = useState<StarterWorkflow[] | null>(null);
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  /** the person's reply drafts — a mail workflow's actual output */
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  /** the caller — `auto_draft_replies` is THEIR switch, not the org's */
  const [me, setMe] = useState<Me | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /** the capability was withdrawn between the read and the press */
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    void api.workflows().then(setCards).catch(() => setCards([]));
    void api.engineWorkflows().then(setEngine).catch(() => setEngine([]));
    void api.workflowRuns().then(setRuns).catch(() => setRuns([]));
    void api.mailDrafts().then(setDrafts).catch(() => setDrafts([]));
    void api.org().then((org) => setOrgName(org.name)).catch(() => setOrgName(null));
    void api.authoredWorkflows().then(setAuthored).catch(() => setAuthored(null));
    void api.me().then(setMe).catch(() => setMe(null));
    /* try/catch AND .catch — a client without the method throws
       synchronously, and that must degrade the same way a rejection does */
    try {
      void api.workflowStarters().then(setStarters).catch(() => setStarters([]));
    } catch {
      setStarters([]);
    }
  }, []);

  /**
   * The GRAPH, when this workflow has one.
   *
   * This is what "the steps must be editable" comes down to: a shipped
   * template's process is product copy over a hardcoded sweep, and an
   * authored workflow's process is a program. When the person has the
   * program, the panel shows the program — because those are the steps that
   * would change if they changed them, and showing prose beside an editor
   * that governs something else is the worst of both.
   */
  const [graph, setGraph] = useState<{ steps: { id: string; kind: string }[] } | null>(null);
  const [editing, setEditing] = useState(false);
  /** Run now, for a manual workflow: the request in flight */
  /** the are-you-sure popup, open */
  const [removing, setRemoving] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  /** installing this starter for the org — the request in flight */
  const [installing, setInstalling] = useState(false);

  const card = cards?.find((entry) => entry.slug === handle);
  const engineRow = engine?.find((entry) => entry.handle === handle);
  const authoredRow = authored?.find((entry) => entry.handle === handle);
  /** the shipped library's entry for this handle — the UNINSTALLED case */
  const starterDef = starters?.find((entry) => entry.handle === handle);

  /**
   * The subject, resolved from whichever catalogue holds it.
   *
   * An ENGINE row wins over a template card of the same handle: `db/0105`
   * migrated org-authored templates into real workflows keeping the slug as
   * the handle, so both lists can legitimately hold one thing, and only the
   * engine row has an id that runs and a flag that switches.
   */
  const subject = useMemo(() => {
    const base = engineRow ?? authoredRow;
    if (base) {
      const copy = workflowCopy({
        handle, name: base.name, description: base.description,
      });
      return {
        kind: "engine" as const,
        /* the id `workflow_run.workflow_id` refers to */
        id: base.id,
        name: copy.name,
        description: copy.description,
        icon: card?.icon ?? "sparkles",
        color: card?.color ?? "violet",
        sourceKind: card?.source_kind,
        /* an engine row is in the catalogue only while published AND
           enabled, so its presence IS the enabled state when the authoring
           row is not ours to read */
        enabled: authoredRow ? authoredRow.enabled : true,
        manageId: authoredRow?.id,
      };
    }
    if (card) {
      return {
        kind: "template" as const,
        id: card.id,
        name: card.name,
        description: card.description,
        icon: card.icon,
        color: card.color,
        sourceKind: card.source_kind,
        enabled: true,
        manageId: undefined,
      };
    }
    /*
     * An UNINSTALLED shipped starter (user directive, 2026-08-28: "make all
     * the workflows that you put in skill real in workflow section"). LAST
     * on purpose: the moment the org installs it, the engine/authored row
     * wins this resolution and the page becomes the installed view — the
     * library entry is only the subject while nothing real exists yet.
     */
    if (starterDef) {
      const copy = workflowCopy({
        handle, name: starterDef.name, description: starterDef.description,
      });
      return {
        kind: "starter" as const,
        /* no engine row exists yet, so no run can reference it — a null id
           matches nothing in the runs filter, which is the truth */
        id: null,
        name: copy.name,
        description: copy.description,
        icon: "sparkles",
        color: "violet",
        /* which integration the graph reads through, derived from its
           trigger: the mail starters fetch the triggering message, the prep
           starters the calendar event. Manual starters read only the org's
           own records and name no integration. */
        sourceKind: starterDef.trigger_event === "mail.received"
          ? ("mail_message" as const)
          : starterDef.trigger_event === "meeting.soon"
            ? ("calendar_event" as const)
            : undefined,
        enabled: false,
        manageId: undefined,
      };
    }
    return null;
  }, [card, engineRow, authoredRow, starterDef, handle, workflowCopy]);

  useCrumbTitle(subject?.name);

  /* editing a workflow is an admin act; a member reads the process and
     keeps their own switch */
  const isAdmin = me?.role === "admin" || me?.role === "owner";
  /*
   * The workflow that IMPLEMENTS this template, when the org has installed
   * it. Resolved separately from `subject` on purpose: if the authored row
   * became the subject, this page would stop being a template page — and
   * `auto_draft_replies`, which is the PERSON'S consent to have their mail
   * read, renders only for a template. Silently trading somebody's own
   * switch for the org's enabled flag is not a thing to do as a side effect
   * of adding an editor.
   */
  const backingRow = authored?.find((entry) => entry.handle === STARTER_FOR[handle]);
  const manageId = subject?.manageId ?? backingRow?.id;
  useEffect(() => {
    if (!manageId) { setGraph(null); return; }
    void api.workflowGraph(manageId)
      .then((answer) => {
        const steps = (answer.graph as { steps?: unknown } | null)?.steps;
        /* shape-checked, because a graph that arrives in some other shape
           must fall through to the catalogue text rather than render
           `undefined` in a numbered list */
        setGraph(Array.isArray(steps) && steps.every(isGraphStep) ? { steps } : null);
      })
      /* not published yet, or not ours to read — either way there is no
         program to show, and the shipped description is still true */
      .catch(() => setGraph(null));
  }, [manageId, editing]);

  /* the shipped text, read once per render of a known template */
  const catalogueProcess = useMemo((): WorkflowProcess | undefined => {
    const key = PROCESS_KEY[handle];
    if (key === undefined) return undefined;
    try {
      const raw = t.raw(`process.${key}`) as Partial<WorkflowProcess> | undefined;
      const steps = Array.isArray(raw?.steps) && raw.steps.every(isStep) ? raw.steps : undefined;
      return { trigger: isStep(raw?.trigger) ? raw.trigger : undefined, steps };
    } catch {
      /* no catalogue entry for this slug — the panel says so in words */
      return undefined;
    }
  }, [handle, t]);

  const served = card ? wireProcess(card) : {};
  /*
   * The CATALOGUE wins for a shipped template, and the wire wins for
   * everything else.
   *
   * The other order reads more natural and is wrong on this product's default
   * path: core would serve one language, so the day it starts serving `steps`
   * every Persian reader silently loses the Persian description of a process
   * that has not changed. A shipped template's text is product copy and
   * belongs in the catalogue with the rest of it; an org-authored workflow's
   * steps are the org's own words and can only come off the wire.
   * (`lib/skillName.ts` settled the same question the same way.)
   */
  /*
   * An AUTHORED workflow's trigger is a fact on its row, not prose in a
   * catalogue — so its card is derived from `trigger_event`, in the same
   * words the builder used when it was chosen. Without this the page said
   * "no process" above a workflow that runs every time an email arrives,
   * which is as wrong as a description gets.
   */
  /* an uninstalled starter's trigger is the same FACT an authored row
     carries — `trigger_event` — read from the library instead of the org's
     table, and rendered in the same words the builder uses */
  const triggerRow = authoredRow ?? (subject?.kind === "starter" ? starterDef : undefined);
  const authoredTrigger: ProcessStep | undefined = triggerRow
    ? triggerRow.trigger_event === null
      ? { title: tb("trigger_manual"), description: tb("triggerHint_manual") }
      : {
          /* the EVENT'S OWN sentence as the title — "with an event" answers
             a different question than the one a reader of this card asks */
          title: tb(`event_${triggerRow.trigger_event.replace(".", "_")}`),
          description: tb("triggerHint_event"),
        }
    : undefined;
  const trigger = catalogueProcess?.trigger ?? served.trigger ?? authoredTrigger;
  /*
   * THE GRAPH WINS over both, when there is one (user directive,
   * 2026-08-28: "all these is not just a text that we show, it must be
   * editable and part of the puzzled structure that we built").
   *
   * The catalogue-over-wire rule below still holds for everything else, and
   * for the same reason it always did — but it was a rule about two
   * DESCRIPTIONS of the same fixed process. A graph is not a description: it
   * is the thing that runs, and if the two disagree the graph is right.
   */
  const graphSteps: ProcessStep[] | undefined = graph
    ? graph.steps.map((step, index) => ({
        title: `${index + 1}. ${tb(`kind_${step.kind}`)}`,
        description: describeStep(step, tb),
      }))
    : undefined;
  /*
   * An uninstalled starter's program, straight off the library wire — the
   * SAME rendering an installed graph gets, because it is the same program:
   * install copies it verbatim. All-or-nothing on the shape check (the
   * page's own convention): a numbered list silently missing a malformed
   * step is a different promise, not a degraded one.
   */
  const starterSteps: ProcessStep[] | undefined =
    subject?.kind === "starter" && starterDef
      && Array.isArray(starterDef.graph?.steps) && starterDef.graph.steps.every(isGraphStep)
      ? starterDef.graph.steps.map((step, index) => ({
          title: `${index + 1}. ${tb(`kind_${step.kind}`)}`,
          description: describeStep(step, tb),
        }))
      : undefined;
  const steps = graphSteps ?? starterSteps ?? catalogueProcess?.steps ?? served.steps ?? [];

  const recents = useMemo((): RecentRow[] => {
    const fromRuns: RecentRow[] = runs
      .filter((run) => run.workflow_id === subject?.id)
      .map((run) => ({
        key: `run:${run.id}`,
        title: run.workflow,
        at: run.started_at,
        href: `/workflows/runs/${run.id}`,
      }));
    /*
     * A draft opens the CONVERSATION it was written in, which is where the
     * reply, its quoted original and the send button already live — there is
     * no second place to show one, and building a draft-detail page would be
     * a second copy of the card that the mailbox and the thread both hold.
     *
     * `session_id` is null on a draft written outside a conversation (the
     * poller's own auto-drafts, before M43's session capture). That row is
     * not a link, because there is nothing to open: a link to `/assistant`
     * with no conversation would land the person on a NEW empty thread and
     * read as the draft having vanished.
     */
    /* an UNINSTALLED mail starter gets no drafts: they were written by the
       running pipeline, and hanging them under a workflow that has never
       run would be a list of things it never did */
    const fromDrafts: RecentRow[] = subject?.kind === "starter" || subject?.sourceKind !== "mail_message" ? [] : drafts
      .map((draft) => ({
        key: `draft:${draft.id}`,
        title: t("detailDraftTo", { subject: draft.subject }),
        at: draft.created_at,
        href: draft.session_id === null ? null : `/assistant?c=${draft.session_id}`,
      }));
    return [...fromRuns, ...fromDrafts].sort((a, b) => b.at.localeCompare(a.at));
  }, [runs, drafts, subject?.id, subject?.sourceKind, subject?.kind, t]);
  const { page, setPage, pageCount, visible } = usePaged(recents);

  /** the org's switch: an admin publishing or pausing an engine workflow */
  async function toggleOrgWorkflow() {
    if (!subject?.manageId || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const updated = await api.patchWorkflow(subject.manageId, { enabled: !subject.enabled });
      /* the SERVER's answer is adopted, never an optimistic flip: if core
         normalised or refused part of the change, that is the value */
      setAuthored((current) =>
        (current ?? []).map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (cause) {
      if ((cause as { status?: number }).status === 403) setRefused(true);
      else setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  /**
   * START A TAKE WHEN I RUN THIS (db/0142, user directive 2026-08-29).
   *
   * A switch rather than a step in the graph, and MINE rather than the
   * workflow's — both for reasons the migration spells out. A graph step
   * runs in the worker, which has no microphone; and `workflow_template`
   * has no org_id, so a flag there would switch recording on for every
   * organization on the deployment. "Start a recording when I run this" is
   * a statement about how somebody works.
   *
   * Turn it on and running the workflow from the assistant starts a take
   * through the same engine the record button uses, so the mini recorder
   * appears in the top bar exactly as it does for any other take.
   */
  /* the route param IS the template slug — `cards.find(e => e.slug === handle)`
     a few lines up — and it is the same string the assistant sends as its
     `workflow` parameter, so the switch and the run agree by construction */
  const recordSlug = handle;
  const recordsOnRun = (me?.record_on_workflows ?? []).includes(recordSlug);

  async function toggleRecordOnRun() {
    if (me?.record_on_workflows === undefined || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const current = me.record_on_workflows ?? [];
      const next = recordsOnRun
        ? current.filter((slug) => slug !== recordSlug)
        : [...current, recordSlug];
      /* the server's answer is adopted, never an optimistic flip — it
         dedupes and bounds the set, and that is the value */
      setMe(await api.updateAssistant({ record_on_workflows: next }));
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  /** MY switch: db/0117's `auto_meeting_prep`, the calendar's half */
  async function toggleMeetingPrep() {
    if (me?.auto_meeting_prep === undefined || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      setMe(await api.updateAssistant({ auto_meeting_prep: !me.auto_meeting_prep }));
    } catch {
      /* the page's own convention: the failure is shown ON the switch, not
         in a toast that outlives the control it is about */
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  /** MY switch: db/0115's `auto_draft_replies`, one person at a time */
  async function toggleAutoDraft() {
    if (me?.auto_draft_replies === undefined || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      setMe(await api.updateAssistant({ auto_draft_replies: !me.auto_draft_replies }));
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  if (cards === null || engine === null || authored === undefined || starters === null) {
    return null;
  }

  /* a shipped template OR an uninstalled starter is the vendor's; only an
     engine row — something this org actually holds — is the org's */
  const creator = subject?.kind === "engine" ? orgName ?? t("detailVendor") : t("detailVendor");

  /**
   * WHICH switch this workflow has — decided once, here, because the three
   * cases differ in what they mean, not just in what they call.
   *
   *  - `draft-email-replies` carries db/0115's PERSONAL switch. Every member
   *    has their own, so there is no admin gate and no refusal branch: the
   *    only way it can be un-pressable is the server not having the column
   *    yet, and that is `undefined` — reported as unavailable, never as off,
   *    because a switch reading "off" is a claim that somebody turned it off.
   *  - an engine workflow carries the ORG's enabled flag; only an admin who
   *    could read the authoring row may move it.
   *  - every other template has no stored flag anywhere, and says so.
   */
  const autoDraft = subject?.kind === "template" && handle === AUTO_DRAFT_SLUG;
  const meetingPrep = subject?.kind === "template" && MEETING_PREP_SLUGS.includes(handle);
  /* an uninstalled starter has NO switch anywhere — nothing is stored, so a
     pill would be a claim about a row that does not exist; its slot renders
     the install door instead (below) */
  const switchProps = subject === null || subject.kind === "starter"
    ? null
    : autoDraft
      ? {
          enabled: me?.auto_draft_replies === true,
          onToggle: me?.auto_draft_replies === undefined ? undefined : toggleAutoDraft,
          note: me?.auto_draft_replies === undefined
            ? t("detailSwitchUnavailable")
            : t("detailOwnSwitch"),
          hint: me?.auto_draft_replies === true ? t("detailAutoDraftOn") : t("detailAutoDraftHint"),
        }
      : meetingPrep
        ? {
            enabled: me?.auto_meeting_prep === true,
            onToggle: me?.auto_meeting_prep === undefined ? undefined : toggleMeetingPrep,
            note: me?.auto_meeting_prep === undefined
              ? t("detailSwitchUnavailable")
              : t("detailOwnSwitch"),
            hint: me?.auto_meeting_prep === true ? t("detailMeetingPrepOn") : t("detailMeetingPrepHint"),
          }
      : subject.kind === "engine"
        ? {
            enabled: subject.enabled,
            onToggle: subject.manageId !== undefined && !refused ? toggleOrgWorkflow : undefined,
            note: subject.manageId !== undefined && !refused ? null : t("detailAdminControls"),
            hint: null,
          }
        : { enabled: true, onToggle: undefined, note: t("detailNoSwitch"), hint: null };

  /**
   * The ⋯ menu.
   *
   * **There is no Run now** (user directive, 2026-08-28: "remove the run now
   * for now, we dont need it"). It was the only manual entrance, and the
   * reason it can go is that these workflows are TRIGGERED: an email arrives,
   * a meeting approaches. A button that starts one by hand mostly produces a
   * run against whatever happens to be lying around, which is exactly the
   * "why did it answer all my old mail" complaint in a different costume.
   * `WorkflowRunDialog` and `runWorkflow` are untouched and still work; the
   * wiring lives in git at 75cc8d2 if a manual start is ever wanted back.
   *
   * **Turn on / Turn off** is the pill's handler, not a copy of it — one
   * decision (`switchProps`) with two entrances. When the pill is read-only
   * the item is absent rather than disabled-with-a-shrug: the pill already
   * says in words why it cannot move, and a second dead control does not.
   *
   * **There is no Remove.** Nothing in the API deletes a workflow — a template
   * is seeded and an engine workflow is paused, never destroyed — so a delete
   * item could only ever fail, and a menu item that cannot work is worse than
   * a missing one. Written down so the next person does not read the gap as an
   * oversight and add one.
   */
  /*
   * **Run now, for MANUAL workflows only** (user directive, 2026-08-28: "for
   * the one that set run manually add the run now in their kebab menu, for
   * the rest does not need").
   *
   * A manual workflow has no other way to start — the item is the whole
   * feature. A triggered one starts when its fact happens, and a Run-now
   * beside it mostly produces a run against whatever happens to be lying
   * around, which is how "why did it answer all my old mail" began.
   * `trigger_event === null` IS manual: the column is the trigger.
   */
  const isManual = authoredRow ? authoredRow.trigger_event === null : false;

  /**
   * INSTALL this starter for the org (admin; the server holds the wall).
   * On success the page is not navigated away from — the authored and
   * engine lists are re-read, the new row wins the subject resolution, and
   * this same page BECOMES the installed view with its graph and switch.
   * A 409 means another admin got there first; the re-read is the truth
   * either way, so only other failures are worth a sentence.
   */
  async function installThisStarter() {
    if (!starterDef || installing) return;
    setInstalling(true);
    try {
      await api.installStarter(starterDef.key);
    } catch (cause) {
      if ((cause as { status?: number }).status !== 409) {
        notify(t("starterInstallFailed"), "warn");
        setInstalling(false);
        return;
      }
    }
    await Promise.all([
      api.authoredWorkflows().then(setAuthored).catch(() => {}),
      api.engineWorkflows().then(setEngine).catch(() => {}),
    ]);
    setInstalling(false);
  }

  /**
   * RUN NOW LANDS IN THE ASSISTANT (user directive, 2026-08-29: "fix the run
   * now for all the workflow as well that when you run them they will land
   * in the AI assistant page like the agent and we can use them there with
   * the confirm").
   *
   * It used to start a GRAPH run and navigate to a run page, and the run
   * page answered "No such run is available" — the engine and that page
   * disagreeing about what exists. More to the point, a graph run is a
   * machine executing steps somewhere: there is nothing to confirm, nothing
   * to follow up, and nothing to say if it goes wrong except a status.
   *
   * The assistant is where a workflow is USABLE. `?workflow=<handle>` is the
   * same address the composer's own picker uses, so this button and that
   * menu are one path — and once there the person can talk to it, confirm
   * what it proposes, and keep the thread. It is also what makes the
   * recording switch work: a take can only start where somebody is.
   *
   * No API call, so no failure to report — the navigation IS the action, and
   * the assistant surfaces core's refusal in the thread if the workflow
   * cannot run.
   */
  function runManually() {
    router.push({ pathname: "/assistant", query: { workflow: handle } } as never);
  }

  const menuItems: KebabItem[] = subject === null ? [] : [
    ...(isManual
      ? [{
          key: "run",
          label: t("runNow"),
          icon: <IconPlay width={14} height={14} />,
          onSelect: () => runManually(),
        }]
      : []),
    ...(switchProps?.onToggle
      ? [{
          key: "enabled",
          label: switchProps.enabled ? t("detailTurnOff") : t("detailTurnOn"),
          icon: switchProps.enabled
            ? <IconToggleOn width={14} height={14} />
            : <IconToggleOff width={14} height={14} />,
          disabled: saving,
          onSelect: () => void switchProps.onToggle!(),
        }]
      : []),
    /*
     * REMOVE. Only for a workflow this org authored — a shipped template is
     * not ours to take away, and an item that could only ever fail is worse
     * than a missing one.
     */
    ...(isAdmin && authoredRow
      ? [{
          key: "remove",
          label: t("removeWorkflow"),
          icon: <IconTrash width={14} height={14} />,
          danger: true,
          onSelect: () => setRemoving(true),
        }]
      : []),
  ];

  return (
    <PlatformShell>
      {/* no section menu — Workflows is a rail destination now, and its
          sub-menu was the same door shown twice (2026-09-02) */}
        <PageContainer>
          {subject === null ? (
            <Card><p className="text-sm text-fg-muted">{t("detailMissing")}</p></Card>
          ) : (
            <>
              <header className="flex flex-wrap items-start gap-6">
                <WorkflowTile icon={subject.icon} color={subject.color} size="hero" />
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-semibold text-fg">{subject.name}</h1>
                  {subject.description ? (
                    <p className="mt-2 max-w-[70ch] text-sm leading-7 text-fg-muted">
                      {subject.description}
                    </p>
                  ) : null}
                  <div className="mt-5">
                    {subject.kind === "starter" ? (
                      /* the INSTALL door where the switch would sit. The
                         member line waits for the identity to answer — a
                         claim about who may install is not one to make
                         about an unknown caller. */
                      me === null ? null : isAdmin ? (
                        /* 2026-09-03: the theme's control, not a twelfth
                           invented size. `h-9 min-h-0 px-4 text-sm` was a
                           hand-rolled geometry wearing the very class that
                           exists to prevent one — and `disabled:opacity-60`
                           was a second answer to a question `.btn` already
                           answers (`disabled:opacity-50` with pointer events
                           off). This guard cannot see either, because the
                           class it re-answers is present. */
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={installing}
                          onClick={() => void installThisStarter()}
                        >
                          {installing ? t("starterInstalling") : t("starterInstall")}
                        </button>
                      ) : (
                        <p className="text-sm text-fg-muted">{t("starterAdminInstall")}</p>
                      )
                    ) : (
                      <EnableSwitch {...switchProps!} busy={saving} failed={saveFailed} />
                    )}
                  </div>
                </div>
                {/* a ⋯ with nothing in it is a dead control, not a menu —
                    an uninstalled starter has no acts of its own yet */}
                {menuItems.length > 0 ? (
                  <KebabMenu label={t("detailMenu")} items={menuItems} />
                ) : null}
              </header>

              {/* WHO / WHAT / WITH WHAT — the three facts a person checks
                  before trusting an automation, on one hairline-bounded row */}
              <dl className="my-8 grid gap-6 border-y border-border py-5 sm:grid-cols-3">
                <Meta label={t("detailCreatedBy")}>
                  <span className="flex items-center gap-2">
                    {/* 2026-09-03: the platform's mark, not a sixteenth
                        hand-drawn one. THE JUDGEMENT, said out loud because
                        the component is documented as the PERSON mark and
                        `creator` is an ORG name or the vendor's — never a
                        person. It converts anyway because the defect here is
                        the one Avatar owns: an initial taken from a NAME. This
                        site spelled it `.slice(0, 1)`, which is one of the two
                        exact spellings Avatar.tsx names as the drift — it takes
                        one code UNIT (an org named with an emoji renders the
                        replacement character) and it never uppercased, so an
                        org called "acme" showed "a" where every other mark in
                        the product shows "A". Reversible in one line if the
                        person-only reading is preferred. */}
                    <Avatar name={creator} size="xs" />
                    {creator}
                  </span>
                </Meta>
                <Meta label={t("detailCategory")}>
                  {subject.kind === "template"
                    ? t("detailCategoryFeatured")
                    : t("detailCategoryAutomation")}
                </Meta>
                <Meta label={t("detailIntegrations")}>
                  {subject.sourceKind === undefined ? (
                    "—"
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      {integrationsFor(subject.sourceKind, {
                        /* resolved HERE, as literal keys, so the catalogue
                           parity check can see them — a key handed around as
                           a variable is invisible to it by design */
                        gmail: t("detailGmail"),
                        outlook: t("detailOutlook"),
                        googleCalendar: t("detailGoogleCalendar"),
                        outlookCalendar: t("detailOutlookCalendar"),
                      }).map((entry) => (
                        <span
                          key={entry.key}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted"
                        >
                          {/* a 20px mark: an 18px glyph on the closed scale,
                              in a 20px box — no remote brand assets (CSP) */}
                          <span className="grid h-5 w-5 place-items-center" aria-hidden>
                            <Icon name={entry.icon} size="lg" />
                          </span>
                          {entry.label}
                        </span>
                      ))}
                    </span>
                  )}
                </Meta>
              </dl>

              {/*
                THE RECORDING SWITCH — its own row, because it is a different
                kind of fact from the on/off pill above. That one says whether
                the workflow runs at all; this one says what happens on the
                person's own screen when it does.
                
                Only for an engine workflow this caller may manage: a shipped
                template has no row to store the flag on, and offering the
                switch to somebody whose write RLS will refuse would be an
                affordance that does not mirror the wall.
              */}
              {me?.record_on_workflows !== undefined ? (
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{t("detailRecordTitle")}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-fg-muted">
                      {t("detailRecordHint")}
                    </span>
                  </span>
                  {/* the theme's switch (2026-09-03). It also settles two
                      local answers: the track was `bg-success` where every
                      other switch is `bg-accent` — success means "this is
                      healthy", not "this is on" — and the knob was `bg-bg`,
                      the opposite colour in dark theme to the white knob on
                      the settings rows. */}
                  <Switch
                    checked={recordsOnRun}
                    label={t("detailRecordTitle")}
                    disabled={saving}
                    onChange={() => void toggleRecordOnRun()}
                  />
                </div>
              ) : null}

              <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
                <section className="rounded-xl border border-border bg-surface p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-fg">{t("detailProcess")}</h2>
                    {/*
                      THE DOOR (user directive, 2026-08-28: "it must be
                      editable and part of the puzzled structure").
                      · with a graph → open it in the builder;
                      · without one → install this template as a real,
                        editable workflow of the org's own, then open it.
                      The second is one press and not a warning, because
                      "these steps are not yours yet" is a fact about our
                      plumbing that nobody outside this file should have to
                      learn.
                    */}
                    {/*
                      "Make these steps editable" LEFT (user directive,
                      2026-08-28) — the install-then-edit door on the mail
                      template read as a warning about our plumbing. Edit
                      remains for a workflow that HAS a graph; the shipped
                      template's prose stays prose.
                    */}
                    {isAdmin && manageId ? (
                      /* 2026-09-03: the theme's compact control. This was the
                         same `h-9 min-h-0` size restated on top of `.btn` as
                         the install button above it — two hand-rolled shapes
                         in one page, both invisible to the control guard for
                         the same reason (the class they re-answer is there). */
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setEditing(true)}
                      >
                        {t("editSteps")}
                      </button>
                    ) : null}
                  </div>

                  <p className="mt-6 text-xs font-medium text-fg-subtle">{t("detailTrigger")}</p>
                  {trigger ? (
                    <div className="mt-2 flex items-start gap-3 rounded-xl border border-border bg-surface-2/40 p-4">
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted"
                        aria-hidden
                      >
                        <Icon
                          name={subject.sourceKind === "calendar_event" ? "calendar" : "mail"}
                          size="md"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-fg">{trigger.title}</span>
                        <span className="mt-1 block text-sm leading-6 text-fg-muted">
                          {trigger.description}
                        </span>
                      </span>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-fg-muted">{t("detailNoProcess")}</p>
                  )}

                  {steps.length > 0 ? (
                    <>
                      <p className="mt-6 text-xs font-medium text-fg-subtle">{t("detailSteps")}</p>
                      <ol className="mt-2">
                        {steps.map((step, index) => {
                          const last = index === steps.length - 1;
                          return (
                            <li key={`${step.title}-${index}`} className="flex gap-4">
                              {/* the connector is a flex child, not an absolute
                                  overlay: it stretches to whatever height the
                                  card beside it takes, in either direction */}
                              <div className="flex w-8 shrink-0 flex-col items-center">
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg-muted">
                                  {digits(index + 1, locale)}
                                </span>
                                {last ? null : (
                                  <span aria-hidden className="w-px flex-1 bg-border" />
                                )}
                              </div>
                              <div
                                className={`min-w-0 flex-1 rounded-xl border border-border bg-surface-2/40 p-4 ${last ? "" : "mb-3"}`}
                              >
                                <p className="text-sm font-semibold text-fg">{step.title}</p>
                                <p className="mt-1 text-sm leading-6 text-fg-muted">
                                  {step.description}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  ) : null}
                </section>

                <section className="rounded-xl border border-border bg-surface p-6">
                  <h2 className="text-lg font-semibold text-fg">{t("detailRunsTitle")}</h2>

                  <p className="mt-6 text-xs font-medium text-fg-subtle">{t("detailUpcoming")}</p>
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/40 px-4 py-3">
                    <span className="min-w-0 truncate text-sm text-fg">{subject.name}</span>
                    {/* the same sentence the trigger card shows, from the same
                        source — two readings of one fact eventually disagree */}
                    <span className="shrink-0 text-xs text-fg-muted">{trigger?.title ?? "—"}</span>
                  </div>

                  <p className="mt-6 text-xs font-medium text-fg-subtle">{t("detailRecents")}</p>
                  {recents.length === 0 ? (
                    <div className="py-10 text-center">
                      <span
                        className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-fg-subtle"
                        aria-hidden
                      >
                        <IconRetry width={18} height={18} />
                      </span>
                      <p className="mt-3 text-sm text-fg-muted">{t("detailNeverRun")}</p>
                    </div>
                  ) : (
                    <>
                      <ul className="mt-2 divide-y divide-border">
                        {visible.map((row) => {
                          const face = (
                            <>
                              <span className="min-w-0 truncate text-sm text-fg">{row.title}</span>
                              <span className="shrink-0 text-xs text-fg-muted">
                                {`${formatDate(row.at, locale)} ${formatTime(row.at, locale)}`}
                              </span>
                            </>
                          );
                          return (
                            <li key={row.key}>
                              {/* a row with nowhere to go is not a link that
                                  quietly does nothing — it is a different
                                  element, so there is nothing to press */}
                              {row.href === null ? (
                                <span className="flex items-center justify-between gap-3 py-2.5">
                                  {face}
                                </span>
                              ) : (
                                <Link
                                  href={row.href}
                                  className="tap flex items-center justify-between gap-3 py-2.5 hover:text-accent"
                                >
                                  {face}
                                </Link>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <Pagination page={page} pageCount={pageCount} onPage={setPage} />
                    </>
                  )}
                </section>
              </div>
            </>
          )}
        </PageContainer>

      {/*
        Destructive actions confirm — the platform's rule, one dialog
        (`ConfirmDialog`), enforced by `confirm.guard.test.ts`. The body
        names the workflow and says what survives: removing it stops the
        automation and leaves its run history readable, which is a thing a
        person deciding this actually wants to know.
      */}
      {removing && authoredRow ? (
        <ConfirmDialog
          title={t("removeTitle", { name: authoredRow.name })}
          body={t("removeBody")}
          confirmLabel={t("removeConfirm")}
          cancelLabel={t("cancel")}
          busy={removeBusy}
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            if (removeBusy) return;
            setRemoveBusy(true);
            void api.removeWorkflow(authoredRow.id)
              .then(() => {
                setRemoving(false);
                router.push({ pathname: "/workflows" } as never);
              })
              .catch(() => notify(t("removeFailed"), "warn"))
              .finally(() => setRemoveBusy(false));
          }}
        />
      ) : null}

      {editing && (authoredRow ?? backingRow) ? (
        <WorkflowBuilder
          workflow={(authoredRow ?? backingRow)!}
          onClose={() => setEditing(false)}
          /* re-read the graph on save: the panel above must show what was
             just published, not what it showed before the edit */
          onSaved={() => {
            void api.authoredWorkflows().then(setAuthored).catch(() => {});
          }}
        />
      ) : null}
    </PlatformShell>
  );
}

/**
 * The providers a workflow of this source kind reads through.
 *
 * Filtered by what the platform currently OFFERS
 * (`OFFERED_CONNECTOR_PROVIDERS`) rather than by a hand-kept list of logos:
 * this row used to name Outlook beside Gmail, which is a promise the
 * integrations page could not keep once Microsoft came off the offer (user
 * directive, 2026-08-28: "we just go with the google").
 */
function integrationsFor(
  /* the producer's own union, read off the wire type rather than re-spelled
     here — a hand-written copy is the drift shape */
  kind: WorkflowCard["source_kind"],
  labels: { gmail: string; outlook: string; googleCalendar: string; outlookCalendar: string },
): { key: string; icon: IconName; label: string }[] {
  const offered = OFFERED_CONNECTOR_PROVIDERS as readonly string[];
  const rows = kind === "calendar_event"
    ? [
        { key: "google-calendar", provider: "google", icon: "calendar" as IconName, label: labels.googleCalendar },
        { key: "outlook-calendar", provider: "microsoft", icon: "calendar" as IconName, label: labels.outlookCalendar },
      ]
    : [
        { key: "gmail", provider: "google", icon: "mail" as IconName, label: labels.gmail },
        { key: "outlook", provider: "microsoft", icon: "mail" as IconName, label: labels.outlook },
      ];
  return rows.filter((row) => offered.includes(row.provider))
    .map(({ key, icon, label }) => ({ key, icon, label }));
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 text-sm text-fg">{children}</dd>
    </div>
  );
}

/**
 * The on/off pill.
 *
 * **`onToggle` absent is what makes it read-only** — not a `disabled` prop
 * beside a handler that still exists. A pill that renders as a button and
 * quietly does nothing is the defect this whole page was told to avoid, and
 * the way to make it unrepresentable is for the read-only case to be a
 * different ELEMENT with nothing to press. Every read-only case supplies a
 * `note` saying why, because a control that cannot move and does not say so
 * reads as broken.
 *
 * Colours: `text-bg` on `bg-success` rather than a literal white, because
 * `--bg` flips with the theme and `--success` does too — white on the dark
 * theme's bright green is the contrast failure the `--on-accent` episode was
 * about, one token over.
 */
function EnableSwitch({
  enabled,
  note,
  hint,
  busy,
  failed,
  onToggle,
}: {
  enabled: boolean;
  /** why this switch cannot be moved, or whose it is; null when it is live and needs no line */
  note: string | null;
  /** what being on actually does — rendered under the note */
  hint: string | null;
  busy: boolean;
  failed: boolean;
  /** absent = read-only, and there is no other way to be read-only */
  onToggle?: () => void | Promise<void>;
}) {
  const t = useTranslations("workflows");
  const live = onToggle !== undefined;
  /*
   * THE PADDING IS ONE EXPRESSION, not a base plus an override.
   *
   * It used to be `ps-1 pe-4` on the shell with `pe-1 ps-4` appended for the
   * ON state, which reads as "the later class wins" and is not how Tailwind
   * resolves anything: two utilities from the same group are settled by the
   * STYLESHEET's order, so `pe-4` beat `pe-1` and the ON pill carried a 16px
   * gap after its knob — the knob floating off the edge it is supposed to sit
   * against. Same family as the `rounded-md`/`rounded-full` trigger bug; the
   * fix that cannot lose the coin toss is to emit exactly one value.
   */
  const pad = enabled ? "ps-4 pe-1" : "ps-1 pe-4";
  /* the ON pill is FILLED green with the ground colour as its ink; the OFF
     pill is the neutral raised control, and keeps `border-strong` because
     `--surface-2` on `--bg` is well under the 3:1 a control boundary owes */
  const skin = enabled ? "bg-success text-bg" : "border border-border-strong bg-surface-2 text-fg";
  const shell = `tap relative inline-flex h-9 items-center gap-2 rounded-full text-sm font-medium transition-colors ${pad} ${skin}`;
  /* `bg-bg` on the green rather than a literal white: `--bg` and `--success`
     both flip with the theme, and a hard white knob is the `--on-accent`
     contrast failure one token over */
  const knob = `grid h-7 w-7 shrink-0 place-items-center rounded-full ${enabled ? "bg-bg" : "bg-fg"}`;

  const face = (
    <>
      {/* the knob leads in the OFF state and trails in the ON state; DOM
          order carries it, so RTL mirrors without a second rule */}
      {enabled ? null : <span className={knob} aria-hidden />}
      <span>{enabled ? t("detailReady") : t("detailTurnOn")}</span>
      {enabled ? <span className={knob} aria-hidden /> : null}
    </>
  );

  return (
    <div>
      {live ? (
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("detailEnable")}
          className={`${shell} disabled:opacity-60`}
          disabled={busy}
          onClick={() => void onToggle()}
        >
          {face}
        </button>
      ) : (
        <span
          role="switch"
          aria-checked={enabled}
          aria-disabled="true"
          aria-label={t("detailEnable")}
          className={shell}
        >
          {face}
        </span>
      )}
      {note ? <p className="mt-2 text-xs text-fg-muted">{note}</p> : null}
      {hint ? <p className="mt-1 max-w-[70ch] text-xs leading-5 text-fg-subtle">{hint}</p> : null}
      {failed ? (
        <p role="status" className="mt-2 text-xs text-danger">
          {t("detailToggleFailed")}
        </p>
      ) : null}
    </div>
  );
}
