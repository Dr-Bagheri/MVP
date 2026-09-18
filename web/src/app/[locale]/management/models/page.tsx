"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AdminModelRow, User } from "@/api/types";
import { SettingsPane } from "@/components/platform/SettingsPane";
import { PageHeader, SkeletonLines } from "@/components/scaffold";
import { modelContext, modelLabel, modelPrice } from "@/lib/format";
import { Card, Chip, EmptyState } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { ConfirmDialog, IconAction } from "@/components/rowActions";
import { IconChip, IconPlus, IconTrash } from "@/components/icons";
import { notify, notifyError } from "@/lib/notify";

/**
 * The org's model allow-list (M5's cost lever).
 *
 * THE TABLE HOLDS THE ACTIVE LIST ONLY (user directive, 2026-08-26). The
 * catalogue runs to hundreds, and a table of hundreds with five ticks in
 * it made the five hard to find and the other three hundred look like a
 * decision somebody made. Adding is a deliberate act through a picker now;
 * removing is the table row menu, which is the theme rule for every table.
 *
 * THE EMPTY LIST IS NOT AN EMPTY PRODUCT, and this screen has to say so:
 * `allowed_models = []` means NO CURATION, which core reads as "every model
 * the platform offers" — not "no models". An empty table with no sentence
 * beside it would tell an admin the opposite of what their members can do.
 *
 * `tools` is a MARKER, not a filter: absent means the capability catalogue
 * was not readable when this was served — "not checked" is not "no".
 */
/** `google/gemini-3.1-pro` -> `google`; an id with no slash is its own */
const providerOf = (id: string): string => (id.includes("/") ? id.split("/")[0]! : id);

/**
 * THE ROW'S NAME, and it was reading the wrong field.
 *
 * `modelLabel` takes the catalogue's NAME — its whole body is about a name
 * ("Z.AI: GLM 5.2" -> "GLM 5.2", plus two display-only renames) — and every
 * caller on this page handed it the ID. `"google/gemini-3.1-pro-preview"`
 * contains no colon, so the strip did nothing, both renames were unreachable
 * dead branches, and the row printed the vendor in its title and again on the
 * line underneath. Nothing went red because a raw id IS a plausible label.
 *
 * The id is kept as the fallback for the one case that made the old spelling
 * defensible: a catalogue entry with no name of its own.
 */
const nameOf = (model: { id: string; name?: string }): string =>
  modelLabel(model.name && model.name !== "" ? model.name : model.id);

export default function ModelsPage() {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  /**
   * The row's second line, past the vendor: price then context window.
   *
   * Each half is OMITTED when the catalogue did not state it, rather than
   * rendered as a zero or a dash — "we do not know what this costs" and
   * "this costs nothing" are different facts, and on a price the second one
   * is the expensive way to be wrong.
   */
  const modelMeta = (model: AdminModelRow): string =>
    [
      model.cost ? t("modelMetaPrice", { price: modelPrice(model.cost, locale) }) : "",
      model.contextWindow !== undefined
        ? t("modelMetaContext", { size: modelContext(model.contextWindow, locale) })
        : "",
    ].filter(Boolean).join(" · ");
  const [me, setMe] = useState<User | null>(null);
  const [models, setModels] = useState<AdminModelRow[]>([]);
  /* audit finding, 2026-09-02: `models` starts as [] and the table gated on
     `active.length === 0`, so every load opened on the "no curation — every
     model is offered" sentence BEFORE the answer existed — a claim about the
     org that the header comment above says this screen must never make
     falsely. `loaded` is "the catalogue has answered" (success or failure);
     until then the table shows skeleton rows and says nothing. */
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  /** the model awaiting the platform's are-you-sure (dialog at the foot) */
  const [confirmRemove, setConfirmRemove] = useState<AdminModelRow | null>(null);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void api
      .adminModels()
      .then(setModels)
      /* the flag STAYS — it disables the controls and hides a list that
         would otherwise read as "no models" rather than "not read". What
         went with the toast (2026-09-08) is only the CARD that repeated it
         in words above them. */
      .catch(() => { setFailed(true); notifyError(t("modelsLoadFailed")); })
      /* both branches end the loading state: a failure is an answer too,
         just not one about curation */
      .finally(() => setLoaded(true));
  }, [isAdmin, t]);

  const active = useMemo(() => models.filter((m) => m.allowed), [models]);
  /**
   * What the ADD dialog offers: everything the product serves that this org
   * has not allowed.
   *
   * ── what this used to be, and why it stopped being needed ────────────────
   * The list was "every model the org has not allowed, first forty", and core
   * served the catalogue in ITS order — which is alphabetical. So the dialog
   * opened on `ai21/jamba-large-1.7` (a provider that has been RETIRED),
   * three `aion-labs` and four `amazon/nova`: three hundred rows deep, sorted
   * by nothing an admin cares about, with the models they would actually pick
   * nowhere in sight. The fix was a SHELF — an untyped box showed core/'s
   * ranked shortlist, and typing searched the whole catalogue.
   *
   * On 2026-09-18 the product narrowed to three models, and the shelf went
   * with the problem it solved: a search field over three rows is furniture,
   * and its own placeholder said "search the whole catalogue" about a
   * catalogue the reader could already see all of. What is left is the list.
   * No `slice` either — a cap that can never bite is a number somebody will
   * later read as a rule.
   */
  const inactive = useMemo(() => models.filter((m) => !m.allowed), [models]);

  /**
   * Write the WHOLE array, re-reading after. The lost-update hazard stays
   * recorded rather than silently solved: two admins editing at once is
   * last-write-wins, and the symptom arrives as "this toggle did not
   * stick".
   */
  async function commit(next: string[]) {
    if (busy) return;
    setBusy(true);
    try {
      await api.updateOrg({ allowed_models: next });
      setModels(await api.adminModels());
    } catch {
      notify(t("modelsSaveFailed"), "warn");
    } finally {
      setBusy(false);
    }
  }

  const allow = (id: string) => commit([...active.map((m) => m.id), id]);
  const revoke = (id: string) => commit(active.filter((m) => m.id !== id).map((m) => m.id));

  if (me !== null && !isAdmin) {
    return (
      <SettingsPane activeSlug="models">
        <PageHeader title={tAdmin("modelAllowList")} />
        <Card>
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{tAdmin("adminOnlyNote")}</p>
        </Card>
      </SettingsPane>
    );
  }

  const columns: Column<AdminModelRow>[] = [
    {
      key: "name",
      header: t("modelColName"),
      className: "font-medium text-fg",
      headClassName: "text-start",
      cell: (model) => nameOf(model),
    },
    {
      key: "provider",
      header: t("modelColProvider"),
      headClassName: "text-start",
      className: "text-fg-muted",
      /* the provider is the id's own prefix (`google/gemini-3.1-pro`), not
         a served field — deriving it here keeps one spelling of a fact the
         catalogue already carries */
      cell: (model) => providerOf(model.id),
    },
    {
      key: "cost",
      header: t("modelColCost"),
      headClassName: "text-start",
      className: "text-fg-muted tabular-nums",
      /* the same two facts the ADD dialog shows, on the list an admin
         REVIEWS — "should we still be running this" is the same question
         as "should we add it", and a table that cannot answer it sends
         somebody back to the provider's own pricing page. */
      cell: (model) => (model.cost ? modelPrice(model.cost, locale) : null),
    },
    /* A «پیشنهادی» column stood here until 2026-09-18. With three models on
       offer it would have carried its chip on every row, and a chip true of
       every row is a chip that says nothing — the reader learns to skip the
       column, which is worse than not having it. */
    {
      key: "notes",
      header: t("modelColNotes"),
      headClassName: "text-start",
      /* allowed-but-tool-incapable: members will not be OFFERED it for the
         assistant, and the row says so rather than letting it look chosen */
      cell: (model) =>
        model.tools === false ? <Chip tone="warning">{t("modelNoTools")}</Chip> : null,
    },
  ];

  return (
    <SettingsPane
      activeSlug="models"
      /* row 1's END (R3): the create button sits in the sub-menu row, as on
         tasks and meetings — it stood in a row of its own under the menu */
      actions={
        <button
          type="button"
          className="btn-primary"
          disabled={busy || failed}
          onClick={() => setAdding(true)}
        >
          <IconPlus width={14} height={14} />
          {t("modelsAdd")}
        </button>
      }
    >
      <div>
        <PageHeader title={tAdmin("modelAllowList")} subtitle={tAdmin("modelAllowNote")} />

        {/* NO COUNT SENTENCE above the rows (user, 2026-09-05: "remove 7 مدل
            مجاز, fit the table to the sub menu on top") — the table starts
            where the menu's row ends, like every other list under a menu. */}

        {/* NO OUTER BOX (user directive, 2026-09-02: the same rows as users
            and speakers — the meetings list's shape, no header, no box) */}
        <div>
          {/* audit finding, 2026-09-02: rendered UNCONDITIONALLY, with the
              loading/empty decision inside DataTable, so the frame stands
              first and the empty sentence appears only after the answer.
              The empty node is the honest empty state: an empty allow-list is
              NO CURATION, which core reads as every model the platform
              offers — saying "no models" here would be the opposite of the
              truth. A FAILED load is a third nothing and gets no sentence at
              all: "every model is offered" under "the catalogue could not be
              loaded" would be two claims about the org that cannot both be
              read as true (rule 12: name WHICH nothing). */}
          {failed ? null : (
            <DataTable
              hideHeader
              rows={active}
              loading={!loaded}
              empty={<EmptyState text={t("modelsNoCuration")} />}
              rowKey={(model) => model.id}
              columns={columns}
              menuItems={(model) => [
                {
                  key: "revoke",
                  label: t("modelsRemove"),
                  icon: <IconTrash width={14} height={14} />,
                  danger: true,
                  disabled: busy,
                  /* the press ASKS (the platform rule; confirm.guard.test.ts).
                     Re-adding is possible, but this is not undone by pressing
                     the same control again — the row leaves the table — and a
                     mis-click here takes a model away from the whole
                     organization, including automations already choosing it. */
                  onSelect: () => setConfirmRemove(model),
                },
              ]}
            />
          )}
        </div>
      </div>

      {adding ? (
        <ConfirmDialog
          title={t("modelsAddTitle")}
          wide
          body={
            <div className="space-y-3">
              {/* The search field stood here until 2026-09-18 and went with
                  the shelf it filtered: three rows do not need one, and its
                  placeholder claimed a catalogue that no longer exists. */}
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {/* audit finding's sibling, 2026-09-03 (rule 9: fixing one
                    instance does not fix its siblings): the table's []-means-
                    nothing conflation lived one dialog over too — `inactive`
                    is [] until the catalogue answers, so opening the picker
                    inside the load window showed «مدلی با این نام پیدا نشد»
                    about a catalogue nobody had read yet. Skeleton lines until
                    the answer; the sentence only after it. */}
                {!loaded ? (
                  <li className="py-3">
                    <SkeletonLines lines={4} />
                  </li>
                ) : null}
                {inactive.map((model) => (
                  <li key={model.id} className="flex items-center gap-3 py-2">
                    <IconChip width={14} height={14} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{nameOf(model)}</span>
                      {/* THE TWO FACTS A CHOICE IS MADE ON. The row used to
                          carry the vendor and nothing else, so "which of
                          these should the org run" was a question this
                          dialog made unanswerable — and the newest
                          flagship, which is also the most expensive thing
                          on the shelf, looked exactly like the cheapest.
                          One truncating line, so the row keeps its height. */}
                      <span className="block truncate text-xs text-fg-subtle">
                        {[providerOf(model.id), modelMeta(model)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {model.tools === false ? (
                      <Chip tone="warning">{t("modelNoTools")}</Chip>
                    ) : null}
                    <IconAction
                      label={t("modelsAddOne")}
                      onClick={() => { setAdding(false); void allow(model.id); }}
                    >
                      <IconPlus width={14} height={14} />
                    </IconAction>
                  </li>
                ))}
                {/* rule 12, name WHICH nothing — and the claim changed owner
                    on 2026-09-18. It used to be about the SHELF ("every
                    recommended model is already on the list, search the
                    catalogue for others"), which after the narrowing would
                    have sent an admin looking for models that do not exist:
                    a sentence about the org turning into a false claim about
                    the PRODUCT. It now says what is true — there are no more
                    to add. The load window still speaks for itself above. */}
                {loaded && inactive.length === 0 ? (
                  <li className="py-3 text-sm text-fg-muted">{t("modelsShelfEmpty")}</li>
                ) : null}
              </ul>
            </div>
          }
          confirmLabel={t("modelsDone")}
          cancelLabel={t("modelsDone")}
          danger={false}
          hideCancel
          onConfirm={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {/* the platform's one destructive-action dialog. The title names the
          model the way the TABLE names it (`nameOf`), so the dialog and the
          row it came from cannot read as two different models. */}
      {confirmRemove !== null ? (
        <ConfirmDialog
          title={t("modelsRemoveTitle", { name: nameOf(confirmRemove) })}
          body={t("modelsRemoveBody")}
          confirmLabel={t("modelsRemove")}
          cancelLabel={tCommon("cancel")}
          busy={busy}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            const target = confirmRemove;
            setConfirmRemove(null);
            void revoke(target.id);
          }}
        />
      ) : null}
    </SettingsPane>
  );
}
