"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AdminModelRow, User } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { modelLabel } from "@/lib/format";
import { Card, Chip } from "@/components/ui";

/**
 * The org's model allow-list (M5's cost lever) — LIVE (Part 3).
 *
 * The read is `GET /v1/admin/models` (the curation menu that used to have no
 * endpoint — the recorded gap behind this screen's old "choices are not
 * saved" banner, now retired WITH the gap rather than papered over). The
 * write composes the whole `allowed_models` array through the org PATCH,
 * with the lost-update decision taken in the client: re-read before write.
 *
 * `tools` is a MARKER, not a filter: absent means the capability catalogue
 * wasn't readable when this was served — "not checked" is not "no".
 */
export default function ModelsPage() {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const [me, setMe] = useState<User | null>(null);
  const [models, setModels] = useState<AdminModelRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void api.adminModels().then(setModels).catch(() => setFailed(true));
  }, [isAdmin]);

  if (me !== null && !isAdmin) {
    return (
      <ManagementPane activeSlug="models">
        <h1 className="h-page mb-1">{tAdmin("modelAllowList")}</h1>
        <Card className="mt-4">
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{tAdmin("adminOnlyNote")}</p>
        </Card>
      </ManagementPane>
    );
  }

  return (
    <ManagementPane activeSlug="models">
      <div>
        <h1 className="h-page mb-1">{tAdmin("modelAllowList")}</h1>
        <p className="mb-4 text-sm text-fg-muted">{tAdmin("modelAllowNote")}</p>

        {failed ? (
          <Card className="mb-4">
            <p className="text-sm text-danger">{t("modelsLoadFailed")}</p>
          </Card>
        ) : null}

        <Card className="!p-0">
          <div className="overflow-x-auto">
            {/* a TABLE with a master checkbox (user directive): one glance
                says what is on, one click flips the whole catalogue */}
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[rgb(var(--accent))]"
                      aria-label={t("modelSelectAll")}
                      checked={models.length > 0 && models.every((m) => m.allowed)}
                      ref={(el) => {
                        // the third state the checkbox can express and props
                        // cannot: some-but-not-all
                        if (el) el.indeterminate = models.some((m) => m.allowed) && !models.every((m) => m.allowed);
                      }}
                      disabled={busy || models.length === 0}
                      onChange={async (e) => {
                        // ONE write for the whole flip — per-row round trips
                        // here would be N re-reads racing each other
                        setBusy(true);
                        try {
                          await api.updateOrg({
                            allowed_models: e.target.checked ? models.map((m) => m.id) : [],
                          });
                          setModels(await api.adminModels());
                        } catch {
                          setFailed(true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </th>
                  <th className="table-head px-2 py-3 text-start">{t("modelColName")}</th>
                  <th className="table-head px-2 py-3 text-start">{t("modelColProvider")}</th>
                  <th className="table-head px-2 py-3 text-start">{t("modelColSuggested")}</th>
                  <th className="table-head px-2 py-3 text-start">{t("modelColNotes")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {models.map((model) => (
                  <tr key={model.id} className="transition-colors hover:bg-surface-2">
                    <td className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[rgb(var(--accent))]"
                        aria-label={modelLabel(model.name)}
                        checked={model.allowed}
                        disabled={busy}
                        onChange={async (e) => {
                          setBusy(true);
                          try {
                            setModels(await api.setModelAllowed(model.id, e.target.checked));
                          } catch {
                            setFailed(true);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-fg">{modelLabel(model.name)}</td>
                    <td className="px-2 py-2.5">
                      {/* provider derived from the id — not a field the server owes */}
                      <span className="ltr text-xs text-fg-muted">{model.id.split("/")[0]}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      {model.suggested ? <Chip tone="accent">{t("modelSuggested")}</Chip> : null}
                    </td>
                    <td className="px-2 py-2.5">
                      {model.tools === false ? (
                        /* allowed-but-tool-incapable: members won't be OFFERED
                           it (SPEC's filter) — the marker says why a checked
                           box can still produce nothing in the picker */
                        <Chip tone="warning">{t("modelNoTools")}</Chip>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </ManagementPane>
  );
}
