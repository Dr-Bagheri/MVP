"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/Switch";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { notify } from "@/lib/notify";
import { Chip } from "@/components/ui";

/**
 * Settings · Sign-in methods.
 *
 * Since 0078 the availability of each external provider is a SETTING an
 * admin or the owner flips here — the toggle writes through core to the
 * SQL definer door (admin-walled twice; this screen only draws the state).
 * Members see the state without the switch: what the sign-in page offers
 * is a fact everyone may know and only admins may change.
 *
 * The projection updates on the server's answer, never optimistically —
 * a switch that flips back on refusal teaches exactly what happened.
 */
export function SignInMethods() {
  const t = useTranslations("signin");
  const [methods, setMethods] = useState<{ provider: string; enabled: boolean }[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.authMethods().then(setMethods).catch(() => setMethods([]));
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const mayToggle = me?.role === "admin" || me?.role === "owner";

  async function toggle(provider: "google" | "github", enabled: boolean): Promise<void> {
    setBusy(provider);
    try {
      const result = await api.setAuthMethod(provider, enabled);
      setMethods((prev) =>
        prev.map((m) => (m.provider === provider ? { ...m, enabled: result.enabled } : m)));
      notify(t(result.enabled ? "turnedOn" : "turnedOff", { method: t(`method_${provider}`) }));
    } catch {
      notify(t("toggleFailed"), "warn");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-7 text-fg-muted">{t("intro")}</p>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {(["google", "github"] as const).map((key) => {
          const row = methods.find((m) => m.provider === key);
          const enabled = row?.enabled ?? true;
          return (
            <div key={key} className="flex items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t(`method_${key}`)}</p>
                <p className="mt-0.5 text-detail leading-6 text-fg-muted">{t(`method_${key}_note`)}</p>
              </div>
              <Chip tone={enabled ? "success" : "neutral"}>
                {t(enabled ? "active" : "off")}
              </Chip>
              {mayToggle ? (
                /* the theme's switch (2026-09-03) — see components/Switch.tsx
                   for why nine of these were hand-drawn */
                <Switch
                  checked={enabled}
                  onChange={() => void toggle(key, !enabled)}
                  label={t("toggleLabel", { method: t(`method_${key}`) })}
                  disabled={busy !== null}
                  className={busy === key ? "opacity-60" : ""}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/*
        The invitation-domain wall LEFT this screen (user directive,
        2026-08-28: "remove allowed invitation domains"). The COLUMN and its
        refusal at invitation-creation stay — db/0112's wall is untouched —
        only the editing surface is gone, so any domains already set keep
        binding until cleared at the wire.
      */}
    </div>
  );
}
