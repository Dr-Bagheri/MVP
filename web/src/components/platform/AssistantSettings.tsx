"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui";

/**
 * Settings·Assistant (user directive, 2026-08-21): the autonomy dial and
 * the weekly-digest subscription, MOVED here from the presence dock — a
 * conversation panel is not a place to configure the person having it.
 *
 * The dial's initial value is the STORED one (/v1/me serves `autonomy`
 * since the same batch); an older core omits the field and the control
 * shows the schema default (assist) without claiming it was read. Saves
 * announce themselves on the notification bus — the orb's head, like
 * every other notice.
 */
export function AssistantSettings() {
  const t = useTranslations("settings");
  const [autonomy, setAutonomy] = useState<"watch" | "assist" | "act">("assist");
  const [digest, setDigest] = useState<{ enabled: boolean; available: boolean } | null>(null);
  const [notReady, setNotReady] = useState(false);

  useEffect(() => {
    void api.me().then((me) => {
      if (me?.autonomy) setAutonomy(me.autonomy);
    }).catch(() => undefined);
    void api.weeklyDigest()
      .then((d) => setDigest(d.available ? d : null))
      .catch(() => setDigest(null));
  }, []);

  async function saveAutonomy(next: "watch" | "assist" | "act") {
    const prev = autonomy;
    setAutonomy(next);
    setNotReady(false);
    try {
      await api.setAutonomy(next);
      notify(t("assistantSaved"));
    } catch (cause) {
      setAutonomy(prev);
      const { status, detail } = cause as { status?: number; detail?: string };
      const missing = status === 409 || detail === "not_migrated";
      setNotReady(missing);
      notify(missing ? t("assistantNotReady") : t("assistantSaveFailed"), "warn");
    }
  }

  function saveDigest(enabled: boolean) {
    setDigest({ available: true, enabled });
    void api.setWeeklyDigest(enabled)
      .then(() => notify(t("assistantSaved")))
      .catch(() => {
        setDigest({ available: true, enabled: !enabled });
        notify(t("assistantSaveFailed"), "warn");
      });
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-sm font-semibold text-fg">{t("assistantAutonomy")}</h2>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{t("assistantAutonomyHint")}</p>
        <select
          aria-label={t("assistantAutonomy")}
          className="input mt-3 h-9 min-h-0 w-full max-w-xs text-sm"
          value={autonomy}
          onChange={(e) => void saveAutonomy(e.target.value as "watch" | "assist" | "act")}
        >
          <option value="watch">{t("assistantWatch")}</option>
          {/* assist = the schema default (db/0073) */}
          <option value="assist">{t("assistantAssist")}</option>
          {/* act: write-effect surface actions run without the consent card.
              The org's ceiling (db/0075) still caps the EFFECT server-side. */}
          <option value="act">{t("assistantAct")}</option>
        </select>
        {notReady ? (
          <p role="status" className="mt-2 text-xs text-warning">{t("assistantNotReady")}</p>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-fg">{t("assistantDigest")}</h2>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{t("assistantDigestHint")}</p>
        {digest === null ? (
          /* db/0074 absent or unreadable — an honest "not available", never
             a checkbox that silently discards its write */
          <p className="mt-3 text-xs text-fg-muted">{t("assistantNotReady")}</p>
        ) : (
          <label className="mt-3 flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={digest.enabled}
              onChange={(e) => saveDigest(e.target.checked)}
            />
            {t("assistantDigest")}
          </label>
        )}
      </Card>
    </div>
  );
}
