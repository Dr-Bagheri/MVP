"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AuthoredWorkflow, Me, WorkflowCard, WorkflowRunRecord } from "@/api/types";
import { Link, useRouter } from "@/i18n/routing";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { AssistantMenu } from "@/components/platform/AssistantMenu";
import { useCrumbTitle } from "@/components/platform/CrumbTitle";
import { WorkflowRunDialog } from "@/components/platform/WorkflowRunDialog";
import { WorkflowTile } from "@/components/platform/WorkflowTile";
import { MenuLayout } from "@/components/scaffold";
import { Card } from "@/components/ui";
import { Pagination, usePaged } from "@/components/Pagination";
import { KebabMenu, type KebabItem } from "@/components/rowActions";
import {
  Icon, IconPlay, IconRetry, IconToggleOff, IconToggleOn, type IconName,
} from "@/components/icons";
import { digits, formatDate, formatTime } from "@/lib/format";
import { notify } from "@/lib/notify";

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
 * engine id, so their Recents list is empty — which is the truth (a template
 * runs through the assistant and writes no `workflow_run` row), not a
 * failure to look.
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

export default function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = use(params);
  const t = useTranslations("workflows");
  const locale = useLocale();
  const router = useRouter();

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
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  /** the caller — `auto_draft_replies` is THEIR switch, not the org's */
  const [me, setMe] = useState<Me | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /** the capability was withdrawn between the read and the press */
  const [refused, setRefused] = useState(false);
  /** Run now, on a TEMPLATE: the source picker the ⋯ menu opens */
  const [picking, setPicking] = useState(false);
  /** Run now, on an ENGINE workflow: the request in flight */
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void api.workflows().then(setCards).catch(() => setCards([]));
    void api.engineWorkflows().then(setEngine).catch(() => setEngine([]));
    void api.workflowRuns().then(setRuns).catch(() => setRuns([]));
    void api.org().then((org) => setOrgName(org.name)).catch(() => setOrgName(null));
    void api.authoredWorkflows().then(setAuthored).catch(() => setAuthored(null));
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const card = cards?.find((entry) => entry.slug === handle);
  const engineRow = engine?.find((entry) => entry.handle === handle);
  const authoredRow = authored?.find((entry) => entry.handle === handle);

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
      return {
        kind: "engine" as const,
        /* the id `workflow_run.workflow_id` refers to */
        id: base.id,
        name: base.name,
        description: base.description,
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
    return null;
  }, [card, engineRow, authoredRow]);

  useCrumbTitle(subject?.name);

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
  const trigger = catalogueProcess?.trigger ?? served.trigger;
  const steps = catalogueProcess?.steps ?? served.steps ?? [];

  const mine = useMemo(
    () => runs.filter((run) => run.workflow_id === subject?.id),
    [runs, subject?.id],
  );
  const { page, setPage, pageCount, visible } = usePaged(mine);

  /**
   * Run now, for an ENGINE workflow: the engine's own manual trigger.
   *
   * A refusal is a NAMED sentence from core (a workflow needing un-runnable
   * kinds says which) and is surfaced verbatim — the refusal copy is core's
   * alone, because only core knows which rule was broken.
   */
  async function runEngine() {
    if (running) return;
    setRunning(true);
    try {
      const { run_id } = await api.runWorkflow(handle);
      router.push({ pathname: "/workflows/runs/[id]", params: { id: run_id } } as never);
    } catch (cause) {
      const detail = (cause as { detail?: string }).detail;
      notify(detail || t("runFailed"), "warn");
    } finally {
      setRunning(false);
    }
  }

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

  if (cards === null || engine === null || authored === undefined) return null;

  /* a shipped template is the vendor's; anything else is this org's */
  const creator = subject?.kind === "template" ? t("detailVendor") : orgName ?? t("detailVendor");

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
  const switchProps = subject === null
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
   * The ⋯ menu — the page's second entrance to the two things a person does
   * with a workflow, and the ONLY entrance to running one (user directive,
   * 2026-08-28: the list's Start buttons are gone, "it should only be run
   * from inside their own page").
   *
   * **Run now** means different things to the two kinds and the menu does not
   * blur them: a TEMPLATE runs on one thing you choose, so it opens the source
   * picker; an ENGINE workflow carries its own trigger and simply starts.
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
  const menuItems: KebabItem[] = subject === null ? [] : [
    {
      key: "run",
      label: running ? t("runStarting") : t("runNow"),
      icon: <IconPlay width={14} height={14} />,
      disabled: running || (subject.kind === "template" && subject.sourceKind === undefined),
      onSelect: subject.kind === "engine" ? () => void runEngine() : () => setPicking(true),
    },
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
  ];

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="workflows" />}>
        <div className="mx-auto w-full max-w-content px-5 pb-16 pt-5 md:px-10 md:pt-4">
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
                    <EnableSwitch {...switchProps!} busy={saving} failed={saveFailed} />
                  </div>
                </div>
                <KebabMenu label={t("detailMenu")} items={menuItems} />
              </header>

              {/* WHO / WHAT / WITH WHAT — the three facts a person checks
                  before trusting an automation, on one hairline-bounded row */}
              <dl className="my-8 grid gap-6 border-y border-border py-5 sm:grid-cols-3">
                <Meta label={t("detailCreatedBy")}>
                  <span className="flex items-center gap-2">
                    <span
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent"
                      aria-hidden
                    >
                      {creator.slice(0, 1)}
                    </span>
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

              <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
                <section className="rounded-xl border border-border bg-surface p-6">
                  <h2 className="text-lg font-semibold text-fg">{t("detailProcess")}</h2>

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
                  {mine.length === 0 ? (
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
                        {visible.map((run) => (
                          <li key={run.id}>
                            <Link
                              href={`/workflows/runs/${run.id}`}
                              className="tap flex items-center justify-between gap-3 py-2.5 hover:text-accent"
                            >
                              <span className="min-w-0 truncate text-sm text-fg">
                                {run.workflow}
                              </span>
                              <span className="shrink-0 text-xs text-fg-muted">
                                {`${formatDate(run.started_at, locale)} ${formatTime(run.started_at, locale)}`}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <Pagination page={page} pageCount={pageCount} onPage={setPage} />
                    </>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </MenuLayout>

      {picking && subject?.sourceKind !== undefined ? (
        <WorkflowRunDialog
          slug={handle}
          sourceKind={subject.sourceKind}
          title={subject.name}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </PlatformShell>
  );
}

/**
 * The providers a workflow of this source kind reads through — derived from
 * the connectors the platform actually supports (google, microsoft), never
 * from a hand-kept list of logos.
 */
function integrationsFor(
  /* the producer's own union, read off the wire type rather than re-spelled
     here — a hand-written copy is the drift shape */
  kind: WorkflowCard["source_kind"],
  labels: { gmail: string; outlook: string; googleCalendar: string; outlookCalendar: string },
): { key: string; icon: IconName; label: string }[] {
  return kind === "calendar_event"
    ? [
        { key: "google-calendar", icon: "calendar", label: labels.googleCalendar },
        { key: "outlook-calendar", icon: "calendar", label: labels.outlookCalendar },
      ]
    : [
        { key: "gmail", icon: "mail", label: labels.gmail },
        { key: "outlook", icon: "mail", label: labels.outlook },
      ];
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
