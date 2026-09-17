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
  const [search, setSearch] = useState("");
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
   * What the ADD dialog offers.
   *
   * The list used to be "every model the org has not allowed, first forty",
   * and core served the catalogue in ITS order — which, past the five
   * suggested, is alphabetical. So the dialog opened on
   * `ai21/jamba-large-1.7` (a provider that has been RETIRED), three
   * `aion-labs` and four `amazon/nova`: three hundred rows deep, sorted by
   * nothing an admin cares about, with the models they would actually pick
   * nowhere in sight. The same alphabet-as-ranking bug the members' picker
   * had, still live one dialog over.
   *
   * Now: an UNTYPED box shows core/'s ranked shelf only (`recommended`),
   * which is a shortlist a person can read. TYPING searches the WHOLE
   * catalogue — the shelf is a starting point, never a wall, and an admin
   * who wants a specific model still gets it by naming it.
   *
   * `recommended !== false` rather than `=== true`: a core deployed before
   * the field existed sends nothing, and reading that as "none are" would
   * empty the dialog for every such deployment.
   */
  const inactive = useMemo(() => {
    const term = search.trim().toLowerCase();
    const notAllowed = models.filter((m) => !m.allowed);
    if (term === "") return notAllowed.filter((m) => m.recommended !== false).slice(0, 40);
    return notAllowed
      /* the NAME and the ID both: a person types "gemini" as often as they
         paste an id, and the name is the only one of the two on screen */
      .filter((m) => nameOf(m).toLowerCase().includes(term)
        || m.id.toLowerCase().includes(term))
      .slice(0, 40);
  }, [models, search]);

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
    {
      key: "suggested",
      header: t("modelColSuggested"),
      headClassName: "text-start",
      cell: (model) => (model.suggested ? <Chip tone="accent">{t("modelSuggested")}</Chip> : null),
    },
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
          onClick={() => { setSearch(""); setAdding(true); }}
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
              {/* audit finding, 2026-09-02: this field wore `.input` and then
                  re-answered its height and type size by hand (h-9 min-h-0
                  py-0 text-sm) — the "four overrides of .input" pattern, a
                  36px box inside the 40px-field system. `.input` owns both. */}
              <input
                className="input"
                placeholder={t("modelsSearch")}
                value={search}
                autoFocus
                onChange={(event) => setSearch(event.target.value)}
              />
              {/* THE SHORTLIST SAYS SO IN THE PLACEHOLDER, not in a sentence
                  under the title. A line of prose here is exactly what R21
                  forbids (copy.guard.test.ts caught it), and the rule is
                  right: `modelsSearch` — "search the whole catalogue" — is
                  the control's own hint slot, and it already tells an admin
                  the box reaches past the list below it. */}
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
                {/* rule 12, name WHICH nothing: an empty SHELF is not a
                    failed search. Before this the untyped dialog could say
                    "no model matches that" about a search nobody ran — the
                    same sentence-for-the-wrong-nothing the load window had. */}
                {loaded && inactive.length === 0 ? (
                  <li className="py-3 text-sm text-fg-muted">
                    {search.trim() === "" ? t("modelsShelfEmpty") : t("modelsNoMatch")}
                  </li>
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
