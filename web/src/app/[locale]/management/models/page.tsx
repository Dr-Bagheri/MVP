"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AdminModelRow } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { Card, Chip } from "@/components/ui";

/**
 * The org's model allow-list (M5's cost lever), re-homed here from `/admin`.
 *
 * **It is still mock-fed, and that is stated on the screen rather than only in
 * a comment.** `/v1/admin/models` does not exist; `api.adminModels()` and
 * `api.setModelAllowed()` are fixtures, so a change here persists for the life
 * of the tab and no further.
 *
 * **A LOST-UPDATE hazard to design for before this goes live** (flagged by FE1
 * while wiring the org form). Curation is not a per-model endpoint: the org row
 * carries `allowed_models` as an ARRAY, and `setModelAllowed` composes the whole
 * list and sends it through `updateOrg`. So the checkbox reads as a per-model
 * write and is not one — **two admins toggling different models at the same
 * time clobber each other's entire list, last write wins**, and the loser sees
 * a setting that "un-saved itself".
 *
 * That is a property of the wire (the field is the unit), not something to
 * paper over client-side. Written down here rather than discovered later,
 * because the symptom arrives as a bug report about a toggle that does not
 * stick, and nothing on this screen would suggest the real cause. Whoever wires
 * this decides: re-read before write, a concurrency token, or an accepted risk
 * stated out loud.
 *
 * Moving a known-stale surface to a new address is exactly how a stale surface
 * gets forgotten — the new route looks like new work. So the warning moved with
 * it, and it says the specific thing (choices are not saved) rather than a
 * vague "coming soon".
 *
 * `AdminModelRow` stays a Phase-A view-model on purpose: `provider`,
 * `allowed`, `suggested` and `tool_capable` are OUR fields, not core/'s, and
 * none of them should migrate into the wire type. In particular **nothing in
 * the catalogue filters on tool support** — `tool_capable` here is fixture
 * data, and the UI must not present it as enforcement.
 */
export default function ModelsPage() {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const [models, setModels] = useState<AdminModelRow[]>([]);

  useEffect(() => {
    void api.adminModels().then(setModels);
  }, []);

  return (
    <ManagementPane activeSlug="models">
      <div>
        <h1 className="mb-1 text-xl font-bold text-fg">{tAdmin("modelAllowList")}</h1>
        <p className="mb-4 text-sm text-fg-muted">{tAdmin("modelAllowNote")}</p>

        <Card className="mb-4 border-warning/40 bg-warning/10">
          <p className="text-sm font-semibold text-fg">{t("modelsNotSavedTitle")}</p>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{t("modelsNotSavedBody")}</p>
        </Card>

        <Card>
          <ul className="space-y-2">
            {models.map((model) => (
              <li key={model.id} className="flex items-center gap-2">
                <label className="tap flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                    checked={model.allowed}
                    onChange={async (e) => {
                      await api.setModelAllowed(model.id, e.target.checked);
                      setModels(await api.adminModels());
                    }}
                  />
                  <span className="flex-1 text-sm text-fg">
                    {model.label}
                    <span className="ltr ms-2 text-xs text-fg-muted">{model.provider}</span>
                  </span>
                </label>
                {model.suggested ? <Chip tone="accent">{t("modelSuggested")}</Chip> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </ManagementPane>
  );
}
