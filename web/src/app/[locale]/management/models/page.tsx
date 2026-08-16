"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AdminModelRow, User } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
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
        <h1 className="mb-1 text-xl font-bold text-fg">{tAdmin("modelAllowList")}</h1>
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
        <h1 className="mb-1 text-xl font-bold text-fg">{tAdmin("modelAllowList")}</h1>
        <p className="mb-4 text-sm text-fg-muted">{tAdmin("modelAllowNote")}</p>

        {failed ? (
          <Card className="mb-4">
            <p className="text-sm text-danger">{t("modelsLoadFailed")}</p>
          </Card>
        ) : null}

        <Card>
          <ul className="space-y-2">
            {models.map((model) => (
              <li key={model.id} className="flex items-center gap-2">
                <label className="tap flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
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
                  <span className="flex-1 text-sm text-fg">
                    {model.name}
                    {/* provider derived from the id — not a field the server owes */}
                    <span className="ltr ms-2 text-xs text-fg-muted">{model.id.split("/")[0]}</span>
                  </span>
                </label>
                {model.tools === false ? (
                  /* allowed-but-tool-incapable: members won't be OFFERED it
                     (SPEC's filter) — the marker says why a checked box can
                     still produce nothing in the picker */
                  <Chip tone="warning">{t("modelNoTools")}</Chip>
                ) : null}
                {model.suggested ? <Chip tone="accent">{t("modelSuggested")}</Chip> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </ManagementPane>
  );
}
