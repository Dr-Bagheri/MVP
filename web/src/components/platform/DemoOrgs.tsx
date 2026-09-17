"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type {
  DemoLanguage, DemoOrganization, DemoSeedResult, SeedJobStart, SeedJobView, SeedReport,
} from "@/api/types";
import { DataTable } from "@/components/DataTable";
import { DateField } from "@/components/DateTimeFields";
import { ConfirmDialog } from "@/components/rowActions";
import { Chip, EmptyState, Field } from "@/components/ui";
import { IconCalendar, IconTrash } from "@/components/icons";
import { digits, formatDate } from "@/lib/format";
import { notifyError } from "@/lib/notify";
import { DemoSeedModal, type SeedJobEnd } from "./DemoSeedModal";

/**
 * SEED A DEMO ORGANISATION (M52) — the platform console's fourth tab.
 *
 * Three acts on one screen, in the order somebody performs them: fill the
 * form, watch the seed run, read the presenter's credentials ONCE, then live
 * with the list.
 *
 * The seed is a JOB (2026-09-09). Pressing create answers at once with a job
 * id, and `DemoSeedModal` stands over the form for the four minutes the seed
 * takes, polling core for the stage it is on — the button used to read
 * "Seeding…" over a page that looked hung, and the second press met a 409.
 * The modal cannot be dismissed while the seed runs and the form behind it
 * is inert, so the double press is not possible from this screen; core
 * refuses it too, by name, for anyone who reaches the route another way.
 *
 * The credentials panel is the part with a rule attached. Core generates the
 * password, delivers it on the finished poll and stores it nowhere — the
 * job is forgotten as it is delivered — so this component is the only place
 * it will ever exist, and it must not be dismissed by anything the eye can
 * trip over. It follows the connectors' SecretOnce discipline rather than
 * importing it: the dismissal is an explicit press, never a timer, never a
 * click-away, and the modal warns on `beforeunload` from the first second.
 *
 * The list is deliberately plain. A demo organisation is a real organisation
 * — it appears in the organizations tab too — and the only things this tab
 * knows that that one does not are its content LANGUAGE, the DAY its timeline
 * was measured from, and the two acts that only make sense here: re-seed for
 * a new date, and remove it whole.
 */

type SeedInFlight =
  | { kind: "create"; name: string; job: SeedJobStart }
  | { kind: "reseed"; name: string; job: SeedJobStart };

const todayLocal = (): string => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
};

/** The finished poll's `result` is a DemoSeedResult for a create — read
    by SHAPE rather than cast, so a job of the other kind cannot be rendered
    as credentials it does not carry. */
function createResultOf(view: SeedJobView): DemoSeedResult | null {
  const result = view.result;
  if (result === null || typeof result !== "object") return null;
  const candidate = result as Partial<DemoSeedResult>;
  if (typeof candidate.org_id !== "string" || candidate.owner === undefined) return null;
  if (typeof candidate.owner.email !== "string" || typeof candidate.owner.password !== "string") return null;
  if (candidate.report === undefined) return null;
  return candidate as DemoSeedResult;
}

function reseedReportOf(view: SeedJobView): SeedReport | null {
  const result = view.result;
  if (result === null || typeof result !== "object") return null;
  const report = (result as { report?: unknown }).report;
  if (report === null || typeof report !== "object") return null;
  return report as SeedReport;
}

export function DemoOrgs() {
  const t = useTranslations("platformRoot");
  const tCommon = useTranslations("common");
  const tGateway = useTranslations("gateway");
  const locale = useLocale();

  const [rows, setRows] = useState<DemoOrganization[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** the read came back REFUSED — not the same as "no demos yet" */
  const [listFailed, setListFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** the seed the modal is standing over, if any */
  const [seedJob, setSeedJob] = useState<SeedInFlight | null>(null);

  const [name, setName] = useState("");
  const [language, setLanguage] = useState<DemoLanguage>("fa");
  const [demoDate, setDemoDate] = useState(todayLocal());
  const [offset, setOffset] = useState("20");
  const [presenter, setPresenter] = useState("");

  const [confirmDelete, setConfirmDelete] = useState<DemoOrganization | null>(null);
  const [reseeding, setReseeding] = useState<DemoOrganization | null>(null);
  const [reseedDate, setReseedDate] = useState(todayLocal());

  const load = useCallback(() => {
    void api
      .demoOrganizations()
      .then((items) => { setRows(items); setListFailed(false); })
      .catch(() => setListFailed(true))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(load, [load]);

  const failed = (cause: unknown, fallback: string) =>
    notifyError(cause instanceof BffError ? (cause.detail ?? fallback) : fallback);

  async function seed() {
    if (busy || seedJob !== null) return;
    setBusy(true);
    const orgName = name.trim() === "" ? t(`demoDefaultName_${language}`) : name.trim();
    try {
      const job = await api.createDemoOrganization({
        name: orgName,
        language,
        demo_date: demoDate,
        offset_minutes: Number(offset) || 20,
        ...(presenter.trim() === "" ? {} : { presenter_email: presenter.trim() }),
        /* the audit reason is the console's own sentence: this tab has one
           purpose, and asking a person to type it before every press is a
           field that only ever holds the same words */
        reason: t("demoCreateReason"),
      });
      setSeedJob({ kind: "create", name: orgName, job });
    } catch (cause) {
      failed(cause, t("demoSeedFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function reseed() {
    const target = reseeding;
    if (target === null || busy || seedJob !== null) return;
    setBusy(true);
    try {
      const job = await api.reseedDemoOrganization(target.id, {
        demo_date: reseedDate,
        offset_minutes: Number(offset) || 20,
        reason: t("demoReseedReason"),
      });
      setReseeding(null);
      setSeedJob({ kind: "reseed", name: target.name, job });
    } catch (cause) {
      failed(cause, t("demoReseedFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const target = confirmDelete;
    if (target === null || busy) return;
    setBusy(true);
    try {
      const result = await api.deleteDemoOrganization(
        target.id, t("demoDeleteReason"),
      );
      /* an identity that would not go is an account somebody has to clear by
         hand — saying so is the whole reason core returns the list */
      if (result.identities_stranded.length > 0) {
        notifyError(t("demoIdentitiesStranded", {
          ids: result.identities_stranded.join(", "),
        }));
      }
      setConfirmDelete(null);
      load();
    } catch (cause) {
      failed(cause, t("demoDeleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  /* whatever the seed's end, the list is re-read — a finished create is a
     row, and a failed one may have left an organisation standing */
  const onSeedSettled = useCallback((end: SeedJobEnd) => {
    if (end.status === "done") {
      setName("");
      setPresenter("");
    }
    load();
  }, [load]);

  const formInert = busy || seedJob !== null;

  return (
    <section className="mt-4">
      <div className="card mb-3">
        <p className="mb-3 text-sm font-semibold text-fg">{t("demoNew")}</p>

        {/* inert while a seed is in flight — the modal covers it, and the
            fieldset is what keeps it inert for a keyboard as well */}
        <fieldset disabled={formInert} className="m-0 min-w-0 border-0 p-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("demoName")}>
              <input
                className="input"
                value={name}
                placeholder={t(`demoDefaultName_${language}`)}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label={t("demoLanguage")}>
              {/* a RADIO pair rather than a select: two mutually exclusive
                  values, both worth seeing without a press, and the choice
                  decides which content pack is written — not the interface,
                  which follows the reader's own locale */}
              <div className="flex items-center gap-4 pt-1.5">
                {(["fa", "en"] as const).map((value) => (
                  <label key={value} className="tap flex items-center gap-2 text-sm text-fg">
                    <input
                      type="radio"
                      name="demo-language"
                      value={value}
                      checked={language === value}
                      onChange={() => setLanguage(value)}
                    />
                    {t(`demoLanguage_${value}`)}
                  </label>
                ))}
              </div>
            </Field>

            <Field label={t("demoDate")} hint={t("demoDateHint")}>
              <DateField value={demoDate} onChange={setDemoDate} />
            </Field>

            <Field label={t("demoOffset")}>
              <input
                className="input"
                dir="ltr"
                inputMode="numeric"
                value={offset}
                onChange={(e) => setOffset(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>

            <Field label={t("demoPresenter")} hint={t("demoPresenterHint")}>
              <input
                className="input"
                dir="ltr"
                type="email"
                value={presenter}
                placeholder={t("demoPresenterPlaceholder")}
                onChange={(e) => setPresenter(e.target.value)}
              />
            </Field>

          </div>
        </fieldset>

        <div className="mt-4 flex items-center gap-2">
          <button
            className="btn-primary"
            disabled={formInert}
            onClick={() => void seed()}
          >
            {formInert ? t("demoSeeding") : t("demoCreate")}
          </button>
        </div>
      </div>

      <div className="mt-3">
        <DataTable
          hideHeader
          loading={!loaded}
          empty={<EmptyState text={listFailed ? t("demoListFailed") : t("demoEmpty")} />}
          rows={rows}
          rowKey={(row: DemoOrganization) => row.id}
          columns={[
            {
              key: "name",
              header: t("demoName"),
              cell: (row: DemoOrganization) => (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{row.name}</p>
                  <p className="ltr truncate text-xs text-fg-muted">{row.owner_email ?? "—"}</p>
                </div>
              ),
            },
            {
              key: "language",
              header: t("demoLanguage"),
              cell: (row: DemoOrganization) => (
                <Chip tone="neutral">
                  {row.language === null ? "—" : t(`demoLanguage_${row.language === "fa" ? "fa" : "en"}`)}
                </Chip>
              ),
            },
            {
              key: "demoDate",
              header: t("demoDate"),
              cell: (row: DemoOrganization) => (
                <span className="text-sm text-fg-muted">
                  {row.demo_date === null ? "—" : formatDate(row.demo_date, locale)}
                </span>
              ),
            },
            {
              key: "created",
              header: t("demoCreated"),
              cell: (row: DemoOrganization) => (
                <span className="text-sm text-fg-muted">
                  {formatDate(row.created_at, locale)}
                  {" · "}
                  {digits(row.member_count, locale)}
                </span>
              ),
            },
          ]}
          menuItems={(row: DemoOrganization) => [
            {
              key: "reseed",
              label: t("demoReseed"),
              icon: <IconCalendar width={14} height={14} />,
              onSelect: () => {
                setReseedDate(row.demo_date ?? todayLocal());
                setReseeding(row);
              },
            },
            {
              key: "delete",
              label: t("demoDelete"),
              icon: <IconTrash width={14} height={14} />,
              danger: true,
              onSelect: () => setConfirmDelete(row),
            },
          ]}
        />
      </div>

      {seedJob !== null ? (
        <DemoSeedModal
          kind={seedJob.kind}
          name={seedJob.name}
          job={seedJob.job}
          onSettled={onSeedSettled}
          onClose={() => setSeedJob(null)}
          renderDone={(view, close) => {
            if (seedJob.kind === "create") {
              const result = createResultOf(view);
              return result === null
                ? <p className="text-sm text-danger">{t("demoSeedFailed")}</p>
                : (
                  <Credentials
                    result={result}
                    locale={locale}
                    t={t}
                    tGateway={tGateway}
                    onDone={close}
                  />
                );
            }
            const report = reseedReportOf(view);
            return (
              <div>
                <p className="text-sm leading-6 text-fg-muted">{t("demoReseedDone")}</p>
                {report?.warnings.map((warning) => (
                  <p key={warning} className="mt-1 text-xs leading-5 text-warning">{warning}</p>
                ))}
                <div className="mt-4 flex justify-end">
                  <button type="button" className="btn-primary" onClick={close}>
                    {t("demoSeedClose")}
                  </button>
                </div>
              </div>
            );
          }}
        />
      ) : null}

      {reseeding !== null ? (
        <ConfirmDialog
          title={t("demoReseedTitle", { name: reseeding.name })}
          danger={false}
          busy={busy}
          body={
            <div className="space-y-3">
              {/* a CONSEQUENCE, said while the person can still change their
                  mind: the content goes and the accounts do not */}
              <p className="text-sm leading-6 text-fg-muted">{t("demoReseedBody")}</p>
              <Field label={t("demoDate")}>
                <DateField value={reseedDate} onChange={setReseedDate} />
              </Field>
            </div>
          }
          confirmLabel={t("demoReseed")}
          cancelLabel={tCommon("cancel")}
          onConfirm={() => void reseed()}
          onCancel={() => setReseeding(null)}
        />
      ) : null}

      {confirmDelete !== null ? (
        <ConfirmDialog
          title={t("demoDeleteTitle", { name: confirmDelete.name })}
          busy={busy}
          body={<p className="text-sm leading-6 text-fg-muted">{t("demoDeleteBody")}</p>}
          confirmLabel={t("demoDelete")}
          cancelLabel={tCommon("cancel")}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * The presenter's credentials, shown ONCE — inside the seed modal, which is
 * the one surface a click-away cannot dismiss.
 *
 * There is no route that can fetch this again — core delivered it on the
 * finished poll and forgot the job in the same call — so the panel stays
 * until it is explicitly dismissed, and the dismissal is a separate press
 * from the copy buttons beside it.
 */
function Credentials({
  result, locale, t, tGateway, onDone,
}: {
  result: DemoSeedResult;
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  tGateway: (key: string) => string;
  onDone: () => void;
}) {
  return (
    <div>
      {/* a CONSEQUENCE of pressing the button, not an explanation of the
          screen: this is the only copy and it goes when this panel does */}
      <p className="text-sm leading-6 text-fg-muted">{t("demoReadyBody")}</p>

      <div className="mt-3 space-y-2">
        <CopyRow label={t("demoOwnerEmail")} value={result.owner.email} tGateway={tGateway} />
        <CopyRow label={t("demoOwnerPassword")} value={result.owner.password} tGateway={tGateway} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a className="btn-secondary btn-sm" href={`/${locale}/sign-in`} target="_blank" rel="noreferrer">
          {t("demoSignIn")}
        </a>
      </div>

      <div className="well mt-3">
        <p className="text-xs leading-5 text-fg-muted">
          {t("demoSeededCounts", {
            records: result.report.records.length,
            tasks: result.report.tasks,
            persons: result.report.persons,
            /* the sidebar is on screen in the demo, so what is IN it belongs
               in the one line that says what was seeded */
            conversations: result.report.conversations.length,
          })}
        </p>
        {result.report.warnings.map((warning) => (
          <p key={warning} className="mt-1 text-xs leading-5 text-warning">{warning}</p>
        ))}
      </div>

      <button className="btn-primary mt-4" onClick={onDone}>
        {t("demoCredentialsSaved")}
      </button>
    </div>
  );
}

function CopyRow({
  label, value, tGateway,
}: {
  label: string;
  value: string;
  tGateway: (key: string) => string;
}) {
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("ok");
      window.setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("failed");
    }
  };
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-fg-muted">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="ltr min-w-0 flex-1 select-all break-all rounded-md border border-border bg-surface-2 p-3 font-mono text-xs text-fg">
          {value}
        </code>
        <button className="btn-secondary btn-sm" onClick={() => void copy()}>
          {copied === "ok" ? tGateway("copied") : tGateway("copy")}
        </button>
      </div>
      {copied === "failed"
        ? <p className="mt-1 text-xs text-danger">{tGateway("copyFailed")}</p>
        : null}
    </div>
  );
}
